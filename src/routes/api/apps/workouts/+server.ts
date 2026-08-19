import { json } from '@sveltejs/kit';
import { buildUnifiedWorkoutActivities } from '$lib/server/activity-layer';
import { WORKOUT_LIST_LIMITS, clampQueryInt } from '$lib/domain/health/workout-dismiss';
import type { RequestHandler } from './$types';

/**
 * GET /api/apps/workouts?days=30&limit=50
 *
 * Ekkos økt-liste: dedupliserte treningsøkter på tvers av ALLE kilder, ikke
 * bare de Ekko selv lastet opp.
 *
 * Det er hele poenget med endepunktet. Ekko kjenner sine egne opplastinger,
 * men en økt registrert av klokka finnes bare i Resonans — og det er nettopp
 * en slik økt brukeren trenger å komme til for å skjule den (en sporing som
 * ble startet ved et uhell og sto i fem timer). Uten en liste er den
 * uåtkommelig fra appen.
 *
 * Skjulte økter er IKKE med: `buildUnifiedWorkoutActivities` filtrerer dem
 * bort, som overalt ellers. Lista er altså det brukeren faktisk ville sett.
 */

export const GET: RequestHandler = async ({ locals, url }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const { defaultDays, maxDays, defaultLimit, maxLimit } = WORKOUT_LIST_LIMITS;
	const days = clampQueryInt(url.searchParams.get('days'), defaultDays, 1, maxDays);
	const limit = clampQueryInt(url.searchParams.get('limit'), defaultLimit, 1, maxLimit);
	const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

	const activities = await buildUnifiedWorkoutActivities(userId, { since });

	return json({
		ok: true,
		days,
		workouts: activities.slice(0, limit).map((activity) => ({
			// `id` er `sensor_events.id` for klyngens eldste kilde, og det er den
			// STABILE handtaket: canonical-id-er skrives om hver gang projeksjonen
			// kjører. Send denne tilbake til /dismiss.
			id: activity.activityId,
			startTime: activity.startTime,
			sportType: activity.sportType,
			distanceMeters: activity.distanceMeters,
			durationSeconds: activity.durationSeconds,
			paceSecondsPerKm: activity.paceSecondsPerKm,
			elevationMeters: activity.elevationMeters,
			avgHeartRate: activity.avgHeartRate,
			maxHeartRate: activity.maxHeartRate,
			// Kildene er ikke pynt: de forteller brukeren HVOR økta kom fra, og
			// dermed hvorfor den ikke kan slettes ved roten. En Withings-økt kommer
			// tilbake fra Withings uansett hva appen gjør.
			sources: activity.sources,
			evidenceCount: activity.evidenceCount
		}))
	});
};
