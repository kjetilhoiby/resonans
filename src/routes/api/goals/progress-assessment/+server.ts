import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openai } from '$lib/server/openai';

type GoalSummary = {
	title: string;
	progress?: string;
	deadline?: string;
	pace?: string;
};

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.userId) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const rawGoals = (body as { goals?: unknown })?.goals;
	if (!Array.isArray(rawGoals) || rawGoals.length === 0) {
		return json({ assessment: null });
	}

	const summaries: GoalSummary[] = [];
	for (const entry of rawGoals) {
		if (!entry || typeof entry !== 'object') continue;
		const rec = entry as Record<string, unknown>;
		const title = typeof rec.title === 'string' ? rec.title.trim() : '';
		if (!title) continue;
		const summary: GoalSummary = { title };
		if (typeof rec.progress === 'string') summary.progress = rec.progress;
		if (typeof rec.deadline === 'string') summary.deadline = rec.deadline;
		if (typeof rec.pace === 'string') summary.pace = rec.pace;
		summaries.push(summary);
		if (summaries.length >= 12) break;
	}

	if (summaries.length === 0) {
		return json({ assessment: null });
	}

	const lines = summaries.map((g, i) => {
		const parts = [`${i + 1}. ${g.title}`];
		if (g.progress) parts.push(`fremdrift: ${g.progress}`);
		if (g.pace) parts.push(`tempo: ${g.pace}`);
		if (g.deadline) parts.push(`frist: ${g.deadline}`);
		return parts.join(' · ');
	});

	try {
		const completion = await openai.chat.completions.create({
			model: 'gpt-4o-mini',
			messages: [
				{
					role: 'system',
					content: [
						'Du er en uformell coach som gir en kort, motiverende vurdering av brukerens fremdrift mot aktive mål.',
						'Skriv ÉN setning (maks to korte) på norsk. Direkte, ærlig, vennlig — som en venn som heier.',
						'Vær konkret: nevn om personen ligger an til å nå målene, er foran/bak plan, eller hva som trengs nå.',
						'Eksempel: «Du ligger an til å nå begge målene — kjør på nå!» eller «Du er litt bak på løpinga, men vekta ligger på skjema — øk takten denne uka.»',
						'Ikke bruk overskrifter, lister, anførselstegn eller emojis. Bare ren tekst.'
					].join('\n')
				},
				{
					role: 'user',
					content: `Aktive mål:\n${lines.join('\n')}`
				}
			],
			temperature: 0.7,
			max_tokens: 120
		});

		const assessment = completion.choices[0]?.message?.content?.trim() ?? '';
		if (!assessment) return json({ assessment: null });
		return json({ assessment });
	} catch (error) {
		console.error('[goals/progress-assessment] OpenAI error:', error);
		return json({ assessment: null });
	}
};
