/**
 * GET /api/apps/akser/status?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Hvilke dager Resonans har fra Akser, og fra hvilken generering. Akser trekker det
 * fra sin egen tidslinje for å finne dager som mangler eller er bygget av en eldre
 * detektor — samme mønster som `/api/apps/healthkit/coverage`. Leser bare.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAppConfig } from '$lib/server/app-registry';
import { findAppSensorId } from '$lib/server/app-sensor';
import { osloDayKey } from '$lib/domain/oslo-time';
import { osloDayBounds } from '$lib/domain/movement/timeline';
import { AKSER_APP_ID, placesUpdatedAt, readDayStatus } from '$lib/server/movement/akser-store';

const DEFAULT_DAYS = 60;
const MAX_DAYS = 400;

export const GET: RequestHandler = async ({ locals, url }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const today = osloDayKey(new Date());
	const to = url.searchParams.get('to') ?? today;
	const from = url.searchParams.get('from') ?? shiftDate(to, -DEFAULT_DAYS);
	const fromBounds = osloDayBounds(from);
	const toBounds = osloDayBounds(to);
	if (!fromBounds || !toBounds) {
		return json({ error: 'from og to må være YYYY-MM-DD' }, { status: 400 });
	}
	if (fromBounds.start > toBounds.start) {
		return json({ error: 'from må ligge før to' }, { status: 400 });
	}
	if (toBounds.start.getTime() - fromBounds.start.getTime() > MAX_DAYS * 24 * 3600_000) {
		return json({ error: `Høyst ${MAX_DAYS} dager per kall` }, { status: 400 });
	}

	const app = getAppConfig(AKSER_APP_ID)!;
	const sensorId = await findAppSensorId(userId, app);
	const [days, placesAt] = await Promise.all([
		sensorId ? readDayStatus(userId, sensorId, fromBounds, toBounds) : Promise.resolve([]),
		placesUpdatedAt(userId)
	]);

	return json({
		ok: true,
		from,
		to,
		placesUpdatedAt: placesAt ? placesAt.toISOString() : null,
		days
	});
};

function shiftDate(date: string, days: number): string {
	const parsed = new Date(`${date}T00:00:00.000Z`);
	if (Number.isNaN(parsed.getTime())) return date;
	return new Date(parsed.getTime() + days * 24 * 3600_000).toISOString().slice(0, 10);
}
