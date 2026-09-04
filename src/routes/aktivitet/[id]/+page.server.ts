import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { getWorkoutContextForUser } from '$lib/server/workout-context';
import { computeWorkoutNugget } from '$lib/server/workout-nuggets';
import { getWorkoutAssessment } from '$lib/server/workouts/workout-assessment';
import { findHealthThemeId, findThemeByName, getHealthThemeIds } from '$lib/server/themes';
import { getEffortBaseline } from '$lib/server/services/effort-service';
import { readClusterTrackPoints } from '$lib/server/activity-layer';

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
	const ownTrackPoints = Array.isArray(eventData?.trackPoints) ? eventData.trackPoints : [];

	// **Sporet kan ligge på en SØSTERRAD i klynga.** Denne siden adresserer én
	// `sensor_events`-rad, men samme tur skrives av opptil tre kilder og bare én
	// av dem har GPS — en Withings-økt har ingen. Hvilken rad en lenke bærer er
	// ikke forutsigbart (evidence sorteres på starttid), så et kart fantes eller
	// ikke ut fra tilfeldigheter. Fallbacken er per KLYNGE, ikke per lenke:
	// gamle bokmerker og varsel-URL-er peker på den raden de peker på.
	// Radens eget spor vinner alltid — `readClusterTrackPoints` returnerer null da.
	const borrowedTrack =
		ownTrackPoints.length > 0
			? null
			: await readClusterTrackPoints(userId, workoutId).catch((err) => {
					// Et lånt spor er en forbedring, ikke et krav — siden skal ikke
					// falle av at klyngeoppslaget feiler. Men den skal SI det:
					// stille null her og «ingen kart» på flaten er ikke til å skille
					// fra en økt som faktisk mangler spor.
					console.warn(`[aktivitet] klyngespor feilet for ${workoutId}:`, err);
					return null;
				});
	const trackPoints = borrowedTrack?.trackPoints ?? ownTrackPoints;

	const [healthThemeId, healthThemeIds, trainingTheme, hrBaseline] = await Promise.all([
		findHealthThemeId(userId),
		getHealthThemeIds(userId),
		// Aktivitetslista bor på Trening etter mortema-splitten — dit skal man
		// tilbake når en økt skjules.
		findThemeByName(userId, 'Trening'),
		// Pulsfordelingen tegnes mot brukerens EGNE sonebånd. Fram til august 2026
		// brukte den hardkodede absolutte grenser (0–120, 120–140 …) med de samme
		// norske ordene som sonemodellen, så puls 135 var «Lett» her og «Rolig» i
		// sonekortet. Se `hrBandsFromBaseline`.
		getEffortBaseline(userId).catch(() => null)
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
		// Flaten skal SI at sporet er lånt fra en annen kilde i klynga. Et kart
		// som stille tilhører en annen rad enn tallene over det er en påstand
		// brukeren ikke kan etterprøve.
		trackSource: borrowedTrack
			? { borrowed: true as const, provider: borrowedTrack.provider, eventId: borrowedTrack.sourceEventId }
			: null,
		assessment,
		// Chatten på økta får NØYAKTIG samme fakta som vurderingen. Fram til
		// august 2026 bygde siden sitt eget vedlegg med et halvt dusin tall — og
		// med «/km» også for sykling. To veier inn til de samme tallene driver
		// fra hverandre; det er den feilen dette repoet har betalt for flest ganger.
		assessmentContext: context,
		healthThemeId,
		activityListThemeId: trainingTheme?.id ?? healthThemeId,
		// Bare de to tallene båndene regnes av — resten av baselinen hører ikke
		// på en øktside.
		hrBaseline: hrBaseline ? { restHr: hrBaseline.restHr, maxHr: hrBaseline.maxHr } : null
	};
};
