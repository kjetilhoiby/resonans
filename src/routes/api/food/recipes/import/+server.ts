import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { meals } from '$lib/db/schema';
import { openai } from '$lib/server/openai';
import { stripHtml } from '$lib/server/email-processors/shared';

const FETCH_TIMEOUT_MS = 12000;
const MAX_CONTENT_CHARS = 30000;

// POST /api/food/recipes/import — importer oppskrift fra URL.
// Henter siden server-side, trekker ut oppskriften med gpt-4o-mini og lagrer
// den i kartoteket. Body: { url: string }
export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	const body = await request.json().catch(() => ({}));

	const url = String(body.url ?? '').trim();
	if (!/^https?:\/\//i.test(url)) {
		return json({ error: 'Ugyldig URL — må starte med http(s)://' }, { status: 400 });
	}

	let html: string;
	try {
		const res = await fetch(url, {
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			headers: { 'User-Agent': 'Mozilla/5.0 (Resonans oppskriftsimport)' }
		});
		if (!res.ok) {
			return json({ error: `Klarte ikke hente siden (${res.status}).` }, { status: 502 });
		}
		html = await res.text();
	} catch {
		return json({ error: 'Klarte ikke hente siden — sjekk lenken.' }, { status: 502 });
	}

	// JSON-LD Recipe-blokker er gull når de finnes — send dem med i sin helhet.
	const jsonLdBlocks = Array.from(
		html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
	)
		.map((m) => m[1].trim())
		.filter((block) => /recipe/i.test(block))
		.join('\n');

	const text = stripHtml(html).slice(0, MAX_CONTENT_CHARS);

	const completion = await openai.chat.completions.create({
		model: 'gpt-4o-mini',
		messages: [
			{
				role: 'system',
				content: `Du trekker ut en oppskrift fra en nettside. Returner KUN gyldig JSON:
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
Hvis siden ikke inneholder en oppskrift: returner {"error": "ingen oppskrift funnet"}.`
			},
			{
				role: 'user',
				content: [
					`URL: ${url}`,
					jsonLdBlocks ? `\nJSON-LD:\n${jsonLdBlocks.slice(0, 15000)}` : '',
					`\nSIDEINNHOLD:\n${text}`
				].join('\n')
			}
		],
		response_format: { type: 'json_object' },
		temperature: 0.1,
		max_tokens: 3000
	});

	const raw = completion.choices[0]?.message?.content ?? '{}';
	let parsed: {
		error?: string;
		title?: string;
		description?: string | null;
		ingredients?: Array<{ name?: string; quantity?: number | null; unit?: string | null }>;
		instructions?: string[];
		prepTimeMin?: number | null;
		cookTimeMin?: number | null;
		servings?: number | null;
		tags?: string[];
	};
	try {
		parsed = JSON.parse(raw);
	} catch {
		return json({ error: 'Klarte ikke tolke oppskriften.' }, { status: 502 });
	}

	if (parsed.error || !parsed.title) {
		return json({ error: parsed.error ?? 'Fant ingen oppskrift på siden.' }, { status: 422 });
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
			sourceUrl: url
		})
		.returning();

	return json({ meal: created }, { status: 201 });
};
