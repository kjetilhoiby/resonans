/**
 * daily-heart-rate.ts — dagens LAVESTE puls, fra klokka.
 *
 * Egen leser, og et bevisst valg av ÉN kilde. `hr_min` betyr ulike ting per
 * `data_type` (se `heart-rate-baseline.ts`): fra `sleep` er det hvilepuls under
 * søvn, fra `workout` er det laveste puls UNDER trening (90–120), og
 * punktpulsen vekta måler (`weight.restingHeartRate`) er tatt STÅENDE og ligger
 * 5–15 slag over ekte hvilepuls.
 *
 * Her leses bare `activity` — Withings' døgnsammendrag, altså «dagens laveste
 * målte puls». Det er den eneste av dem som finnes hver dag uten at brukeren
 * gjør noe, og et forløp som blandet inn punktpuls på veiedagene ville vist et
 * hopp på 5–15 slag som ser ut som en endring i kroppen. Samme lærdom som
 * «serien bruker én forbrukskilde, aldri blandet».
 *
 * Sovepuls er et ANNET spørsmål og har sin egen vei inn (`loadSleepHeartRate`).
 * Denne skal aldri brukes til å svare på «ligger hvilepulsen høyere enn
 * vanlig?» — det er den lesningen som ble konsolidert i september 2026.
 */

import { and, asc, eq, gte } from 'drizzle-orm';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { osloDayKey } from '$lib/domain/oslo-time';

export const DAILY_HR_DATA_TYPE = 'activity';

/** Menneskelig navn på kilden. Følger tallet inn i flaten — se regel 3 i sick-episode. */
export const DAILY_HR_SOURCE_LABEL = 'laveste målte puls per døgn, fra klokka';

/**
 * Dagsnøkkel → laveste puls det døgnet.
 *
 * Flere `activity`-rader per dag skal ikke skje (upserten er unik på
 * sensor + type + tidspunkt), men skjer det, vinner den laveste — feltet ER et
 * minimum, og to minima slås sammen ved å ta det minste.
 */
export async function readDailyMinHeartRate(
	userId: string,
	sinceDays: number
): Promise<Map<string, number>> {
	const since = new Date(Date.now() - sinceDays * 86_400_000);
	const rows = await db
		.select({ timestamp: sensorEvents.timestamp, data: sensorEvents.data })
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, DAILY_HR_DATA_TYPE),
				gte(sensorEvents.timestamp, since)
			)
		)
		.orderBy(asc(sensorEvents.timestamp));

	const byDay = new Map<string, number>();
	for (const row of rows) {
		const value = (row.data as Record<string, unknown> | null)?.hr_min;
		if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
		const day = osloDayKey(row.timestamp);
		const existing = byDay.get(day);
		if (existing === undefined || value < existing) byDay.set(day, value);
	}
	return byDay;
}
