import { z } from 'zod';
import { db } from '$lib/db';
import { pantryItems, lunchboxProfiles, persons, foodSettings } from '$lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { tavilySearch } from '$lib/server/web/tavily';
import { importRecipeFromUrl } from '$lib/server/services/recipe-import-service';
import { osloTodayIso, addDaysIso } from '$lib/server/iso-week';

// Norske oppskriftssider med strukturert innhold (JSON-LD) — importen treffer godt her.
const RECIPE_DOMAINS = [
	'matprat.no',
	'godt.no',
	'trinesmatblogg.no',
	'nrk.no',
	'meny.no',
	'kiwi.no',
	'oda.com',
	'aperitif.no',
	'matoppskrift.no'
];

async function gatherPantryIngredients(userId: string): Promise<{ expiring: string[]; inStock: string[] }> {
	const pantry = await db
		.select({ name: pantryItems.name, quantity: pantryItems.quantity, expiresAt: pantryItems.expiresAt })
		.from(pantryItems)
		.where(eq(pantryItems.userId, userId));

	const today = osloTodayIso();
	const horizon = addDaysIso(today, 5);
	const stocked = pantry.filter((p) => !(p.quantity != null && Number(p.quantity) === 0));
	return {
		expiring: stocked
			.filter((p) => p.expiresAt && p.expiresAt >= today && p.expiresAt <= horizon)
			.map((p) => p.name),
		inStock: stocked.map((p) => p.name)
	};
}

async function gatherAvoidList(userId: string): Promise<string[]> {
	// Barnas allergier er harde krav også for middag; dislikes tas med som hint.
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

export const findRecipesTool = {
	name: 'find_recipes',
	description: `Finn ekte oppskrifter på nettet (norske oppskriftssider) basert på tilgjengelige ingredienser og preferanser, og importer valgt oppskrift til kartoteket.

Actions:
- search: søk etter oppskrifter. Uten 'ingredients' brukes lageret automatisk (varer som går ut snart prioriteres). Barnas allergier (fra matpakke-profilene) legges alltid på som «uten …». Returnerer kandidater med tittel, URL og utdrag — presenter dem for brukeren.
- import: hent en kandidat-URL, trekk ut oppskriften og lagre den i kartoteket (meals). Bruk etter at brukeren har valgt en kandidat. Den importerte retten kan deretter legges i ukemenyen med manage_meal_plan (mealId).

Typisk flyt: «finn en middag med kyllingen i fryseren» → search (query='kylling', useExpiring=true) → vis 3-5 kandidater → bruker velger → import(url) → tilby manage_meal_plan.`,

	parameters: z.object({
		userId: z.string(),
		action: z.enum(['search', 'import']),
		query: z.string().optional().describe('Frisøk, f.eks. "kyllingform" eller "rask fiskemiddag"'),
		ingredients: z.array(z.string()).optional().describe('Ingredienser som skal brukes; default hentes fra lageret'),
		constraints: z.string().optional().describe('Preferanser i fritekst, f.eks. "barnevennlig, under 30 min"'),
		maxResults: z.number().optional().describe('Antall kandidater (default 5)'),
		url: z.string().optional().describe('Kandidat-URL for action=import')
	}),

	execute: async (args: {
		userId: string;
		action: 'search' | 'import';
		query?: string;
		ingredients?: string[];
		constraints?: string;
		maxResults?: number;
		url?: string;
	}) => {
		if (args.action === 'import') {
			if (!args.url) return { error: 'url required for import' };
			const result = await importRecipeFromUrl(args.userId, args.url);
			if (!result.ok) return { error: result.error };
			return {
				imported: true,
				meal: {
					id: result.meal.id,
					title: result.meal.title,
					ingredients: result.meal.ingredients,
					prepTimeMin: result.meal.prepTimeMin,
					cookTimeMin: result.meal.cookTimeMin,
					servings: result.meal.servings,
					tags: result.meal.tags,
					sourceUrl: result.meal.sourceUrl
				},
				hint: 'Retten ligger nå i kartoteket — bruk manage_meal_plan med mealId for å legge den i ukemenyen.'
			};
		}

		// search
		let ingredients = (args.ingredients ?? []).map((i) => i.trim()).filter(Boolean);
		let usedPantry = false;
		let expiringUsed: string[] = [];
		if (ingredients.length === 0) {
			const pantry = await gatherPantryIngredients(args.userId);
			// Prioriter det som går ut snart; fall tilbake til et utvalg av lageret.
			expiringUsed = pantry.expiring;
			ingredients = (pantry.expiring.length > 0 ? pantry.expiring : pantry.inStock).slice(0, 5);
			usedPantry = true;
		}

		const avoid = await gatherAvoidList(args.userId);

		// Familiens ukerytme/føringer — myk kontekst modellen kan vekte kandidatene
		// mot (tas ikke inn i selve søkestrengen, som ville forurenset treffene).
		const settings = await db.query.foodSettings.findFirst({
			where: eq(foodSettings.userId, args.userId)
		});
		const weekRhythm = settings?.weekRhythmNote?.trim() || null;

		const queryParts = [
			'oppskrift middag',
			args.query ?? '',
			ingredients.slice(0, 4).join(' '),
			args.constraints ?? '',
			...avoid.map((a) => `uten ${a}`)
		].filter(Boolean);

		const hits = await tavilySearch(queryParts.join(' '), {
			maxResults: args.maxResults ?? 5,
			includeDomains: RECIPE_DOMAINS,
			searchDepth: 'basic'
		});

		if (hits.length === 0) {
			return {
				candidates: [],
				message:
					'Ingen treff — enten mangler TAVILY_API_KEY, eller søket var for smalt. Prøv færre ingredienser eller et friere søk.'
			};
		}

		return {
			searchedFor: { ingredients, constraints: args.constraints ?? null, avoid, weekRhythm, usedPantry, expiringUsed },
			candidates: hits.map((hit) => ({
				title: hit.title,
				url: hit.url,
				snippet: hit.content.slice(0, 240),
				source: new URL(hit.url).hostname.replace(/^www\./, '')
			})),
			hint: 'Presenter kandidatene med kilde; ved valg: find_recipes action=import med url.'
		};
	}
};
