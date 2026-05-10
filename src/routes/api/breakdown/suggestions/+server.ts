import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openai } from '$lib/server/openai';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json() as {
		taskTitle: string;
		taskDescription?: string;
		context?: string;
		existingSubtasks?: string[];
		refinementPrompt?: string;
	};

	const { taskTitle, taskDescription = '', context = '', existingSubtasks = [], refinementPrompt } = body;

	if (!taskTitle?.trim()) {
		return json({ suggestions: [] });
	}

	const contextInfo =
		[taskDescription, context].filter(Boolean).length > 0
			? `\nKontekst: ${[taskDescription, context].filter(Boolean).join('. ')}`
			: '';

	const existingInfo = existingSubtasks.length > 0
		? `\nAllerede lagt til: ${existingSubtasks.map((t) => `"${t}"`).join(', ')}`
		: '';

	const systemPrompt = `Du er en hjelpsom oppgaveplanleggingsassistent. Brukeren ønsker å dele opp en større oppgave i mindre, konkrete subnivåer.

Generer 3–10 konkrete, handlingsorienterte substeg på norsk for å fullføre denne oppgaven.

Regler:
- Hvert substeg må være konkret og sjekkbart
- Maks 5–8 ord per substeg
- Substegene skal være i logisk rekkefølge
- Gjør oppgaven gjennomførbar for en gjennomsnittlig person
- Ikke gjenta substeg som allerede er lagt til
- Svar KUN med et JSON-array av strenger, ingen annen tekst

Eksempel: ["Samle nødvendige verktøy", "Planlegg layout på veggen", "Markere monteringspunkter", "Montere beslag", "Sette opp hylle", "Justere og stramme"]`;

	const userPrompt = refinementPrompt?.trim()
		? `Oppgave: ${taskTitle}${contextInfo}${existingInfo}

Brukeren presiserer: "${refinementPrompt}"
Foreslå nye substeg som tilfredsstiller dette:`
		: `Oppgave: ${taskTitle}${contextInfo}${existingInfo}`;

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
	} catch (err) {
		console.error('[breakdown/suggestions] Error:', err);
		return json({ suggestions: [] });
	}
};
