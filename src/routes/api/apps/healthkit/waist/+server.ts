/**
 * Livviddebackfill fra Apple Health.
 *
 * `HKQuantityTypeIdentifierWaistCircumference` er en standardtype i HealthKit, så
 * en bruker som har målt livvidde i en annen app kan ha år med historikk på
 * telefonen. Dette er den **eneste** veien inn til dem: livvidde finnes ikke i
 * Withings' API i det hele tatt, og ingen sensor vi har kan måle den.
 *
 * Tolkningen bor i `$lib/domain/health/healthkit-waist`.
 *
 * ## Hvorfor ingen dagnivå-dedup, i motsetning til vektimporten
 *
 * Vekt har en konkurrerende kilde: Health Mate skriver Withings-veiingene til
 * Apple Health også, så eksporten inneholder rader vi alt har. Livvidde har ingen
 * slik kilde — Withings måler den ikke. En manuell logging og en HealthKit-måling
 * samme dag er derfor **to reelle målinger**, og `dailyWaist` snitter dem, som er
 * nøyaktig det protokollen ber om («mål to ganger og logg begge»).
 *
 * Idempotensen ligger i `upsert_sensor_datatype_timestamp`: samme bolk sendt to
 * ganger oppdaterer framfor å duplisere.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { getAppConfig } from '$lib/server/app-registry';
import { SensorEventService } from '$lib/server/services/sensor-event-service';
import { WAIST_DATA_TYPE } from '$lib/server/health/waist-log';
import {
	MAX_WAIST_SAMPLES_PER_REQUEST,
	parseHealthKitWaistSamples,
	waistDayRange,
	waistImportWarnings
} from '$lib/domain/health/healthkit-waist';

const APP_ID = 'healthkit';

/** Skrivebolk mot basen. Uavhengig av bolkstørrelsen Ekko sender. */
const WRITE_BATCH_SIZE = 100;

/**
 * Samme sensor som vektimporten bruker.
 *
 * Én `healthkit`-sensor, flere `dataType`. Det gjør at importen står som **én**
 * kilde i `/settings/sources` framfor to, og at hele den kan angres ved å slette
 * én sensors hendelser.
 */
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
	if (rawSamples.length > MAX_WAIST_SAMPLES_PER_REQUEST) {
		return json(
			{
				error: `Too many samples: ${rawSamples.length}. Max ${MAX_WAIST_SAMPLES_PER_REQUEST} per request.`,
				maxSamples: MAX_WAIST_SAMPLES_PER_REQUEST
			},
			{ status: 413 }
		);
	}

	const parsed = parseHealthKitWaistSamples(rawSamples);
	const warnings = waistImportWarnings(parsed);

	if (parsed.samples.length === 0) {
		console.log(
			`[healthkit-waist] user=${userId} received=${rawSamples.length} written=0 invalid=${parsed.invalid}`
		);
		return json({
			received: rawSamples.length,
			inserted: 0,
			skippedInvalid: rawSamples.length - parsed.samples.length,
			oldest: null,
			newest: null,
			warnings
		});
	}

	try {
		const sensorId = await getOrCreateSensor(userId);

		let written = 0;
		for (let i = 0; i < parsed.samples.length; i += WRITE_BATCH_SIZE) {
			const results = await SensorEventService.writeMany(
				parsed.samples.slice(i, i + WRITE_BATCH_SIZE).map((sample) => ({
					userId,
					sensorId,
					eventType: 'measurement',
					dataType: WAIST_DATA_TYPE,
					timestamp: sample.timestamp,
					data: sample.data,
					metadata: { ...sample.metadata, sourceApp: APP_ID },
					source: 'healthkit_waist_backfill'
				})),
				{ conflictMode: 'upsert_sensor_datatype_timestamp' }
			);
			written += results.length;
		}

		const range = waistDayRange(parsed.samples);
		const skippedInvalid = rawSamples.length - parsed.samples.length;

		console.log(
			`[healthkit-waist] user=${userId} received=${rawSamples.length} written=${written} ` +
				`skippedInvalid=${skippedInvalid} range=${range.oldest}..${range.newest}`
		);

		return json({
			received: rawSamples.length,
			inserted: written,
			skippedInvalid,
			...range,
			warnings
		});
	} catch (err) {
		console.error('[healthkit-waist] import feilet:', err);
		return json(
			{ error: err instanceof Error ? err.message : 'Import feilet' },
			{ status: 500 }
		);
	}
};
