import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openai } from '$lib/server/openai';

/**
 * Hodedump-ekstraksjon: fritekst-dump → diskrete punkter. Samme kontrakt som
 * dagsplan-forslagene ({headline, existing, refinementPrompt?} → {suggestions}),
 * så FlowSheet-checklisten kan bruke den direkte via aiSuggestionsEndpoint.
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
		existing.length > 0
			? `\nAllerede trukket ut: ${existing.map((t) => `"${t}"`).join(', ')}`
			: '';

	const systemPrompt = `Brukeren har tømt hodet i fritekst — alt som surrer og stjeler fokus. Din jobb er å trekke ut de DISKRETE punktene, så hvert av dem kan få en plass (brytes ned, gjøres i dag, parkeres eller slippes).

Regler:
- Ett punkt per distinkt ting i dumpen — ikke slå sammen, ikke finn på nye
- Behold brukerens egne ord der det går; maks 6-8 ord per punkt
- Bekymringer og uro er også punkter («Uro rundt forsikringssaken»), ikke bare oppgaver
- Ikke gjenta punkter som allerede er trukket ut
- Svar KUN med et JSON-array av strenger, ingen annen tekst

Eksempel: ["Rydde garasjen", "Svare Ola om hytteturen", "Uro rundt forsikringssaken"]`;

	const userPrompt = refinementPrompt?.trim()
		? `Dump: ${headline}${existingContext}

Brukeren presiserer: "${refinementPrompt}"
Trekk ut punkter som tilfredsstiller dette (ikke gjenta de som allerede finnes):`
		: `Dump: ${headline}${existingContext}

Trekk ut punktene:`;

	try {
		const completion = await openai.chat.completions.create({
			model: 'gpt-4o-mini',
			messages: [
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: userPrompt }
			],
			max_tokens: 500,
			temperature: 0.3
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
