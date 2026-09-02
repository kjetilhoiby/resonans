import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getSickState,
	listSickPeriods,
	saveSickPeriod,
	todayOsloKey
} from '$lib/server/health/sick-log';
import { resolveSickPeriod, describeSickPeriod } from '$lib/domain/health/sick-periods';

/** Periodene med alt utregnet, så flaten ikke gjentar domenelogikken. */
function payload(userId: string) {
	return async () => {
		const today = todayOsloKey();
		const [periods, state] = await Promise.all([listSickPeriods(userId), getSickState(userId)]);
		return {
			today,
			active: state.active,
			activePeriodId: state.period?.id ?? null,
			legacyFlagUntil: state.period ? null : state.until,
			periods: periods.map((p) => {
				const resolved = resolveSickPeriod(p, today);
				return { ...resolved, text: describeSickPeriod(resolved) };
			})
		};
	};
}

export const GET: RequestHandler = async ({ locals }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });
	return json(await payload(userId)());
};

export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json().catch(() => ({}));
	const result = await saveSickPeriod(userId, {
		startDate: typeof body?.startDate === 'string' ? body.startDate : todayOsloKey(),
		endDate: body?.endDate,
		note: body?.note
	});
	// Valideringsfeilene er skrevet for å leses av brukeren, så de sendes ordrett.
	if (!result.ok) return json({ error: result.error }, { status: 400 });
	return json(await payload(userId)());
};
