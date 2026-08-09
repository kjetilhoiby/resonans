/**
 * Henter kroppssammensetning inn på vektrader som ble skrevet uten den.
 *
 * Reglene bor rent og testet i `$lib/domain/health/weight-enrichment`. Her er bare
 * datainnhentingen: Withings-kallet, lesingen av eksisterende rader, og skrivingen.
 *
 * ## Hvorfor skrivingen ikke går gjennom SensorEventService
 *
 * Tjenesten kan `upsert_sensor_datatype_timestamp`, men den setter `data` **i sin
 * helhet**. Et felt som finnes på raden og ikke i målingen ville forsvunnet, og det
 * bryter med hele poenget: berikelsen skal bare fylle hull. Vi leser raden, slår
 * sammen i JS, og skriver hele det nye objektet med en vanlig `update` på id.
 *
 * Merget gjøres bevisst **ikke** i SQL. `data || $1::jsonb` med en
 * `JSON.stringify(...)`-parameter nådde basen som en jsonb *streng* sist noen prøvde,
 * og `object || string` er konkatenering i Postgres — søvnradene ble arrays og alle
 * feltene utilgjengelige. Se CLAUDE.md om HRV-fletting. Her er datamengden liten nok
 * til at den trygge veien også er den raske.
 */

import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import {
	planEnrichment,
	type EnrichmentPlan,
	type IncomingMeasurement,
	type StoredWeightRow
} from '$lib/domain/health/weight-enrichment';
import { fetchAllWithingsData } from './withings';
import {
	getValidAccessToken,
	getWithingsSensor,
	parseWeightData,
	WITHINGS_BODY_MEASTYPES
} from './withings-sync';

export interface EnrichmentOptions {
	/** `YYYY-MM-DD`. Uten den leses hele historikken. */
	from?: string | null;
	to?: string | null;
	/** Legger planen uten å skrive noe. */
	dryRun?: boolean;
}

export interface EnrichmentResult {
	window: { from: string | null; to: string | null };
	dryRun: boolean;
	/** Målinger Withings ga oss i vinduet. */
	fetched: number;
	/** Lagrede vektrader i samme vindu. */
	stored: number;
	updated: number;
	alreadyComplete: number;
	unmatched: number;
	unvisited: number;
	fieldCounts: Record<string, number>;
}

/** Skrivinger per runde. Små nok til at en avbrutt kjøring ikke etterlater mye. */
const WRITE_BATCH = 50;

export async function enrichWeightComposition(
	userId: string,
	options: EnrichmentOptions = {}
): Promise<EnrichmentResult> {
	const { from = null, to = null, dryRun = false } = options;

	const sensor = await getWithingsSensor(userId);
	if (!sensor) throw new Error('Ingen aktiv Withings-sensor');
	const accessToken = await getValidAccessToken(sensor);

	const startdate = from ? Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000) : undefined;
	const enddate = to ? Math.floor(Date.parse(`${to}T23:59:59Z`) / 1000) : undefined;

	const groups = await fetchAllWithingsData(accessToken, {
		action: 'getmeas',
		meastypes: WITHINGS_BODY_MEASTYPES,
		category: 1,
		startdate,
		enddate
	});

	const measurements: IncomingMeasurement[] = parseWeightData(groups).map(
		(event: { timestamp: Date; data: Record<string, unknown> }) => ({
			timestampMs: event.timestamp.getTime(),
			data: event.data
		})
	);

	// Bare denne sensorens rader. En HealthKit-import ligger på sin egen sensor og
	// skal ikke kunne få Withings-felt limt på seg fordi tidsstemplene kolliderer.
	const filters = [
		eq(sensorEvents.userId, userId),
		eq(sensorEvents.sensorId, sensor.id),
		eq(sensorEvents.dataType, 'weight')
	];
	if (startdate !== undefined) filters.push(gte(sensorEvents.timestamp, new Date(startdate * 1000)));
	if (enddate !== undefined) filters.push(lte(sensorEvents.timestamp, new Date(enddate * 1000)));

	const rows = await db
		.select({ id: sensorEvents.id, timestamp: sensorEvents.timestamp, data: sensorEvents.data })
		.from(sensorEvents)
		.where(and(...filters))
		.orderBy(asc(sensorEvents.timestamp));

	const stored: StoredWeightRow[] = rows.map((row) => ({
		id: row.id,
		timestampMs: row.timestamp.getTime(),
		data: (row.data ?? null) as Record<string, unknown> | null
	}));

	const plan: EnrichmentPlan = planEnrichment(stored, measurements);

	let updated = 0;
	if (!dryRun) {
		for (let i = 0; i < plan.updates.length; i += WRITE_BATCH) {
			const batch = plan.updates.slice(i, i + WRITE_BATCH);
			await Promise.all(
				batch.map((update) =>
					db
						.update(sensorEvents)
						.set({ data: update.data as typeof sensorEvents.$inferInsert.data })
						.where(eq(sensorEvents.id, update.id))
				)
			);
			updated += batch.length;
		}
		console.log(
			`⚖️  Berikelse: ${updated} vektrader fikk kroppssammensetning (${plan.alreadyComplete} hadde den alt)`
		);
	}

	return {
		window: { from, to },
		dryRun,
		fetched: measurements.length,
		stored: stored.length,
		updated: dryRun ? 0 : updated,
		alreadyComplete: plan.alreadyComplete,
		unmatched: plan.unmatched,
		unvisited: plan.unvisited,
		fieldCounts: plan.fieldCounts
	};
}
