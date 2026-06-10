/**
 * rescuetime.ts
 *
 * RescueTime som produktivitets-sensor for PC-skjermen (komplement til iOS
 * Skjermtid). Enkel API-nøkkel-auth — ingen OAuth. Nøkkelen lagres per bruker
 * i sensors.credentials (base64 JSON, samme mønster som Withings-tokens).
 *
 * Datamodell (ingen DB-skjemaendring):
 *  - dataType 'rescuetime_day' → én event per kalenderdag (timestamp = lokal
 *    middag, samme nøkkel-konvensjon som screen_time). data = RescueTimeDayData.
 *
 * Sync henter time-oppløste aktivitetsrader for et datointervall og skriver
 * upsert per dag — en delvis dag i dag overskrives av neste sync.
 */

import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { SensorEventService } from '$lib/server/services/sensor-event-service';
import { aggregatePeriodsFrom } from './aggregation';
import { dayTimestamp } from './screen-time';
import { parseRescueTimeRows } from './rescuetime-parser';
import type { RescueTimeApiRow } from './rescuetime-parser';

export const RESCUETIME_PROVIDER = 'rescuetime';
export const RESCUETIME_DAY_DATATYPE = 'rescuetime_day';

const API_BASE = 'https://www.rescuetime.com/anapi/data';

/* ── Sensor ──────────────────────────────────────────────── */

async function findRescueTimeSensor(userId: string) {
	return db.query.sensors.findFirst({
		where: and(eq(sensors.provider, RESCUETIME_PROVIDER), eq(sensors.userId, userId))
	});
}

function encodeCredentials(apiKey: string): string {
	return btoa(JSON.stringify({ api_key: apiKey }));
}

function decodeApiKey(credentials: string | null): string | null {
	if (!credentials) return null;
	try {
		const parsed = JSON.parse(atob(credentials));
		return typeof parsed.api_key === 'string' ? parsed.api_key : null;
	} catch {
		return null;
	}
}

/** Validerer nøkkelen mot API-et og oppretter/oppdaterer sensoren */
export async function connectRescueTime(userId: string, apiKey: string): Promise<{ sensorId: string }> {
	await fetchRescueTimeRows(apiKey, localISODate(new Date()), localISODate(new Date()));

	const existing = await findRescueTimeSensor(userId);
	if (existing) {
		await db
			.update(sensors)
			.set({ credentials: encodeCredentials(apiKey), isActive: true, lastError: null })
			.where(eq(sensors.id, existing.id));
		return { sensorId: existing.id };
	}

	const [created] = await db
		.insert(sensors)
		.values({
			userId,
			provider: RESCUETIME_PROVIDER,
			type: 'productivity_tracker',
			subtype: 'rescuetime',
			name: 'RescueTime',
			credentials: encodeCredentials(apiKey),
			isActive: true,
			config: { source: 'rescuetime_api' }
		})
		.returning({ id: sensors.id });
	return { sensorId: created.id };
}

/* ── API ─────────────────────────────────────────────────── */

async function fetchRescueTimeRows(
	apiKey: string,
	beginISO: string,
	endISO: string
): Promise<RescueTimeApiRow[]> {
	const params = new URLSearchParams({
		key: apiKey,
		format: 'json',
		perspective: 'interval',
		resolution_time: 'hour',
		restrict_kind: 'activity',
		restrict_begin: beginISO,
		restrict_end: endISO
	});

	const res = await fetch(`${API_BASE}?${params}`);
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(`RescueTime API ${res.status}: ${body.slice(0, 200)}`);
	}

	const json = (await res.json()) as { rows?: RescueTimeApiRow[]; error?: string };
	if (json.error) throw new Error(`RescueTime API: ${json.error}`);
	return json.rows ?? [];
}

/** Dagens dato i Oslo-tid (serveren kjører UTC) */
function localISODate(now: Date): string {
	return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo' }).format(now);
}

function isoDateDaysAgo(now: Date, days: number): string {
	return localISODate(new Date(now.getTime() - days * 24 * 60 * 60 * 1000));
}

/* ── Sync ────────────────────────────────────────────────── */

export interface RescueTimeSyncResult {
	days: number;
	totalSeconds: number;
	from: string;
	to: string;
}

/** Henter og lagrer de siste `days` dagene (inkludert i dag) for brukeren */
export async function syncRescueTime(userId: string, options?: { days?: number }): Promise<RescueTimeSyncResult> {
	const sensor = await findRescueTimeSensor(userId);
	if (!sensor || !sensor.isActive) {
		throw new Error('Ingen aktiv RescueTime-sensor for brukeren.');
	}
	const apiKey = decodeApiKey(sensor.credentials);
	if (!apiKey) {
		throw new Error('RescueTime-sensoren mangler gyldig API-nøkkel.');
	}

	const now = new Date();
	const days = Math.min(Math.max(options?.days ?? 3, 1), 90);
	const from = isoDateDaysAgo(now, days - 1);
	const to = localISODate(now);

	try {
		const rows = await fetchRescueTimeRows(apiKey, from, to);
		const parsedDays = parseRescueTimeRows(rows);

		let earliest: Date | null = null;
		for (const day of parsedDays) {
			const ts = dayTimestamp(day.dateISO);
			if (!earliest || ts < earliest) earliest = ts;
			await SensorEventService.write(
				{
					userId,
					sensorId: sensor.id,
					eventType: 'measurement',
					dataType: RESCUETIME_DAY_DATATYPE,
					timestamp: ts,
					data: day as unknown as Record<string, unknown>,
					source: 'rescuetime_api'
				},
				{ conflictMode: 'upsert_sensor_datatype_timestamp' }
			);
		}

		if (earliest) {
			await aggregatePeriodsFrom(userId, new Date(earliest.getTime() - 1000));
		}

		await db
			.update(sensors)
			.set({ lastSync: now, lastError: null })
			.where(eq(sensors.id, sensor.id));

		return {
			days: parsedDays.length,
			totalSeconds: parsedDays.reduce((sum, d) => sum + d.totalSeconds, 0),
			from,
			to
		};
	} catch (error) {
		await db
			.update(sensors)
			.set({ lastError: error instanceof Error ? error.message : String(error) })
			.where(eq(sensors.id, sensor.id));
		throw error;
	}
}
