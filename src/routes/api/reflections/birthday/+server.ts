import { json } from '@sveltejs/kit';
import { upsertReflectionForPeriod } from '$lib/server/reflections';
import { buildInterviewMarkdown, type InterviewAnswers } from '$lib/flows/birthday-interview';
import type { RequestHandler } from './$types';

/**
 * Lagrer bursdagsintervjuet som én refleksjon per år (kind 'birthday_interview',
 * periodKey = årstall). Upsert gjør at intervjuet kan tas på nytt og erstatte årets svar.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const body = await request.json();
	const raw = body?.answers;
	if (!raw || typeof raw !== 'object') {
		return json({ error: 'Mangler svar' }, { status: 400 });
	}

	const answers: InterviewAnswers = {};
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		if (typeof value === 'string' && value.trim()) answers[key] = value.trim();
	}

	const content = buildInterviewMarkdown(answers);
	if (!content) {
		return json({ error: 'Tomt innhold' }, { status: 400 });
	}

	const periodKey = String(new Date().getFullYear());
	const reflection = await upsertReflectionForPeriod({
		userId: locals.userId,
		kind: 'birthday_interview',
		periodKey,
		content
	});

	return json({ ok: true, id: reflection?.id ?? null, periodKey });
};
