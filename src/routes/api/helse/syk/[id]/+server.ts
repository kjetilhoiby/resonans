import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	deleteSickPeriod,
	endSickPeriod,
	getSickState,
	listSickPeriods,
	saveSickPeriod,
	todayOsloKey
} from '$lib/server/health/sick-log';
import { resolveSickPeriod, describeSickPeriod } from '$lib/domain/health/sick-periods';

async function payload(userId: string) {
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
}

/**
 * Rett en periode, eller friskmeld.
 *
 * `{ action: 'end' }` er friskmeldingen: den setter sluttdato uten at flaten må
 * regne ut hvilken dag det blir. Regelen (gårsdagen, ikke i dag) bor i
 * `endSickPeriod` — den er en beslutning, ikke en formattering.
 */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json().catch(() => ({}));

	if (body?.action === 'end') {
		const result = await endSickPeriod(
			userId,
			params.id,
			typeof body?.endDate === 'string' ? body.endDate : undefined
		);
		if (!result.ok) return json({ error: result.error }, { status: 400 });
		return json(await payload(userId));
	}

	const existing = (await listSickPeriods(userId)).find((p) => p.id === params.id);
	if (!existing) return json({ error: 'Fant ikke sykeperioden.' }, { status: 404 });

	// Utelatte felter beholdes. Et felt sendt som null er en SLETTING av verdien
	// («ingen sluttdato» = syk inntil videre) — samme skille som i ernæringsmålene.
	const result = await saveSickPeriod(userId, {
		id: params.id,
		startDate: typeof body?.startDate === 'string' ? body.startDate : existing.startDate,
		endDate: body?.endDate === undefined ? existing.endDate : body.endDate,
		note: body?.note === undefined ? existing.note : body.note
	});
	if (!result.ok) return json({ error: result.error }, { status: 400 });
	return json(await payload(userId));
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });
	const removed = await deleteSickPeriod(userId, params.id);
	if (!removed) return json({ error: 'Fant ikke sykeperioden.' }, { status: 404 });
	return json(await payload(userId));
};
