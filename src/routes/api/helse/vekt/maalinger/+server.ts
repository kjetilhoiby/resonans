/**
 * GET /api/helse/vekt/maalinger?mistenkelige=true
 *
 * Vektmålinger med `sensor_events.id`, så en enkeltmåling kan rettes eller slettes.
 *
 * ## Hvorfor
 *
 * En veiing på ~40 kg midt i en historikk rundt 100 var synlig i grafen med én gang,
 * men umulig å gjøre noe med: den lå som én rad blant 1 200, og resten av flaten
 * leser dagsverdier uten id-er. Sletting i Apple Health og Withings hjelper ikke —
 * synken vår er additiv, så vår kopi blir stående.
 *
 * `mistenkelige=true` er standard og gir bare radene `findWeightOutliers` peker på.
 * Uten den returneres alt innenfor vinduet, som er det man vil ha når feilmålingen
 * ikke er ekstrem nok til å bli flagget.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { and, asc, eq, gte } from 'drizzle-orm';
import { db } from '$lib/db';
import { sensorEvents, sensors } from '$lib/db/schema';
import { osloDayKey } from '$lib/domain/oslo-time';
import { findWeightOutliers, type WeightRow } from '$lib/domain/health/weight-outliers';
import { MILESTONE_HISTORY_DAYS } from '$lib/server/weight-dashboard';

/** Tak på rå-lista. Uteliggerlista er alltid kort og har ikke behov for et tak. */
const MAX_ROWS = 2000;

export const GET: RequestHandler = async ({ locals, url }) => {
	const userId = locals.userId;
	if (!userId) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const onlySuspicious = url.searchParams.get('mistenkelige') !== 'false';
	const since = new Date(Date.now() - MILESTONE_HISTORY_DAYS * 86_400_000);

	try {
		// Rå lesing er riktig her: vi trenger id-en for å kunne slette, og
		// `toWeightMeasurements` kaster den. Vekta leses som ett felt med én betydning
		// gjennom historikken — det er kroppssammensetningen som er tvetydig, og den
		// brukes ikke her. Fila står i `knownRawReaders` med den begrunnelsen.
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

		const weightRows: WeightRow[] = [];
		for (const row of rows) {
			const weight = (row.data as { weight?: unknown } | null)?.weight;
			if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0) continue;
			weightRows.push({
				id: row.id,
				date: osloDayKey(row.timestamp),
				weightKg: weight,
				source: row.provider ?? null
			});
		}

		if (onlySuspicious) {
			const outliers = findWeightOutliers(weightRows);
			return json({ mistenkelige: true, total: weightRows.length, maalinger: outliers });
		}

		return json({
			mistenkelige: false,
			total: weightRows.length,
			truncated: weightRows.length > MAX_ROWS,
			maalinger: weightRows.slice(-MAX_ROWS)
		});
	} catch (err) {
		console.error('[vekt-maalinger] failed:', err);
		return json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
	}
};
