import { db } from '$lib/db';
import { conversations, themes } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { ensureConversationThemeIdColumn } from '$lib/server/conversation-schema';
import { openai } from '$lib/server/openai';

interface EnsureThemeInput {
	userId: string;
	name: string;
	emoji?: string;
	description?: string;
	parentTheme?: string | null;
}

export interface ThemeDetectionResult {
	themeId: string | null;
	themeName: string | null;
	conversationId: string | null;
	confidence: 'high' | 'medium' | 'low' | 'none';
	reasoning?: string;
}

export async function ensureThemeForUser({
	userId,
	name,
	emoji = '📁',
	description,
	parentTheme = null
}: EnsureThemeInput) {
	await ensureConversationThemeIdColumn();

	const existingTheme = await db.query.themes.findFirst({
		where: and(eq(themes.userId, userId), eq(themes.name, name))
	});

	if (existingTheme) {
		let conversationId = existingTheme.conversationId;

		if (!conversationId) {
			const [newConversation] = await db.insert(conversations).values({
				userId,
				title: `${existingTheme.emoji || emoji} ${existingTheme.name}`
			}).returning();
			conversationId = newConversation.id;
		}

		const [updatedTheme] = await db
			.update(themes)
			.set({
				emoji: existingTheme.emoji || emoji,
				description: existingTheme.description || description,
				parentTheme: existingTheme.parentTheme || parentTheme,
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

	const [conversation] = await db.insert(conversations).values({
		userId,
		title: `${emoji} ${name}`
	}).returning();

	const [theme] = await db.insert(themes).values({
		userId,
		name,
		emoji,
		description,
		parentTheme,
		conversationId: conversation.id,
		archived: false,
		aiSuggested: false
	}).returning();

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