import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { sensors, sensorEvents, sensorAggregates } from '$lib/db/schema';
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { SCREEN_TIME_DATATYPE, SCREEN_TIME_WEEK_DATATYPE } from '$lib/server/integrations/screen-time';
import { aggregatePeriodsFrom } from '$lib/server/integrations/aggregation';

/**
 * DELETE /api/sensors/screen-time/data?scope=all
 * DELETE /api/sensors/screen-time/data?scope=week&weekStart=YYYY-MM-DD
 *
 * Sletter skjermtid-data. `all` nullstiller alt (events + sensor) — nyttig for å
 * rydde testdata. `week` sletter kun valgt ukes events.
 */
export const DELETE: RequestHandler = async ({ url, locals }) => {
	if (!locals.userId) return json({ error: 'Unauthorized' }, { status: 401 });
	const userId = locals.userId;
	const scope = url.searchParams.get('scope') ?? 'all';

	const sensor = await db.query.sensors.findFirst({
		columns: { id: true },
		where: and(eq(sensors.provider, 'screen_time'), eq(sensors.userId, userId))
	});
	if (!sensor) return json({ success: true, deleted: 0 });

	const dataTypes = [SCREEN_TIME_DATATYPE, SCREEN_TIME_WEEK_DATATYPE];

	if (scope === 'week') {
		const weekStart = url.searchParams.get('weekStart');
		if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
			return json({ error: 'weekStart (YYYY-MM-DD) kreves for scope=week' }, { status: 400 });
		}
		const [y, m, d] = weekStart.split('-').map((n) => Number.parseInt(n, 10));
		const start = new Date(y, m - 1, d, 0, 0, 0, 0);
		const end = new Date(start);
		end.setDate(end.getDate() + 6);
		end.setHours(23, 59, 59, 999);

		const deleted = await db
			.delete(sensorEvents)
			.where(
				and(
					eq(sensorEvents.sensorId, sensor.id),
					inArray(sensorEvents.dataType, dataTypes),
					gte(sensorEvents.timestamp, start),
					lte(sensorEvents.timestamp, end)
				)
			)
			.returning({ id: sensorEvents.id });

		// Fjern screenTime fra ukesaggregatet som dekker intervallet (håndterer tomme uker),
		// og recompute fra fromDate slik at måneden bygges riktig fra gjenværende events.
		await db
			.update(sensorAggregates)
			.set({ metrics: sql`metrics - 'screenTime'`, updatedAt: new Date() })
			.where(
				and(
					eq(sensorAggregates.userId, userId),
					eq(sensorAggregates.period, 'week'),
					lte(sensorAggregates.startDate, end),
					gte(sensorAggregates.endDate, start),
					sql`metrics ? 'screenTime'`
				)
			);
		await aggregatePeriodsFrom(userId, start).catch(() => {});

		return json({ success: true, scope: 'week', deleted: deleted.length });
	}

	// scope = all → nullstill alt
	const deleted = await db
		.delete(sensorEvents)
		.where(and(eq(sensorEvents.sensorId, sensor.id), inArray(sensorEvents.dataType, dataTypes)))
		.returning({ id: sensorEvents.id });

	// Strip screenTime fra alle brukerens aggregater.
	await db
		.update(sensorAggregates)
		.set({ metrics: sql`metrics - 'screenTime'`, updatedAt: new Date() })
		.where(and(eq(sensorAggregates.userId, userId), sql`metrics ? 'screenTime'`));

	// Fjern sensoren slik at onboarding-chip dukker opp igjen.
	await db.delete(sensors).where(and(eq(sensors.id, sensor.id), eq(sensors.userId, userId)));

	return json({ success: true, scope: 'all', deleted: deleted.length });
};
