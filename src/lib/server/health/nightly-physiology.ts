/**
 * nightly-physiology.ts — den ENE leseren av nattas fysiologi fra `sensor_events`.
 *
 * HRV, hvilepuls, snittpuls og pustedata kommer alle fra de samme `sleep`-radene,
 * og de deler tre regler som er lette å bomme på hver for seg:
 *
 *  1. **Nattnøkkelen er datoen du VÅKNER** (`nightKeyForTime`, grense 18:00 Oslo).
 *     Withings-netter krysser UTC-midnatt, så en UTC-dato dekker bare den første
 *     timen av natta.
 *  2. **Dagsøvner er ikke netter.** `nightKeyForTime` legger en dupp kl. 14 i
 *     samme bøtte som natta som endte den morgenen, så uten `isNap`-filteret får
 *     natta stemplet en dupps puls og HRV. Det skjedde i prod.
 *  3. **En natt har som regel flere segmenter** — Withings deler natta når man er
 *     ute av senga. Hvilepulsen er MIN av segmentenes `hr_min`, ikke snittet, og
 *     sammenslåingen bor i domenelaget (`buildSleepHeartRateNights`).
 *
 * Lå privat i `sleep-dashboard.ts` fram til september 2026. Da
 * `resting_hr_elevated_7d` skulle drive et sykdomsforslag, kom det fram at
 * signalet hadde sin egen SQL som brøt alle tre: den leste `hr_average` (som
 * ligger 5–10 slag over hvilepulsen), tok med dupper, og snittet segmenter
 * framfor å ta minimum. Søvn-flaten og signalet svarte altså ulikt på «hva er
 * hvilepulsen din», og begge sto synlig på helseflatene.
 */

import { and, desc, eq, gte } from 'drizzle-orm';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { nightKeyForTime } from '$lib/domain/sleep/disturbance';
import type { SleepHeartRateRow } from '$lib/domain/health/sleep-heart-rate';
import {
	buildSleepHeartRateNights,
	summarizeSleepHeartRate,
	type SleepHeartRateSummary
} from '$lib/domain/health/sleep-heart-rate';

export interface HrvNightRow {
	date: string;
	sdnnMs: number;
	samples: number;
}

export interface NightlyPhysiology {
	hrvNights: HrvNightRow[];
	/** Netter med søvnmåling i det hele tatt — grunnlaget for å forklare hull. */
	sleepNights: number;
	/** Ett innslag per SEGMENT. Slås sammen per natt i domenelaget. */
	heartRateRows: SleepHeartRateRow[];
	breathing: {
		date: string;
		apneaHypopneaIndex: number | null;
		snoringMinutes: number | null;
		snoringEpisodes: number | null;
	} | null;
}

export async function readNightlyPhysiology(
	userId: string,
	sinceDays: number
): Promise<NightlyPhysiology> {
	const since = new Date(Date.now() - sinceDays * 86_400_000);
	const rows = await db.query.sensorEvents.findMany({
		columns: { timestamp: true, data: true },
		where: and(
			eq(sensorEvents.userId, userId),
			eq(sensorEvents.dataType, 'sleep'),
			gte(sensorEvents.timestamp, since)
		),
		orderBy: [desc(sensorEvents.timestamp)]
	});

	const hrvNights: HrvNightRow[] = [];
	const heartRateRows: SleepHeartRateRow[] = [];
	const nightKeys = new Set<string>();
	let breathing: NightlyPhysiology['breathing'] = null;

	for (const row of rows) {
		const data = (row.data ?? {}) as Record<string, unknown>;
		const date = nightKeyForTime(row.timestamp);
		if (!date) continue;

		// Se regel 2 i modulkommentaren. Naps telles for seg av kallstedene som
		// bryr seg om dem.
		if (data.isNap === true) continue;

		nightKeys.add(date);

		const hrv = data.hrv as { sdnnMs?: unknown; samples?: unknown } | null | undefined;
		if (hrv && typeof hrv.sdnnMs === 'number') {
			hrvNights.push({
				date,
				sdnnMs: hrv.sdnnMs,
				samples: typeof hrv.samples === 'number' ? hrv.samples : 0
			});
		}

		heartRateRows.push({
			date,
			minBpm: typeof data.hr_min === 'number' ? data.hr_min : null,
			averageBpm: typeof data.hr_average === 'number' ? data.hr_average : null
		});

		// Radene er nyeste først, så den første med tall er siste natt som har dem.
		const ahi = typeof data.apneaHypopneaIndex === 'number' ? data.apneaHypopneaIndex : null;
		const snoringSeconds = typeof data.snoringSeconds === 'number' ? data.snoringSeconds : null;
		const episodes = typeof data.snoringEpisodes === 'number' ? data.snoringEpisodes : null;
		if (!breathing && (ahi !== null || snoringSeconds !== null)) {
			breathing = {
				date,
				apneaHypopneaIndex: ahi,
				snoringMinutes: snoringSeconds === null ? null : Math.round(snoringSeconds / 60),
				snoringEpisodes: episodes
			};
		}
	}

	return { hrvNights, sleepNights: nightKeys.size, heartRateRows, breathing };
}

/**
 * Hvilepuls per natt med baseline og avvik — det Søvn-flaten viser.
 *
 * Alt som spør «ligger hvilepulsen høyere enn vanlig?» skal gå gjennom denne, så
 * signalet, flaten og sykdomsforslaget sier det samme tallet.
 */
export async function loadSleepHeartRate(
	userId: string,
	sinceDays: number
): Promise<SleepHeartRateSummary> {
	const { heartRateRows } = await readNightlyPhysiology(userId, sinceDays);
	return summarizeSleepHeartRate(buildSleepHeartRateNights(heartRateRows));
}
