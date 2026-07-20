/**
 * recipe-suggest-service.ts — genererer (eller forbedrer) et oppskriftsforslag
 * fra et rettnavn og familiekontekst, uten å lagre det. Klienten fyller skjemaet
 * med forslaget og lagrer selv, så det er alltid ikke-destruktivt.
 *
 * Delt av /api/food/recipes/suggest. Kontekst: 2 voksne + 3 barn (5 porsjoner
 * default), barnas allergier er harde krav. Komponerte retter får
 * hovedprotein/hovedkarbo/grønt; komplette retter (suppe/taco/pizza) lar dem stå
 * tomme.
 */

import { db } from '$lib/db';
import { lunchboxProfiles, persons, foodSettings } from '$lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { openai } from '$lib/server/openai';
import { FAMILY_DEFAULT_SERVINGS } from '$lib/domains/food';
import { PROTEINS, CARBS, GREENS } from '$lib/domains/food/composition';
import { normalizeSuggestion, type SuggestedRecipe } from '$lib/domains/food/recipe-suggestion';

export type { SuggestedRecipe };

export type RecipeSuggestInput = {
	title: string;
	/** Nåværende skjematilstand — gis ved forbedring så modellen bygger videre. */
	current?: Partial<SuggestedRecipe> | null;
	/** Fritekst-instruksjon for forbedring, f.eks. «gjør den enklere, uten laktose». */
	instruction?: string | null;
	/** Måltall for porsjoner (antall personen retten skal mette). Default familiestørrelse. */
	servings?: number | null;
};

export type RecipeSuggestResult =
	| { ok: true; suggestion: SuggestedRecipe }
	| { ok: false; error: string; status: number };

async function gatherAllergies(userId: string): Promise<string[]> {
	const children = await db
		.select({ id: persons.id })
		.from(persons)
		.where(and(eq(persons.userId, userId), eq(persons.kind, 'child'), eq(persons.archived, false)));
	if (children.length === 0) return [];
	const profiles = await db
		.select({ allergies: lunchboxProfiles.allergies })
		.from(lunchboxProfiles)
		.where(
			and(
				eq(lunchboxProfiles.userId, userId),
				inArray(lunchboxProfiles.personId, children.map((c) => c.id))
			)
		);
	return [...new Set(profiles.flatMap((p) => p.allergies))];
}

export async function suggestRecipe(
	userId: string,
	input: RecipeSuggestInput
): Promise<RecipeSuggestResult> {
	const title = String(input.title ?? '').trim();
	if (!title) return { ok: false, error: 'Retten trenger et navn først.', status: 400 };

	const allergies = await gatherAllergies(userId);
	const settings = await db.query.foodSettings.findFirst({ where: eq(foodSettings.userId, userId) });
	const weekRhythm = settings?.weekRhythmNote?.trim() || null;

	const proteinKeys = PROTEINS.map((p) => p.key).join(', ');
	const carbKeys = CARBS.map((c) => c.key).join(', ');
	const greensKeys = GREENS.map((g) => g.key).join(', ');

	const refining = Boolean(input.instruction?.trim());
	const targetServings =
		typeof input.servings === 'number' && input.servings > 0
			? Math.round(input.servings)
			: FAMILY_DEFAULT_SERVINGS;

	// Skala-regelen skiller mellom vanlige middager (skalér til porsjoner) og
	// enhetsbaserte retter (pizza, pannekaker, wraps, burgere), som skrives per
	// enkelt enhet — ellers ender «5 porsjoner» opp som «5 pizzabunner».
	const scaleRule = refining
		? `- Behold porsjonsstørrelsen og mengde-skalaen i den nåværende oppskriften. IKKE skaler opp eller ned med mindre ønsket eksplisitt ber om det.`
		: `- «servings» betyr hvor mange PERSONER retten metter — ikke antall enheter. Sikt på ${targetServings} porsjoner.
- For enhetsbaserte retter (pizza, pannekaker, wraps, burgere, lomper o.l.): skriv oppskriften for ÉN enkelt enhet (f.eks. én pizza) som utgangspunkt, sett «servings» til hvor mange den ene enheten realistisk metter, og nevn i «note» at den kan dobles/tredobles ved behov. Ikke multipliser hele oppskriften opp til familiestørrelse.`;

	const systemPrompt = `Du lager norske familieoppskrifter for et hushold med 2 voksne og 3 barn. Returner KUN gyldig JSON:
{
  "title": "rettens navn på norsk",
  "description": "én kort, fristende setning, eller null",
  "ingredients": [{ "name": "ingrediens", "quantity": 400, "unit": "g" }],
  "instructions": ["kort imperativt steg", "..."],
  "prepTimeMin": 15,
  "cookTimeMin": 25,
  "servings": ${targetServings},
  "tags": ["fisk", "rask"],
  "mainProtein": "en av [${proteinKeys}] eller null",
  "mainCarb": "en av [${carbKeys}] eller null",
  "greens": "en av [${greensKeys}] eller null",
  "effortLevel": "lav | middels | høy",
  "nutritionEstimate": { "kcal": 650, "proteinG": 35 },
  "note": "én kort setning om hva du endret/valgte, eller null"
}
Regler:
${scaleRule}
- Mengder som tall (null hvis ukjent), norske ingrediensnavn.
- mainProtein/mainCarb/greens: fyll dem KUN når retten passer sammensetnings-modellen (protein + karbo + evt. grønt). La dem stå null for retter som ikke passer (suppe, taco, pizza, pannekaker, gryte, gratengrelaterte helretter).
- nutritionEstimate er et grovt estimat PER PORSJON.
- Hold det barnevennlig og gjennomførbart på en travel hverdag.${
		allergies.length > 0
			? `\n- ALLERGIER (harde krav — må unngås helt): ${allergies.join(', ')}.`
			: ''
	}${weekRhythm ? `\n- Familiens ukerytme (myk kontekst): ${weekRhythm}` : ''}`;

	const userContent = refining
		? [
				`Rett: ${title}`,
				`Nåværende oppskrift (JSON):`,
				JSON.stringify(input.current ?? {}, null, 0),
				``,
				`Forbedre den etter dette ønsket: ${input.instruction!.trim()}`,
				`Behold det som fungerer; endre bare det som trengs.`
			].join('\n')
		: `Lag en komplett oppskrift for retten «${title}».`;

	let completion;
	try {
		completion = await openai.chat.completions.create({
			model: 'gpt-4o',
			messages: [
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: userContent }
			],
			response_format: { type: 'json_object' },
			temperature: refining ? 0.4 : 0.6,
			max_tokens: 2500
		});
	} catch {
		return { ok: false, error: 'AI-forslaget feilet. Prøv igjen.', status: 502 };
	}

	const raw = completion.choices[0]?.message?.content ?? '{}';
	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { ok: false, error: 'Klarte ikke tolke forslaget.', status: 502 };
	}

	return { ok: true, suggestion: normalizeSuggestion(parsed, title) };
}
