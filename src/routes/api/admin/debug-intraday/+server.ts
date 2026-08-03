import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { canonicalWorkouts } from '$lib/db/schema';
import { and, eq, gte, lte } from 'drizzle-orm';
import { getValidAccessToken, getWithingsSensor } from '$lib/server/integrations/withings-sync';
import { fetchWithingsIntradayActivity } from '$lib/server/integrations/withings';
import { requireAdmin } from '$lib/server/admin-auth';
import {
	bestRecoveryNearEffortEnd,
	computeHrRecovery,
	parseIntradayHeartRate,
	SEARCH_AFTER_SECONDS,
	SEARCH_BEFORE_SECONDS,
	sliceWindow,
	summarizeSampling
} from '$lib/domain/health/hr-recovery';
import { osloWallClockToUtc } from '$lib/domain/oslo-time';

/**
 * Diagnose: har Withings intraday puls tett nok til å regne HRR60?
 *
 * Steg 1 av to. Tilgang er ikke spørsmålet — samplingsfrekvens er. ScanWatch måler
 * ofte hvert 10. minutt i ro, og faller den tilbake til det rett etter at økta
 * stoppet, er et 60-sekunders fall umulig uansett hvor pen koden er. Dette
 * endepunktet svarer empirisk, på ekte data, før noe bygges videre.
 *
 * ```
 * GET /api/admin/debug-intraday?date=2026-08-01&from=21:30&to=23:59
 * ```
 *
 * `date` er Oslo-dato. Uten parametre brukes de siste 24 timene.
 *
 * Svaret inneholder:
 *  - `sampling`: antall punkter og median/min/maks avstand → holder oppløsningen?
 *  - `samples`: hele serien, så man kan se med egne øyne hvor hullene er
 *  - `workouts`: økter i vinduet, med et HRR60-forsøk per økt
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	await requireAdmin(locals.userId);
	const userId = locals.userId;

	const sensor = await getWithingsSensor(userId);
	if (!sensor) return json({ error: 'Ingen Withings-sensor koblet.' }, { status: 400 });

	const window = resolveWindow(url);
	if ('error' in window) return json({ error: window.error }, { status: 400 });

	const accessToken = await getValidAccessToken(sensor);
	const response = await fetchWithingsIntradayActivity(accessToken, {
		startdate: Math.floor(window.start.getTime() / 1000),
		enddate: Math.floor(window.end.getTime() / 1000)
	});

	if (response.status !== 0) {
		// Statuskoden er det viktigste svaret her: 401/403 betyr manglende scope,
		// og da er hele veien stengt uten en ny autorisasjonsrunde.
		return json(
			{
				error: 'Withings avviste kallet.',
				withingsStatus: response.status,
				withingsError: response.error ?? null,
				hint: 'Status 401/403 betyr at scope user.activity mangler på tokenet — reautoriser Withings.'
			},
			{ status: 502 }
		);
	}

	const samples = parseIntradayHeartRate(response.body?.series);
	const sampling = summarizeSampling(samples);

	const workouts = await db.query.canonicalWorkouts.findMany({
		columns: { startTime: true, sportFamily: true, durationSeconds: true },
		where: and(
			eq(canonicalWorkouts.userId, userId),
			gte(canonicalWorkouts.startTime, new Date(window.start.getTime() - 6 * 60 * 60 * 1000)),
			lte(canonicalWorkouts.startTime, window.end)
		)
	});

	const perWorkout = workouts.map((workout) => {
		const durationSeconds = workout.durationSeconds ? Number(workout.durationSeconds) : null;
		const endAt =
			durationSeconds !== null
				? new Date(workout.startTime.getTime() + durationSeconds * 1000).toISOString()
				: null;
		const endMs = endAt ? new Date(endAt).getTime() : null;

		return {
			startAt: workout.startTime.toISOString(),
			endAt,
			sportFamily: workout.sportFamily,
			durationSeconds,
			// Tettheten LOKALT rundt økta. Den globale medianen blander aktiv modus
			// med 10-minutters hvilemodus og sier derfor ingenting om HRR.
			localSampling:
				endMs === null
					? null
					: summarizeSampling(
							sliceWindow(
								samples,
								endMs - SEARCH_BEFORE_SECONDS * 1000,
								endMs + SEARCH_AFTER_SECONDS * 1000
							)
						),
			// Målingen vi faktisk stoler på: bratteste 60-sekunders fall i vinduet.
			best: endAt ? bestRecoveryNearEffortEnd({ samples, effortEndAt: endAt }) : null,
			// Samme fall målt fra øktas oppgitte sluttid. Med for sammenligning —
			// den er systematisk for lav fordi stoppknappen trykkes etterpå.
			atDeclaredEnd: endAt ? computeHrRecovery({ samples, effortEndAt: endAt }) : null
		};
	});

	const measurable = perWorkout.filter((w) => w.best !== null).length;

	return json({
		window: { start: window.start.toISOString(), end: window.end.toISOString() },
		sampling,
		verdict:
			sampling.count === 0
				? 'Ingen pulspunkter i vinduet — enheten registrerer ikke kontinuerlig puls, eller den var ikke på.'
				: perWorkout.length === 0
					? `${sampling.count} pulspunkter, men ingen økter i vinduet å måle fall etter.`
					: `${measurable} av ${perWorkout.length} økter fikk et brukbart 60-sekunders fall. Sammenlign best mot atDeclaredEnd.`,
		workouts: perWorkout,
		samples
	});
};

/** `date` + `from`/`to` i Oslo-tid, eller siste 24 timer. */
function resolveWindow(url: URL): { start: Date; end: Date } | { error: string } {
	const date = url.searchParams.get('date');
	if (!date) {
		const end = new Date();
		return { start: new Date(end.getTime() - 24 * 60 * 60 * 1000), end };
	}

	const start = osloWallClockToUtc(date, url.searchParams.get('from') ?? '00:00');
	const end = osloWallClockToUtc(date, url.searchParams.get('to') ?? '23:59');
	if (!start || !end) {
		return { error: 'date må være YYYY-MM-DD og from/to må være HH:MM.' };
	}
	if (end <= start) return { error: 'to må være etter from.' };
	// Withings anbefaler under 24 timer per kall.
	if (end.getTime() - start.getTime() > 24 * 60 * 60 * 1000) {
		return { error: 'Vinduet må være under 24 timer.' };
	}

	return { start, end };
}
