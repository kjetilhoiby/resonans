import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	createScreenTimeGoal,
	listScreenTimeGoals,
	type ScreenTimeGoal
} from '$lib/server/integrations/screen-time-goals';

/** GET /api/sensors/screen-time/goals — list aktive skjermtid-mål. */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.userId) return json({ error: 'Unauthorized' }, { status: 401 });
	const goals = await listScreenTimeGoals(locals.userId);
	return json({ goals });
};

/**
 * POST /api/sensors/screen-time/goals
 * Body: { kind, basis?, targetMinutes, fromHour?, toHour?, windowCategory?, title?, description?, themeId? }
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.userId) return json({ error: 'Unauthorized' }, { status: 401 });
	const body = await request.json().catch(() => ({}));

	const kind = body?.kind;
	if (kind !== 'total' && kind !== 'social' && kind !== 'window') {
		return json({ error: 'kind må være total, social eller window' }, { status: 400 });
	}
	const targetMinutes = Number(body?.targetMinutes);
	if (!Number.isFinite(targetMinutes) || targetMinutes <= 0) {
		return json({ error: 'targetMinutes må være et positivt tall (minutter)' }, { status: 400 });
	}

	const goal: ScreenTimeGoal = {
		kind,
		basis: body?.basis === 'week_total' ? 'week_total' : 'day_avg',
		targetMinutes: Math.round(targetMinutes),
		...(kind === 'window'
			? {
					fromHour: clampHour(body?.fromHour, 0),
					toHour: clampHour(body?.toHour, 24),
					windowCategory: body?.windowCategory === 'social' ? 'social' : 'total'
				}
			: {})
	};

	const record = await createScreenTimeGoal(locals.userId, goal, {
		title: typeof body?.title === 'string' ? body.title : undefined,
		description: typeof body?.description === 'string' ? body.description : undefined,
		themeId: typeof body?.themeId === 'string' ? body.themeId : undefined
	});

	return json({ success: true, goal: record });
};

function clampHour(v: unknown, fallback: number): number {
	const n = Number(v);
	if (!Number.isFinite(n)) return fallback;
	return Math.max(0, Math.min(24, Math.round(n)));
}
