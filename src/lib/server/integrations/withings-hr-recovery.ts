/**
 * Beregner pulsfall (HRR60) per økt fra Withings' intraday-pulsserie, og lagrer
 * det som `hr_recovery`-hendelser.
 *
 * ## Hvorfor dette er et eget steg, og ikke en del av øktsynken
 *
 * Fallet måles i de 60 sekundene **etter** at innsatsen sluttet, og krever derfor
 * en pulsserie som er uavhengig av øktfilene — de slutter å skrive når man trykker
 * stopp. Se `docs/changelog/2026-08-03-hr-recovery-diagnose.md`.
 *
 * Kildene kommer dessuten i to takter: `canonical_workouts` bygges av en
 * projeksjonsjobb *etter* at øktene er skrevet til `sensor_events`, så en
 * beregning som kjørte inline i synken ville sett gårsdagens økter. Derfor er
 * dette **selvhelende**: hver kjøring ser på de siste ukene og fyller hullene som
 * finnes. Kommer en økt sent, tas den neste gang.
 *
 * ## Kostnadstaket
 *
 * Ett Withings-kall per dag med økter uten måling. Synken kjører hvert 5. minutt,
 * så steget må være gratis når det ikke er noe nytt — det er derfor dagene som
 * allerede har målinger hoppes over før noe nettverk røres. `MAX_FETCHES_PER_RUN`
 * er et tak for førstegangs-fylling, og hva som ble utsatt logges.
 */

import { and, eq, gte, lte } from 'drizzle-orm';
import { db } from '$lib/db';
import { canonicalWorkouts, sensorEvents } from '$lib/db/schema';
import { fetchWithingsIntradayActivity } from './withings';
import { SensorEventService } from '$lib/server/services/sensor-event-service';
import {
	bestRecoveryNearEffortEnd,
	parseIntradayHeartRate,
	SEARCH_AFTER_SECONDS,
	SEARCH_BEFORE_SECONDS,
	type HrSample
} from '$lib/domain/health/hr-recovery';

/** Hvor langt bakover vi ser etter økter uten måling. */
export const HR_RECOVERY_LOOKBACK_DAYS = 21;

/** Maks antall Withings-kall per kjøring. Resten tas neste gang. */
export const MAX_FETCHES_PER_RUN = 5;

/** Slakk rundt øktvinduet, så søket etter ankeret har punkter å jobbe med. */
const PADDING_SECONDS = 300;

export interface HrRecoverySyncResult {
	/** Antall økter som fikk en måling denne kjøringen. */
	computed: number;
	/** Økter i vinduet uten måling da vi startet. */
	missing: number;
	/** Økter vi hentet puls for, men som ikke ga et brukbart fall. */
	unmeasurable: number;
	fetches: number;
	/** Vinduer som ble utsatt av taket. */
	deferred: number;
}

interface PendingWorkout {
	startTime: Date;
	endTime: Date;
	sportFamily: string;
}

export async function syncHrRecovery(
	userId: string,
	accessToken: string,
	sensorId: string,
	opts: { lookbackDays?: number; force?: boolean } = {}
): Promise<HrRecoverySyncResult> {
	const lookbackDays = opts.lookbackDays ?? HR_RECOVERY_LOOKBACK_DAYS;
	const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

	const [workouts, existing] = await Promise.all([
		db.query.canonicalWorkouts.findMany({
			where: and(
				eq(canonicalWorkouts.userId, userId),
				gte(canonicalWorkouts.startTime, since)
			),
			columns: { startTime: true, durationSeconds: true, sportFamily: true }
		}),
		db.query.sensorEvents.findMany({
			where: and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'hr_recovery'),
				gte(sensorEvents.timestamp, since)
			),
			columns: { timestamp: true }
		})
	]);

	const measured = new Set(existing.map((row) => row.timestamp.getTime()));

	const pending: PendingWorkout[] = [];
	for (const workout of workouts) {
		// Uten varighet vet vi ikke når innsatsen sluttet, og da er det ingenting
		// å måle fra.
		if (!workout.durationSeconds) continue;
		const endTime = new Date(
			workout.startTime.getTime() + Number(workout.durationSeconds) * 1000
		);
		if (!opts.force && measured.has(endTime.getTime())) continue;
		pending.push({ startTime: workout.startTime, endTime, sportFamily: workout.sportFamily });
	}

	const result: HrRecoverySyncResult = {
		computed: 0,
		missing: pending.length,
		unmeasurable: 0,
		fetches: 0,
		deferred: 0
	};
	if (pending.length === 0) return result;

	const windows = groupIntoFetchWindows(pending);
	const toFetch = windows.slice(0, MAX_FETCHES_PER_RUN);
	result.deferred = windows.length - toFetch.length;
	if (result.deferred > 0) {
		console.log(
			`   [hrr] ${windows.length} vinduer å hente, tar ${toFetch.length} nå. ${result.deferred} utsatt til neste kjøring.`
		);
	}

	for (const window of toFetch) {
		const samples = await fetchHeartRateSeries(accessToken, window.from, window.to);
		result.fetches++;
		if (samples === null) continue;

		for (const workout of window.workouts) {
			const recovery = bestRecoveryNearEffortEnd({
				samples,
				effortEndAt: workout.endTime.toISOString()
			});

			if (!recovery) {
				result.unmeasurable++;
				continue;
			}

			await SensorEventService.write(
				{
					userId,
					sensorId,
					eventType: 'measurement',
					dataType: 'hr_recovery',
					timestamp: workout.endTime,
					data: {
						dropBpm: recovery.dropBpm,
						endBpm: recovery.endBpm,
						recoveredBpm: recovery.recoveredBpm,
						spanSeconds: recovery.spanSeconds,
						// Anker og topp lagres med: uten dem kan ingen senere se om
						// målingen var godt forankret, og da er tallet ikke etterprøvbart.
						anchorOffsetSeconds: recovery.anchorOffsetSeconds,
						peakBpm: recovery.peakBpm,
						band: recovery.band,
						sportFamily: workout.sportFamily,
						workoutStartAt: workout.startTime.toISOString()
					},
					metadata: { source: 'withings_intraday', sampleCount: samples.length },
					source: 'withings_sync_hr_recovery'
				},
				// Upsert, ikke ignore: forbedres utvelgelsen, skal eksisterende
				// målinger regnes om framfor å stå med det gamle tallet.
				{ conflictMode: 'upsert_sensor_datatype_timestamp' }
			);
			result.computed++;
		}
	}

	return result;
}

interface FetchWindow {
	from: Date;
	to: Date;
	workouts: PendingWorkout[];
}

/**
 * Økter samlet i så få hentevinduer som mulig.
 *
 * Gruppert på UTC-dato for øktslutt, ikke Oslo-dato: vinduet er definert av
 * tidsstempler, og et Withings-kall koster det samme uansett hvor grensa går.
 * Flere økter samme dag deler ett kall.
 */
export function groupIntoFetchWindows(workouts: PendingWorkout[]): FetchWindow[] {
	const byDay = new Map<string, PendingWorkout[]>();
	for (const workout of workouts) {
		const day = workout.endTime.toISOString().slice(0, 10);
		const bucket = byDay.get(day);
		if (bucket) bucket.push(workout);
		else byDay.set(day, [workout]);
	}

	return [...byDay.entries()]
		.sort((a, b) => b[0].localeCompare(a[0])) // nyeste først — de er mest interessante
		.map(([, group]) => {
			const ends = group.map((w) => w.endTime.getTime());
			return {
				from: new Date(Math.min(...ends) - (SEARCH_BEFORE_SECONDS + PADDING_SECONDS) * 1000),
				to: new Date(Math.max(...ends) + (SEARCH_AFTER_SECONDS + PADDING_SECONDS) * 1000),
				workouts: group
			};
		});
}

/** Null ved feil — en avvist henting skal ikke stoppe de andre vinduene. */
async function fetchHeartRateSeries(
	accessToken: string,
	from: Date,
	to: Date
): Promise<HrSample[] | null> {
	const response = await fetchWithingsIntradayActivity(accessToken, {
		startdate: Math.floor(from.getTime() / 1000),
		enddate: Math.ceil(to.getTime() / 1000)
	});

	if (response.status !== 0) {
		console.warn(
			`   [hrr] Withings avviste intraday (status ${response.status}${response.error ? `: ${response.error}` : ''}). Status 401/403 betyr manglende scope user.activity.`
		);
		return null;
	}

	return parseIntradayHeartRate(response.body?.series);
}
