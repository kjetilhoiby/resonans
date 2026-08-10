import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { getWorkoutContextForUser } from '$lib/server/workout-context';
import { computeWorkoutNugget } from '$lib/server/workout-nuggets';
import { getWorkoutAssessment } from '$lib/server/workouts/workout-assessment';
import { findHealthThemeId, findThemeByName, getHealthThemeIds } from '$lib/server/themes';

export const load: PageServerLoad = async ({ params, locals }) => {
	const userId = locals.userId;
	const workoutId = params.id;

	const workout = await getWorkoutContextForUser(userId, workoutId);
	if (!workout) {
		throw error(404, 'Treningsøkt ikke funnet');
	}

	// Rå event: trackPoints til kartet, og `ekkoAnalysis` med navngitte
	// strekninger når Ekko sendte den (se docs/ekko-oktanalyse.md).
	const rawEvent = await db.query.sensorEvents.findFirst({
		where: and(eq(sensorEvents.id, workoutId), eq(sensorEvents.userId, userId)),
		columns: { data: true, metadata: true }
	});

	const eventData = (rawEvent?.data ?? null) as Record<string, unknown> | null;
	const trackPoints = Array.isArray(eventData?.trackPoints) ? eventData.trackPoints : [];

	const [healthThemeId, healthThemeIds, trainingTheme] = await Promise.all([
		findHealthThemeId(userId),
		getHealthThemeIds(userId),
		// Aktivitetslista bor på Trening etter mortema-splitten — dit skal man
		// tilbake når en økt skjules.
		findThemeByName(userId, 'Trening')
	]);

	// Nugget-en sammenligner mot 365 dagers historikk. Den har drevet
	// push-overskriften siden juni; vurderingen fikk den aldri å se.
	const nugget = await computeWorkoutNugget(userId, workout).catch(() => null);

	const { assessment, context } = await getWorkoutAssessment(userId, workoutId, {
		workout: {
			title: workout.title,
			sportType: workout.sportType,
			timestamp: workout.timestamp,
			distanceKm: workout.distanceKm,
			durationSeconds: workout.durationSeconds,
			paceSecondsPerKm: workout.paceSecondsPerKm,
			elevationMeters: workout.elevationMeters,
			avgHeartRate: workout.avgHeartRate,
			maxHeartRate: workout.maxHeartRate
		},
		trackPoints,
		eventData,
		healthThemeIds,
		nugget: nugget?.headline ?? null,
		weekStanding: null
	}).catch(() => ({ assessment: null, context: '', cached: false }));

	return {
		workout,
		trackPoints,
		assessment,
		// Chatten på økta får NØYAKTIG samme fakta som vurderingen. Fram til
		// august 2026 bygde siden sitt eget vedlegg med et halvt dusin tall — og
		// med «/km» også for sykling. To veier inn til de samme tallene driver
		// fra hverandre; det er den feilen dette repoet har betalt for flest ganger.
		assessmentContext: context,
		healthThemeId,
		activityListThemeId: trainingTheme?.id ?? healthThemeId
	};
};
