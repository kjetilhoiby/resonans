/**
 * Vektbackfill fra Apple Health.
 *
 * Ekko leser vekthistorikken fra HealthKit på telefonen og sender den hit i
 * bolker. Det er en **engangsjobb** for perioden før oktober 2017 — ikke en
 * løpende synk. Withings dekker alt fra 13. oktober 2017 og skal fortsette å
 * gjøre det. Kontrakten står i `docs/ekko-healthkit-vekt-backfill.md`.
 *
 * `/api/apps/event` finnes allerede, men tar én hendelse per kall. Fire tusen
 * målinger er fire tusen rundturer, og det er feil verktøy — derfor et eget
 * endepunkt med bolker.
 *
 * Tolkningen bor i `$lib/domain/health/healthkit-weight`; her ligger bare
 * sensoren, dedup-oppslaget og skrivingen.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { and, eq, gte, lte, ne } from 'drizzle-orm';
import { db } from '$lib/db';
import { sensorEvents, sensors } from '$lib/db/schema';
import { getAppConfig } from '$lib/server/app-registry';
import { SensorEventService } from '$lib/server/services/sensor-event-service';
import { osloDayKey } from '$lib/domain/oslo-time';
import {
	dayRange,
	existingDayLookupWindow,
	importWarnings,
	MAX_SAMPLES_PER_REQUEST,
	parseHealthKitWeightSamples,
	partitionByBlockedDays,
	type HealthKitWeightSample
} from '$lib/domain/health/healthkit-weight';

const APP_ID = 'healthkit';

/** Skrivebolk mot basen. Uavhengig av bolkstørrelsen Ekko sender. */
const WRITE_BATCH_SIZE = 100;

async function getOrCreateSensor(userId: string): Promise<string> {
	const app = getAppConfig(APP_ID)!;

	const existing = await db.query.sensors.findFirst({
		columns: { id: true },
		where: and(eq(sensors.userId, userId), eq(sensors.provider, app.sensorProvider))
	});
	if (existing) return existing.id;

	const [created] = await db
		.insert(sensors)
		.values({
			userId,
			provider: app.sensorProvider,
			type: app.sensorType,
			subtype: app.sensorSubtype,
			name: app.label,
			isActive: true
		})
		.returning({ id: sensors.id });

	return created.id;
}

/**
 * Oslo-dager som allerede har en vektmåling fra en **annen** sensor.
 *
 * Rå lesing av `data_type = 'weight'` er riktig her: vi spør om en rad *finnes*
 * på en dag, ikke hva den måler. `normalizeBodyComposition` ville ikke endret
 * svaret, og en delt leser som tolker verdiene ville kostet en full historikk-
 * lesing for et eksistensspørsmål. Fila står i `knownRawReaders` i
 * `sensor-event-access.ts` med den begrunnelsen.
 */
async function blockedOsloDays(
	userId: string,
	healthkitSensorId: string,
	samples: readonly HealthKitWeightSample[]
): Promise<Set<string>> {
	const window = existingDayLookupWindow(samples);
	if (!window) return new Set();

	const rows = await db
		.select({ timestamp: sensorEvents.timestamp })
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'weight'),
				// Egne rader blokkerer ikke — ellers ville en gjensendt bolk telt som
				// «dagen finnes allerede» og importen sett ut som en no-op.
				ne(sensorEvents.sensorId, healthkitSensorId),
				gte(sensorEvents.timestamp, window.from),
				lte(sensorEvents.timestamp, window.to)
			)
		);

	return new Set(rows.map((row) => osloDayKey(row.timestamp)));
}

export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	if (!userId) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const rawSamples = (body as { samples?: unknown })?.samples;
	if (!Array.isArray(rawSamples)) {
		return json({ error: 'Missing "samples" array' }, { status: 400 });
	}
	if (rawSamples.length > MAX_SAMPLES_PER_REQUEST) {
		return json(
			{
				error: `Too many samples: ${rawSamples.length}. Max ${MAX_SAMPLES_PER_REQUEST} per request.`,
				maxSamples: MAX_SAMPLES_PER_REQUEST
			},
			{ status: 413 }
		);
	}

	const parsed = parseHealthKitWeightSamples(rawSamples);
	const warnings = importWarnings(parsed);

	if (parsed.samples.length === 0) {
		console.log(
			`[healthkit-weight] user=${userId} received=${rawSamples.length} written=0 invalid=${parsed.invalid}`
		);
		return json({
			received: rawSamples.length,
			inserted: 0,
			skippedExistingDay: 0,
			skippedInvalid: rawSamples.length - parsed.samples.length,
			oldest: null,
			newest: null,
			warnings
		});
	}

	try {
		const sensorId = await getOrCreateSensor(userId);
		const blocked = await blockedOsloDays(userId, sensorId, parsed.samples);
		const { write, skippedExistingDay } = partitionByBlockedDays(parsed.samples, blocked);

		let written = 0;
		for (let i = 0; i < write.length; i += WRITE_BATCH_SIZE) {
			const results = await SensorEventService.writeMany(
				write.slice(i, i + WRITE_BATCH_SIZE).map((sample) => ({
					userId,
					sensorId,
					eventType: 'measurement',
					dataType: 'weight',
					timestamp: sample.timestamp,
					data: sample.data,
					metadata: { ...sample.metadata, sourceApp: APP_ID },
					source: 'healthkit_weight_backfill'
				})),
				// Idempotent: samme bolk sendt to ganger oppdaterer framfor å duplisere,
				// så en avbrutt import kan begynne forfra. `ignore` ville låst en rad
				// fast i sin første, mulig feilrettede, utgave.
				{ conflictMode: 'upsert_sensor_datatype_timestamp' }
			);
			written += results.length;
		}

		const range = dayRange(write);
		const skippedInvalid = rawSamples.length - parsed.samples.length;

		console.log(
			`[healthkit-weight] user=${userId} received=${rawSamples.length} written=${written} ` +
				`skippedExistingDay=${skippedExistingDay} skippedInvalid=${skippedInvalid} ` +
				`range=${range ? `${range.oldest}..${range.newest}` : 'none'}`
		);

		return json({
			received: rawSamples.length,
			// Rader skrevet under healthkit-sensoren, talt fra det basen returnerte.
			// En gjensendt bolk gir samme tall — radene oppdateres framfor å
			// dupliseres, og «0» ville sett ut som en feil.
			inserted: written,
			skippedExistingDay,
			skippedInvalid,
			// Spennet i Oslo-døgn for radene som faktisk ble skrevet.
			oldest: range?.oldest ?? null,
			newest: range?.newest ?? null,
			warnings
		});
	} catch (err) {
		console.error('[healthkit-weight] import failed:', err);
		return json(
			{ error: err instanceof Error ? err.message : 'Import failed' },
			{ status: 500 }
		);
	}
};
