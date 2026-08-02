import { db } from '$lib/db';
import { conversations, themes } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { ensureConversationThemeIdColumn } from '$lib/server/conversation-schema';
import { openai } from '$lib/server/openai';
import { maybeActivateEgenfrekvensCheckin } from '$lib/server/egenfrekvens-checkin';
import { HEALTH_PARENT_THEME_NAME, HEALTH_SUBTHEMES } from '$lib/domain/health-subthemes';

interface EnsureThemeInput {
	userId: string;
	name: string;
	emoji?: string;
	description?: string;
	parentTheme?: string | null;
	/**
	 * Sett forelderen også når temaet allerede har en annen. Standard er å la
	 * en eksisterende forelder stå — ellers ville et hvilket som helst
	 * ensure-kall kunne flytte et tema brukeren har plassert bevisst.
	 */
	forceParentTheme?: boolean;
}

export interface ThemeDetectionResult {
	themeId: string | null;
	themeName: string | null;
	conversationId: string | null;
	confidence: 'high' | 'medium' | 'low' | 'none';
	reasoning?: string;
}

/**
 * Barna til et mortema. Hierarkiet er navnebasert (`themes.parentTheme` er
 * fritekst, ikke en FK), så `parentName` er forelderens NAVN.
 *
 * Returnerer fulle rader og sorterer nyeste først — begge deler fordi
 * hjem-dashboardet leser `projectProfile` og forventer den rekkefølgen.
 */
export async function getChildThemes(
	userId: string,
	parentName: string,
	opts: { includeArchived?: boolean } = {}
) {
	const conditions = [eq(themes.userId, userId), eq(themes.parentTheme, parentName)];
	if (!opts.includeArchived) conditions.push(eq(themes.archived, false));

	return db.query.themes.findMany({
		where: and(...conditions),
		orderBy: (t, { desc }) => [desc(t.createdAt)]
	});
}

export async function findThemeByName(userId: string, name: string) {
	return (
		(await db.query.themes.findFirst({
			where: and(eq(themes.userId, userId), eq(themes.name, name))
		})) ?? null
	);
}

/** Id-en til brukerens Helse-tema, eller null om det ikke finnes ennå. */
export async function findHealthThemeId(userId: string): Promise<string | null> {
	const theme = await findThemeByName(userId, HEALTH_PARENT_THEME_NAME);
	return theme?.id ?? null;
}

/**
 * Mortemaet + alle undertemaene, for spørringer som skal se hele helse-familien
 * (f.eks. mål, som kan ligge på et hvilket som helst av dem). Tom liste når
 * brukeren ikke har noe helse-tema.
 */
export async function getHealthThemeIds(userId: string): Promise<string[]> {
	const [parent, children] = await Promise.all([
		findThemeByName(userId, HEALTH_PARENT_THEME_NAME),
		getChildThemes(userId, HEALTH_PARENT_THEME_NAME)
	]);
	const ids = children.map((c) => c.id);
	if (parent) ids.unshift(parent.id);
	return ids;
}

export async function ensureThemeForUser({
	userId,
	name,
	emoji = '📁',
	description,
	parentTheme = null,
	forceParentTheme = false
}: EnsureThemeInput) {
	await ensureConversationThemeIdColumn();

	const existingTheme = await db.query.themes.findFirst({
		where: and(eq(themes.userId, userId), eq(themes.name, name))
	});

	if (existingTheme) {
		let conversationId = existingTheme.conversationId;

		if (!conversationId) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const newConversation = ((await db.insert(conversations).values({
				userId,
				title: `${existingTheme.emoji || emoji} ${existingTheme.name}`
			}).returning()) as any[])[0];
			conversationId = newConversation.id;
		}

		const [updatedTheme] = await db
			.update(themes)
			.set({
				emoji: existingTheme.emoji || emoji,
				description: existingTheme.description || description,
				parentTheme: forceParentTheme ? parentTheme : existingTheme.parentTheme || parentTheme,
				conversationId,
				archived: false,
				updatedAt: new Date()
			})
			.where(eq(themes.id, existingTheme.id))
			.returning();

		return {
			theme: updatedTheme,
			created: false
		};
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const conversation = ((await db.insert(conversations).values({
		userId,
		title: `${emoji} ${name}`
	}).returning()) as any[])[0];

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const theme = ((await db.insert(themes).values({
		userId,
		name,
		emoji,
		description,
		parentTheme,
		conversationId: conversation.id,
		archived: false,
		aiSuggested: false
	}).returning()) as any[])[0];

	// Koble samtalen til temaet med en gang (ellers settes themeId først ved sidelast,
	// og chat-kontekst som er avhengig av themeId mangler hvis man chatter før det).
	await db.update(conversations).set({ themeId: theme.id }).where(eq(conversations.id, conversation.id));

	await maybeActivateEgenfrekvensCheckin(userId, { name, parentTheme });

	return {
		theme,
		created: true
	};
}

/**
 * Detekterer hvilket tema en melding hører til basert på innholdet.
 * Bruker AI til å analysere meldingen mot brukerens eksisterende temaer.
 */
export async function detectThemeForMessage(
	message: string,
	userId: string
): Promise<ThemeDetectionResult> {
	await ensureConversationThemeIdColumn();

	// Hent brukerens aktive temaer
	const userThemes = await db.query.themes.findMany({
		where: and(eq(themes.userId, userId), eq(themes.archived, false))
	});

	// Hvis ingen temaer finnes, ingen match
	if (userThemes.length === 0) {
		return {
			themeId: null,
			themeName: null,
			conversationId: null,
			confidence: 'none'
		};
	}

	// Bygg en liste over temaer for AI
	const themeDescriptions = userThemes.map(
		(t) =>
			`- ID: ${t.id}, Navn: "${t.name}", Emoji: ${t.emoji || 'ingen'}, ParentTheme: "${t.parentTheme || 'ingen'}", Beskrivelse: "${t.description || 'ingen'}"`
	);

	const prompt = `Analyser følgende brukermelding og bestem hvilket tema den hører til.

Brukermelding:
"${message}"

Tilgjengelige temaer:
${themeDescriptions.join('\n')}

Oppgave:
1. Vurder om meldingen klart hører til et av temaene
2. Velg det mest relevante temaet (hvis noen passer)
3. Vurder konfidens-nivå:
   - "high": Meldingen handler åpenbart om dette temaet
   - "medium": Meldingen har klare koblinger til temaet
   - "low": Meldingen kan muligens relatere til temaet
   - "none": Meldingen passer ikke til noen av temaene

Svar BARE med valid JSON (ingen markdown):
{
  "themeId": "uuid-eller-null",
  "themeName": "navn-eller-null",
  "confidence": "high|medium|low|none",
  "reasoning": "kort forklaring"
}`;

	try {
		const response = await openai.chat.completions.create({
			model: 'gpt-4o-mini',
			messages: [
				{
					role: 'system',
					content:
						'Du er et tema-routing-system. Analyser meldinger og match dem til relevante temaer. Svar alltid med valid JSON.'
				},
				{ role: 'user', content: prompt }
			],
			temperature: 0.3,
			response_format: { type: 'json_object' }
		});

		const result = JSON.parse(response.choices[0].message.content || '{}');

		// Finn conversation ID for det matchede temaet
		let conversationId = null;
		if (result.themeId) {
			const matchedTheme = userThemes.find((t) => t.id === result.themeId);
			conversationId = matchedTheme?.conversationId || null;
		}

		return {
			themeId: result.themeId || null,
			themeName: result.themeName || null,
			conversationId,
			confidence: result.confidence || 'none',
			reasoning: result.reasoning
		};
	} catch (error) {
		console.error('Theme detection error:', error);
		return {
			themeId: null,
			themeName: null,
			conversationId: null,
			confidence: 'none'
		};
	}
}

/**
 * Sørger for at Helse-mortemaet har alle fem undertemaene.
 *
 * Idempotent: `ensureThemeForUser` gjenbruker eksisterende tema på navn.
 * `forceParentTheme` trengs fordi Egenfrekvens-temaet kan ha `parentTheme`
 * satt til 'Egenfrekvens' fra før — konvensjonen fra egenfrekvens-flytene —
 * og da ville standardoppførselen latt den gamle forelderen bli stående.
 *
 * Oppretter ikke mortemaet. Har brukeren ikke koblet en helsekilde ennå, er
 * det ingenting å henge undertemaene på, og vi lager ikke seks tomme temaer.
 */
export async function ensureHealthSubthemes(userId: string) {
	const parent = await findThemeByName(userId, HEALTH_PARENT_THEME_NAME);
	if (!parent) return { created: 0, themeIdsByName: {} as Record<string, string> };

	let created = 0;
	const themeIdsByName: Record<string, string> = {};

	for (const subtheme of HEALTH_SUBTHEMES) {
		const result = await ensureThemeForUser({
			userId,
			name: subtheme.name,
			emoji: subtheme.emoji,
			description: subtheme.description,
			parentTheme: HEALTH_PARENT_THEME_NAME,
			forceParentTheme: true
		});
		if (result.created) created += 1;
		themeIdsByName[subtheme.name] = result.theme.id;
	}

	return { created, themeIdsByName };
}

/**
 * Navnet på undertemaet med gitt dashboardtype, hvis brukeren har det.
 *
 * Brukes av /trening- og /skjermtid-redirectene. Returnerer NAVN og ikke id,
 * fordi /tema/[id] slår opp på navn også — og fordi usage-summary
 * normaliserer UUID-segmenter til «[id]». En redirect til uuid ville slått
 * alle helse-temaene sammen til én bøtte i bruksstatistikken.
 *
 * Oppretter ingenting: har brukeren ikke et Helse-tema, er det ingenting å
 * henge undertemaet på, og en tilfeldig navigasjon skal ikke materialisere
 * seks temaer.
 */
export async function resolveHealthSubthemeName(
	userId: string,
	subthemeName: string
): Promise<{ name: string } | { parentId: string } | null> {
	const existing = await findThemeByName(userId, subthemeName);
	if (existing && !existing.archived) return { name: existing.name };

	const parent = await findThemeByName(userId, HEALTH_PARENT_THEME_NAME);
	if (!parent) return null;

	// Har brukeren mortemaet, men ikke undertemaet, opprettes det nå.
	// Merk at vi IKKE gjør dette for et arkivert undertema — ensureThemeForUser
	// setter archived: false og ville gjenopplivet noe brukeren gjemte bevisst.
	if (existing?.archived) return { parentId: parent.id };

	await ensureHealthSubthemes(userId);
	const created = await findThemeByName(userId, subthemeName);
	return created ? { name: created.name } : { parentId: parent.id };
}
