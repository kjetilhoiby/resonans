import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { WorkoutProjectionService } from '$lib/server/services/workout-projection-service';
import { projectionWindowFromWorkoutTimestamp } from '$lib/server/workout-projection-refresh-queue';
import { aggregatePeriodsFrom } from '$lib/server/integrations/aggregation';
import { aggregationStartDate } from '$lib/domain/health/workout-followup';
import type { RequestHandler } from './$types';

/**
 * POST /api/workouts/[activityId]/source-role
 * Utpeker en enkelt kilde-registrering som vinner for en aktivitet: `gps` (distanse/tempo/høyde),
 * `hr` (puls), `main` (begge) — eller `none` for å nullstille. `siblings` er de andre kildenes
 * event-id-er; samme rolle fjernes fra dem så det bare finnes én vinner per rolle. `activityLayer`
 * respekterer flaggene (`metadata.preferGps`/`preferHr`) live. Prosjeksjonene re-materialiseres.
 */
type Role = 'gps' | 'hr' | 'main' | 'none';

const FLAGS: Record<Exclude<Role, 'none'>, Array<'preferGps' | 'preferHr'>> = {
	gps: ['preferGps'],
	hr: ['preferHr'],
	main: ['preferGps', 'preferHr']
};

function setFlags(keys: Array<'preferGps' | 'preferHr'>) {
	let expr = sql`COALESCE(${sensorEvents.metadata}, '{}'::jsonb)`;
	for (const key of keys) {
		expr = sql`jsonb_set(${expr}, ${`{${key}}`}::text[], 'true'::jsonb)`;
	}
	return expr;
}

function clearFlags(keys: Array<'preferGps' | 'preferHr'>) {
	let expr = sql`COALESCE(${sensorEvents.metadata}, '{}'::jsonb)`;
	for (const key of keys) {
		expr = sql`${expr} - ${key}`;
	}
	return expr;
}

export const POST: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;

	let body: { role?: Role; siblings?: string[] };
	try {
		body = (await request.json()) as { role?: Role; siblings?: string[] };
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const role = body.role;
	if (role !== 'gps' && role !== 'hr' && role !== 'main' && role !== 'none') {
		return json({ error: 'Ugyldig rolle' }, { status: 400 });
	}
	const siblings = Array.isArray(body.siblings)
		? body.siblings.filter((id): id is string => typeof id === 'string')
		: [];

	if (role === 'none') {
		await db
			.update(sensorEvents)
			.set({ metadata: clearFlags(['preferGps', 'preferHr']) })
			.where(and(eq(sensorEvents.id, params.activityId), eq(sensorEvents.userId, userId)));
	} else {
		const keys = FLAGS[role];
		await db
			.update(sensorEvents)
			.set({ metadata: setFlags(keys) })
			.where(and(eq(sensorEvents.id, params.activityId), eq(sensorEvents.userId, userId)));
		if (siblings.length > 0) {
			await db
				.update(sensorEvents)
				.set({ metadata: clearFlags(keys) })
				.where(and(inArray(sensorEvents.id, siblings), eq(sensorEvents.userId, userId)));
		}
	}

	const [row] = await db
		.select({ timestamp: sensorEvents.timestamp })
		.from(sensorEvents)
		.where(and(eq(sensorEvents.id, params.activityId), eq(sensorEvents.userId, userId)))
		.limit(1);

	if (!row) return json({ error: 'Kilde ikke funnet' }, { status: 404 });

	try {
		const { fromDate, toDate } = projectionWindowFromWorkoutTimestamp(row.timestamp);
		await WorkoutProjectionService.refreshForRange(userId, fromDate, toDate);
	} catch (error) {
		console.error('[source-role] kunne ikke re-materialisere projeksjon:', error);
	}

	// Et kildebytte endrer distanse, tempo og puls for aktiviteten, altså også
	// effort-skåren. Dagsraden i `sensor_aggregates` — den form- og
	// belastningskortene leser — skrives bare av `aggregateDailyEffort`, ikke av
	// projeksjonen over. Samme grunn som i /dismiss.
	try {
		await aggregatePeriodsFrom(userId, aggregationStartDate([row.timestamp], new Date()));
	} catch (error) {
		console.error('[source-role] kunne ikke re-aggregere dagsraden:', error);
	}

	return json({ success: true });
};
