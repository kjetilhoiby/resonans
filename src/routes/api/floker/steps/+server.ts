import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openai } from '$lib/server/openai';

/**
 * Floke-nedbryting: én floke → 2–4 konkrete første steg. Samme kontrakt som
 * /api/floker/extract så FlowSheet-checklisten bruker den via aiSuggestionsEndpoint.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = (await request.json()) as {
		headline: string;
		existing?: string[];
		refinementPrompt?: string;
	};
	const { headline, existing = [], refinementPrompt } = body;

	if (!headline?.trim() && !refinementPrompt?.trim()) {
		return json({ suggestions: [] });
	}

	const existingContext =
		existing.length > 0 ? `\nAllerede foreslått: ${existing.map((t) => `"${t}"`).join(', ')}` : '';

	const systemPrompt = `Brukeren har valgt én «floke» — åpne løkker som har blitt liggende og viklet seg i hverandre — og vil løsne den nå. Floker skal løses ROLIG; presses de, blir de knuter. Foreslå 2–4 KONKRETE FØRSTE STEG.

Regler:
- Første steg skal være så små at de kan gjøres i dag eller i morgen («Ring …», «Finn frem …», «Sett av 20 min til …»)
- Rekkefølge fra minst til mest krevende — det første steget skal senke terskelen, ikke stramme floken
- Maks 6-8 ord per steg, handlingsorientert (verb først)
- Ikke gjenta steg som allerede er foreslått
- Svar KUN med et JSON-array av strenger, ingen annen tekst

Eksempel: ["Finn frem forsikringspapirene", "Ring forsikringsselskapet og spør om status"]`;

	const userPrompt = refinementPrompt?.trim()
		? `Floke: ${headline}${existingContext}

Brukeren presiserer: "${refinementPrompt}"
Foreslå nye steg:`
		: `Floke: ${headline}${existingContext}

Foreslå første steg:`;

	try {
		const completion = await openai.chat.completions.create({
			model: 'gpt-4o-mini',
			messages: [
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: userPrompt }
			],
			max_tokens: 300,
			temperature: 0.5
		});

		const text = completion.choices[0]?.message?.content?.trim() ?? '[]';
		let suggestions: string[] = [];
		try {
			suggestions = JSON.parse(text);
			if (!Array.isArray(suggestions)) suggestions = [];
			suggestions = suggestions.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
		} catch {
			// JSON-parse feilet → tomt
		}

		return json({ suggestions });
	} catch {
		return json({ suggestions: [] });
	}
};
