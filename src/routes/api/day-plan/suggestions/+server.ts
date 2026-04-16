import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openai } from '$lib/server/openai';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json() as {
		headline: string;
		dayLabel: string;
		carryovers?: string[];
		weekTasks?: string[];
		weatherSummary?: string;
	};

	const { headline, dayLabel, carryovers = [], weekTasks = [], weatherSummary } = body;

	if (!headline?.trim()) {
		return json({ suggestions: [] });
	}

	const existingContext =
		[...carryovers, ...weekTasks].length > 0
			? `\nAllerede lagt til: ${[...carryovers, ...weekTasks].map((t) => `"${t}"`).join(', ')}`
			: '';

	const weatherContext = weatherSummary ? `\nVær: ${weatherSummary}` : '';

	const systemPrompt = `Du er en hjelpsom planleggingsassistent. Brukeren skal planlegge sin dag og har skrevet en enlinjer for hva dagen handler om.
Foreslå 3–5 konkrete, sjekkbare oppgaver på norsk for denne dagen.

Regler:
- Maks 5–7 ord per oppgave
- Konkret og handlingsorientert (hva som faktisk skal gjøres)
- Ikke overlappe med allerede lagt til oppgaver
- Om vær er relevant for foreslåtte aktiviteter, ta det med i betraktning
- Svar KUN med et JSON-array av strenger, ingen annen tekst

Eksempel: ["Ring tannlegen og avtal time", "Kjøp inn middag på vei hjem", "Svar på epost fra Ole"]`;

	const userPrompt = `Dag: ${dayLabel}
Enlinjer: ${headline}${existingContext}${weatherContext}

Foreslå oppgaver:`;

	try {
		const completion = await openai.chat.completions.create({
			model: 'gpt-4o-mini',
			messages: [
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: userPrompt }
			],
			max_tokens: 300,
			temperature: 0.7
		});

		const text = completion.choices[0]?.message?.content?.trim() ?? '[]';

		let suggestions: string[] = [];
		try {
			suggestions = JSON.parse(text);
			if (!Array.isArray(suggestions)) suggestions = [];
			suggestions = suggestions.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
		} catch {
			// If JSON parse fails, return empty
		}

		return json({ suggestions });
	} catch {
		return json({ suggestions: [] });
	}
};
