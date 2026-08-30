import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { workoutSuppressions } from '$lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { WorkoutProjectionService } from '$lib/server/services/workout-projection-service';
import { projectionWindowFromWorkoutTimestamp } from '$lib/server/workout-projection-refresh-queue';
import { aggregatePeriodsFrom } from '$lib/server/integrations/aggregation';
import { aggregationStartDate } from '$lib/domain/health/workout-followup';
import type { RequestHandler } from './$types';

/**
 * Svartelistede treningsøkter — se og angre.
 *
 * Endepunktet finnes fordi svartelista ellers er en enveisdør: en skjult økt
 * forsvinner fra alle lister, så den kan ikke klikkes på for å angres. Uten en
 * vei tilbake ville et feiltrykk vært usynlig og permanent — og en bruker som
 * ikke tør trykke «Skjul» har ikke funksjonen.
 */

/** GET /api/helse/trening/skjulte — alt brukeren har svartelistet. */
export const GET: RequestHandler = async ({ locals }) => {
	const rows = await db
		.select({
			id: workoutSuppressions.id,
			startTime: workoutSuppressions.startTime,
			sportFamily: workoutSuppressions.sportFamily,
			source: workoutSuppressions.source,
			createdAt: workoutSuppressions.createdAt
		})
		.from(workoutSuppressions)
		.where(eq(workoutSuppressions.userId, locals.userId))
		.orderBy(desc(workoutSuppressions.startTime));

	return json({
		ok: true,
		suppressions: rows.map((row) => ({
			id: row.id,
			startTime: row.startTime.toISOString(),
			sportFamily: row.sportFamily,
			source: row.source,
			createdAt: row.createdAt.toISOString()
		}))
	});
};

/**
 * DELETE /api/helse/trening/skjulte?id=… — angre en svartelisting.
 *
 * Økta blir synlig igjen ved neste bygging av aktivitetslaget. Projeksjonen og
 * dagsraden bygges på nytt her, av samme grunn som ved skjuling: uten det ville
 * økta kommet tilbake i lista, men ikke i formkurven før nattjobben.
 *
 * NB: `metadata.dismissed` på selve raden røres ikke. Det er en annen og
 * smalere sperre (den gjelder én rad, og respekteres av lesere som går utenom
 * aktivitetslaget), og den skal kunne stå alene.
 */
export const DELETE: RequestHandler = async ({ locals, url }) => {
	const id = url.searchParams.get('id');
	if (!id) return json({ error: 'Mangler id' }, { status: 400 });

	const deleted = await db
		.delete(workoutSuppressions)
		.where(and(eq(workoutSuppressions.id, id), eq(workoutSuppressions.userId, locals.userId)))
		.returning({ startTime: workoutSuppressions.startTime });

	if (deleted.length === 0) return json({ error: 'Ikke funnet' }, { status: 404 });

	const startTime = deleted[0].startTime;
	try {
		const { fromDate, toDate } = projectionWindowFromWorkoutTimestamp(startTime);
		await WorkoutProjectionService.refreshForRange(locals.userId, fromDate, toDate);
		await aggregatePeriodsFrom(locals.userId, aggregationStartDate([startTime], new Date()));
	} catch (error) {
		console.error('[skjulte] kunne ikke re-materialisere etter angring:', error);
	}

	return json({ success: true });
};
