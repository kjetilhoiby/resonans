/**
 * recipe-import-service.ts — trekker ut en oppskrift og lagrer den i
 * kartoteket (meals). To innganger:
 *   - importRecipeFromUrl: henter en nettside (JSON-LD Recipe prioriteres,
 *     ellers gpt-4o-mini over sideteksten). Delt av import-endepunktet og
 *     find_recipes-AI-verktøyet.
 *   - importRecipeFromText: trekker ut fra ferdig tekst (f.eks. Instagram-
 *     caption fanget av funn-triagen), uten å hente noen side.
 */

import { db } from '$lib/db';
import { meals } from '$lib/db/schema';
import { openai } from '$lib/server/openai';
import { stripHtml } from '$lib/server/email-processors/shared';

const FETCH_TIMEOUT_MS = 12000;
const MAX_CONTENT_CHARS = 30000;

export type ImportedRecipe = typeof meals.$inferSelect;

export type RecipeImportResult =
	| { ok: true; meal: ImportedRecipe }
	| { ok: false; error: string; status: number };

const RECIPE_SYSTEM_PROMPT = `Du trekker ut en oppskrift fra innholdet du får. Returner KUN gyldig JSON:
{
  "title": "rettens navn på norsk",
  "description": "én kort setning, eller null",
  "ingredients": [{ "name": "ingrediens", "quantity": 400, "unit": "g" }],
  "instructions": ["steg 1", "steg 2"],
  "prepTimeMin": 15,
  "cookTimeMin": 25,
  "servings": 4,
  "tags": ["fisk", "rask"]
}
Regler: mengder som tall (null hvis ukjent), norske ingredensnavn, instruksjoner som korte imperative steg.
Hvis innholdet ikke inneholder en oppskrift: returner {"error": "ingen oppskrift funnet"}.`;

interface ParsedRecipe {
	error?: string;
	title?: string;
	description?: string | null;
	ingredients?: Array<{ name?: string; quantity?: number | null; unit?: string | null }>;
	instructions?: string[];
	prepTimeMin?: number | null;
	cookTimeMin?: number | null;
	servings?: number | null;
	tags?: string[];
}

/** GPT-uttrekk + lagring i meals. Delt kjerne for begge inngangene. */
async function extractAndStore(
	userId: string,
	userContent: string,
	opts: { sourceUrl?: string | null; imageUrl?: string | null } = {}
): Promise<RecipeImportResult> {
	const completion = await openai.chat.completions.create({
		model: 'gpt-4o-mini',
		messages: [
			{ role: 'system', content: RECIPE_SYSTEM_PROMPT },
			{ role: 'user', content: userContent }
		],
		response_format: { type: 'json_object' },
		temperature: 0.1,
		max_tokens: 3000
	});

	const raw = completion.choices[0]?.message?.content ?? '{}';
	let parsed: ParsedRecipe;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { ok: false, error: 'Klarte ikke tolke oppskriften.', status: 502 };
	}

	if (parsed.error || !parsed.title) {
		return { ok: false, error: parsed.error ?? 'Fant ingen oppskrift.', status: 422 };
	}

	const [created] = await db
		.insert(meals)
		.values({
			userId,
			title: parsed.title,
			description: parsed.description ?? null,
			ingredients: (parsed.ingredients ?? [])
				.filter((ing) => ing?.name)
				.map((ing) => ({
					name: String(ing.name).trim(),
					quantity: typeof ing.quantity === 'number' ? ing.quantity : null,
					unit: ing.unit ? String(ing.unit) : null
				})),
			instructions: (parsed.instructions ?? []).map((s) => String(s).trim()).filter(Boolean),
			prepTimeMin: typeof parsed.prepTimeMin === 'number' ? parsed.prepTimeMin : null,
			cookTimeMin: typeof parsed.cookTimeMin === 'number' ? parsed.cookTimeMin : null,
			servings: typeof parsed.servings === 'number' && parsed.servings > 0 ? parsed.servings : 4,
			tags: (parsed.tags ?? []).map((t) => String(t).trim().toLowerCase()).filter(Boolean),
			imageUrl: opts.imageUrl ?? null,
			sourceUrl: opts.sourceUrl ?? null
		})
		.returning();

	return { ok: true, meal: created };
}

export async function importRecipeFromUrl(userId: string, rawUrl: string): Promise<RecipeImportResult> {
	const url = String(rawUrl ?? '').trim();
	if (!/^https?:\/\//i.test(url)) {
		return { ok: false, error: 'Ugyldig URL — må starte med http(s)://', status: 400 };
	}

	let html: string;
	try {
		const res = await fetch(url, {
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			headers: { 'User-Agent': 'Mozilla/5.0 (Resonans oppskriftsimport)' }
		});
		if (!res.ok) {
			return { ok: false, error: `Klarte ikke hente siden (${res.status}).`, status: 502 };
		}
		html = await res.text();
	} catch {
		return { ok: false, error: 'Klarte ikke hente siden — sjekk lenken.', status: 502 };
	}

	// JSON-LD Recipe-blokker er gull når de finnes — send dem med i sin helhet.
	const jsonLdBlocks = Array.from(
		html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
	)
		.map((m) => m[1].trim())
		.filter((block) => /recipe/i.test(block))
		.join('\n');

	const text = stripHtml(html).slice(0, MAX_CONTENT_CHARS);

	const userContent = [
		`URL: ${url}`,
		jsonLdBlocks ? `\nJSON-LD:\n${jsonLdBlocks.slice(0, 15000)}` : '',
		`\nSIDEINNHOLD:\n${text}`
	].join('\n');

	const result = await extractAndStore(userId, userContent, { sourceUrl: url });
	if (!result.ok && result.status === 422) {
		return { ok: false, error: 'Fant ingen oppskrift på siden.', status: 422 };
	}
	return result;
}

/**
 * Trekk ut en oppskrift fra allerede innhentet tekst — f.eks. Instagram-
 * caption + OG-beskrivelse fanget av funn-triagen. Ingen nettverkshenting.
 */
export async function importRecipeFromText(
	userId: string,
	input: { text: string; sourceUrl?: string | null; imageUrl?: string | null }
): Promise<RecipeImportResult> {
	const text = String(input.text ?? '').trim();
	if (!text) {
		return { ok: false, error: 'Tom tekst — ingenting å tolke.', status: 400 };
	}

	const userContent = [
		input.sourceUrl ? `KILDE: ${input.sourceUrl}` : '',
		`\nINNHOLD:\n${text.slice(0, MAX_CONTENT_CHARS)}`
	].join('\n');

	return extractAndStore(userId, userContent, {
		sourceUrl: input.sourceUrl ?? null,
		imageUrl: input.imageUrl ?? null
	});
}
