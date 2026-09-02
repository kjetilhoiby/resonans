/**
 * Enkeltmålinger av vekt — lesing med id, og sletting.
 *
 * Delt mellom endepunktene (`/api/helse/vekt/maalinger`) og chat-verktøyet
 * (`manage_weight_measurement`). To veier inn til den samme slettingen ville drevet
 * fra hverandre: flaten kunne nekte der chatten slettet, og en bruker som får ulikt
 * svar på samme spørsmål stoler på ingen av dem. Samme grunn som at verktøyene
 * gjenbruker dashboard-lasteren — se CLAUDE.md.
 */

import { and, asc, eq, gte } from 'drizzle-orm';
import { db } from '$lib/db';
import { sensorEvents, sensors } from '$lib/db/schema';
import { osloDayKey } from '$lib/domain/oslo-time';
import type { WeightRow } from '$lib/domain/health/weight-outliers';
import { MILESTONE_HISTORY_DAYS } from '$lib/server/weight-dashboard';

/**
 * Setningen som sier at slettingen ikke er hele jobben.
 *
 * Bor her framfor i hver kaller: konsekvensen skal sies likt uansett om brukeren
 * slettet fra flaten eller fra chatten.
 */
export const SOURCE_CLEANUP_NOTE =
	'Slett målingen i kilden også (Withings eller Apple Helse), ellers kan den komme tilbake ved en full synk eller en ny backfill.';

/**
 * Alle vektmålinger i milepælvinduet, med `sensor_events.id`.
 *
 * Rå lesing er riktig: vi trenger id-en for å kunne slette, og `toWeightMeasurements`
 * kaster den. Bare `data.weight` leses — ett felt med én betydning gjennom
 * historikken. Kroppssammensetningen, som er den tvetydige delen, brukes ikke her.
 */
export async function listWeightMeasurements(userId: string): Promise<WeightRow[]> {
	const since = new Date(Date.now() - MILESTONE_HISTORY_DAYS * 86_400_000);

	const rows = await db
		.select({
			id: sensorEvents.id,
			timestamp: sensorEvents.timestamp,
			data: sensorEvents.data,
			provider: sensors.provider
		})
		.from(sensorEvents)
		.leftJoin(sensors, eq(sensorEvents.sensorId, sensors.id))
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'weight'),
				gte(sensorEvents.timestamp, since)
			)
		)
		.orderBy(asc(sensorEvents.timestamp));

	const measurements: WeightRow[] = [];
	for (const row of rows) {
		const weight = (row.data as { weight?: unknown } | null)?.weight;
		if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0) continue;
		measurements.push({
			id: row.id,
			date: osloDayKey(row.timestamp),
			weightKg: weight,
			source: row.provider ?? null
		});
	}
	return measurements;
}

/** Målingene på én Oslo-dag. Flere er normalt — folk veier seg morgen og kveld. */
export async function weightMeasurementsOnDate(
	userId: string,
	date: string
): Promise<WeightRow[]> {
	const all = await listWeightMeasurements(userId);
	return all.filter((row) => row.date === date);
}

export type DeleteWeightResult =
	| { ok: true; deleted: { id: string; date: string; weightKg: number | null } }
	| { ok: false; reason: 'not_found' | 'wrong_type'; detail: string };

/**
 * Sletter én vektmåling.
 *
 * Hard sletting, ikke et skjult-flagg: en rad som er borte fra flaten men fortsatt
 * med i snitt, milepæler og energibalanse er en verre tilstand enn den vi startet i.
 *
 * Hele raden logges før den forsvinner, så en feilsletting kan finnes igjen i
 * serverloggen og legges inn på nytt.
 */
export async function deleteWeightMeasurement(
	userId: string,
	id: string
): Promise<DeleteWeightResult> {
	const existing = await db.query.sensorEvents.findFirst({
		where: and(eq(sensorEvents.id, id), eq(sensorEvents.userId, userId))
	});

	if (!existing) {
		return { ok: false, reason: 'not_found', detail: 'Fant ikke målingen' };
	}
	// Et id-treff på en søvnrad eller en banktransaksjon er en feil hos kalleren,
	// ikke noe vi skal utføre.
	if (existing.dataType !== 'weight') {
		return {
			ok: false,
			reason: 'wrong_type',
			detail: `Raden er ikke en vektmåling (data_type: ${existing.dataType})`
		};
	}

	console.log(
		`[vekt-maalinger] sletter id=${existing.id} user=${userId} ` +
			`timestamp=${existing.timestamp.toISOString()} sensor=${existing.sensorId} ` +
			`data=${JSON.stringify(existing.data)} metadata=${JSON.stringify(existing.metadata)}`
	);

	await db
		.delete(sensorEvents)
		.where(and(eq(sensorEvents.id, id), eq(sensorEvents.userId, userId)));

	return {
		ok: true,
		deleted: {
			id: existing.id,
			date: osloDayKey(existing.timestamp),
			weightKg: (existing.data as { weight?: number } | null)?.weight ?? null
		}
	};
}
