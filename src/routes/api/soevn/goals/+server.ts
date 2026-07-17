import { json } from '@sveltejs/kit';
import { createSleepGoal, listSleepGoals } from '$lib/server/integrations/sleep-goals';
import { parseTimeToNoonAxis, type SleepGoal } from '$lib/domain/sleep-goals';
import type { RequestHandler } from './$types';

/**
 * Søvnmål fra onboarding-flyten (health_sleep_onboarding) eller andre flater.
 * Body: { targetHours?: number, bedtimeGoal?: 'HH:MM', waketimeGoal?: 'HH:MM' }
 * Opprettelse er idempotent per type (eksisterende mål av samme kind oppdateres).
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	const body = await request.json();

	const goalsToCreate: SleepGoal[] = [];

	const targetHours = Number(body?.targetHours);
	if (Number.isFinite(targetHours) && targetHours >= 4 && targetHours <= 12) {
		goalsToCreate.push({ kind: 'duration', targetHours });
	}

	const bedtime = typeof body?.bedtimeGoal === 'string' ? body.bedtimeGoal.trim() : '';
	if (bedtime && parseTimeToNoonAxis(bedtime) !== null) {
		goalsToCreate.push({ kind: 'bedtime', targetTime: bedtime });
	}

	const waketime = typeof body?.waketimeGoal === 'string' ? body.waketimeGoal.trim() : '';
	if (waketime && parseTimeToNoonAxis(waketime) !== null) {
		goalsToCreate.push({ kind: 'waketime', targetTime: waketime });
	}

	if (goalsToCreate.length === 0) {
		return json({ error: 'Ingen gyldige søvnmål i forespørselen' }, { status: 400 });
	}

	const created = [];
	for (const goal of goalsToCreate) {
		created.push(await createSleepGoal(userId, goal));
	}
	return json({ ok: true, goals: created.map((g) => ({ id: g.id, title: g.title, kind: g.goal.kind })) });
};

export const GET: RequestHandler = async ({ locals }) => {
	const records = await listSleepGoals(locals.userId);
	return json({ goals: records });
};
