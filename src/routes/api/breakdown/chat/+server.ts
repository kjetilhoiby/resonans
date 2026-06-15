import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openai } from '$lib/server/openai';

/**
 * Kort samtale FØR forslagene lages — brukeren får prate seg fram til
 * hva oppgaven egentlig innebærer, før substeg foreslås (chat → forslag → velg).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = (await request.json()) as {
		taskTitle: string;
		taskDescription?: string;
		messages?: { role: 'user' | 'assistant'; content: string }[];
	};

	const { taskTitle, taskDescription = '', messages = [] } = body;

	if (!taskTitle?.trim()) {
		return json({ reply: '' });
	}

	const contextInfo = taskDescription.trim() ? `\nKontekst om oppgaven: ${taskDescription.trim()}` : '';

	const systemPrompt = `Du hjelper brukeren med å tenke gjennom hvordan oppgaven «${taskTitle}» kan brytes ned i mindre steg.${contextInfo}

Dette er en kort samtale FØR de konkrete forslagene lages. Målet er å forstå oppgaven bedre — ambisjonsnivå, tidsramme, hindringer og hva som allerede finnes.

Regler:
- Svar kort og naturlig på norsk (1–3 setninger).
- Still gjerne ett oppklarende spørsmål om gangen når noe er uklart.
- IKKE list opp en ferdig liste med substeg ennå — forslagene lages når brukeren trykker «Lag forslag».
- Vær varm og konkret, ikke svulstig.`;

	const sanitized = messages
		.filter(
			(m) =>
				(m.role === 'user' || m.role === 'assistant') &&
				typeof m.content === 'string' &&
				m.content.trim().length > 0
		)
		.slice(-12)
		.map((m) => ({ role: m.role, content: m.content.trim() }));

	try {
		const completion = await openai.chat.completions.create({
			model: 'gpt-4o-mini',
			messages: [{ role: 'system', content: systemPrompt }, ...sanitized],
			max_tokens: 300,
			temperature: 0.7
		});

		const reply = completion.choices[0]?.message?.content?.trim() ?? '';
		return json({ reply });
	} catch (err) {
		console.error('[breakdown/chat] Error:', err);
		return json({ error: 'Kunne ikke generere svar' }, { status: 500 });
	}
};
