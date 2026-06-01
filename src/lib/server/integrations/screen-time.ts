/**
 * screen-time.ts
 *
 * Skjermtid som helse-sensor. Brukeren legger inn iOS Skjermtid-skjermbilder
 * (uke- og dagsbilder) som tolkes av vision og lagres som sensor_events.
 *
 * Datamodell (ingen DB-skjemaendring — sensor_events.dataType/data er fritekst/JSONB):
 *  - dataType 'screen_time'      → én event per dag (timestamp = lokal middag den dagen)
 *  - dataType 'screen_time_week' → én event per ISO-uke (timestamp = mandag middag)
 *
 * Uke-bildet skriver 1 ukesoppsummering + 7 dags-totaler (merge-bevarende: en dag
 * som allerede har detaljert dagsdata blir ikke overskrevet av et grovt ukestall).
 * Dags-bildet skriver én detaljert dag (kategorier + apper + time-for-time) som
 * overstyrer ukens grovtall for den dagen.
 */

import { db } from '$lib/db';
import { sensors, sensorEvents } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { SensorEventService } from '$lib/server/services/sensor-event-service';
import { aggregatePeriodsFrom } from './aggregation';

export const SCREEN_TIME_DATATYPE = 'screen_time';
export const SCREEN_TIME_WEEK_DATATYPE = 'screen_time_week';

/** Kanoniske kategorinøkler. `social` er proxy for «scrolling». */
export type ScreenTimeCategory =
	| 'social'
	| 'entertainment'
	| 'productivity'
	| 'games'
	| 'creativity'
	| 'information'
	| 'health'
	| 'travel'
	| 'utilities'
	| 'education'
	| 'shopping'
	| 'other';

export type ScreenTimeCategories = Partial<Record<ScreenTimeCategory, number>>;

export interface ScreenTimeHourBucket {
	hour: number; // 0..23 (lokal tid)
	totalMinutes: number;
	categories?: ScreenTimeCategories;
}

export interface ScreenTimeDailyData {
	totalMinutes: number;
	captureType: 'daily' | 'weekly';
	categories?: ScreenTimeCategories;
	apps?: Record<string, number>;
	hourly?: ScreenTimeHourBucket[];
	sourceImageUrl?: string;
}

export interface ScreenTimeWeeklyData {
	weekTotalMinutes?: number;
	avgPerDayMinutes?: number;
	percentChange?: number; // f.eks. +20 (fra forrige uke)
	categories?: ScreenTimeCategories;
	apps?: Record<string, number>;
	dailyTotals?: number[]; // [man..søn], minutter
	sourceImageUrl?: string;
}

/** Norske iOS-kategorinavn → kanonisk nøkkel. */
const CATEGORY_LABEL_MAP: Record<string, ScreenTimeCategory> = {
	sosialt: 'social',
	'sosiale medier': 'social',
	social: 'social',
	underholdning: 'entertainment',
	entertainment: 'entertainment',
	'produktivitet og finans': 'productivity',
	produktivitet: 'productivity',
	finans: 'productivity',
	productivity: 'productivity',
	spill: 'games',
	games: 'games',
	kreativitet: 'creativity',
	creativity: 'creativity',
	'informasjon og lesing': 'information',
	lesing: 'information',
	information: 'information',
	'helse og trening': 'health',
	helse: 'health',
	health: 'health',
	reise: 'travel',
	travel: 'travel',
	'verktøy og hjelpemidler': 'utilities',
	verktøy: 'utilities',
	utilities: 'utilities',
	utdanning: 'education',
	education: 'education',
	shopping: 'shopping',
	'shopping og mat': 'shopping',
	annet: 'other',
	other: 'other'
};

/** Lesbare norske etiketter for kanoniske nøkler (UI). */
export const SCREEN_TIME_CATEGORY_LABELS: Record<ScreenTimeCategory, string> = {
	social: 'Sosialt',
	entertainment: 'Underholdning',
	productivity: 'Produktivitet og finans',
	games: 'Spill',
	creativity: 'Kreativitet',
	information: 'Informasjon og lesing',
	health: 'Helse og trening',
	travel: 'Reise',
	utilities: 'Verktøy',
	education: 'Utdanning',
	shopping: 'Shopping',
	other: 'Annet'
};

export function normalizeCategoryKey(label: string): ScreenTimeCategory {
	const key = label.trim().toLowerCase();
	return CATEGORY_LABEL_MAP[key] ?? 'other';
}

/** Slå sammen en rå kategori-record (norske eller engelske nøkler) til kanonisk form. */
export function normalizeCategories(
	raw: Record<string, number> | undefined | null
): ScreenTimeCategories | undefined {
	if (!raw) return undefined;
	const out: ScreenTimeCategories = {};
	for (const [label, minutes] of Object.entries(raw)) {
		if (typeof minutes !== 'number' || !Number.isFinite(minutes)) continue;
		const key = normalizeCategoryKey(label);
		out[key] = (out[key] ?? 0) + Math.max(0, Math.round(minutes));
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

/** «Scrolling» = sosiale medier-kategorien. */
export function scrollingMinutes(categories: ScreenTimeCategories | undefined): number {
	return categories?.social ?? 0;
}

/* ── Sensor ──────────────────────────────────────────────── */

export async function getOrCreateScreenTimeSensor(userId: string): Promise<string> {
	const existing = await db.query.sensors.findFirst({
		columns: { id: true },
		where: and(eq(sensors.provider, 'screen_time'), eq(sensors.userId, userId))
	});
	if (existing) return existing.id;

	const [created] = await db
		.insert(sensors)
		.values({
			userId,
			provider: 'screen_time',
			type: 'health_tracker',
			subtype: 'ios_screen_time',
			name: 'Skjermtid',
			isActive: true,
			config: { source: 'ios_screenshot' }
		})
		.returning({ id: sensors.id });
	return created.id;
}

/* ── Tidshjelpere (Europe/Oslo) ──────────────────────────── */

/** Lokal middag for en YYYY-MM-DD — stabil unik nøkkel per kalenderdag, trygt innenfor uke/dag-bøtter. */
export function dayTimestamp(dateISO: string): Date {
	const [y, m, d] = dateISO.split('-').map((n) => Number.parseInt(n, 10));
	return new Date(y, m - 1, d, 12, 0, 0, 0);
}

/** Mandag i ISO-uken som inneholder `ref` (lokal tid), som YYYY-MM-DD. */
export function isoWeekMondayISO(ref: Date): string {
	const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
	const day = (d.getDay() + 6) % 7; // 0 = mandag
	d.setDate(d.getDate() - day);
	return toISODate(d);
}

/** Mandag i forrige ISO-uke relativt til `ref`. */
export function previousIsoWeekMondayISO(ref: Date = new Date()): string {
	const thisMonday = isoWeekMondayISO(ref);
	const d = dayTimestamp(thisMonday);
	d.setDate(d.getDate() - 7);
	return toISODate(d);
}

function toISODate(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

/* ── Skriving ────────────────────────────────────────────── */

/**
 * Skriv/oppdater én dag. Ved `captureType: 'weekly'` bevares eksisterende detaljert
 * dagsdata (kategorier/apper/time-for-time) — kun totalen oppdateres hvis den mangler
 * eller dagen ikke allerede er detaljert.
 */
export async function recordScreenTimeDay(
	userId: string,
	dateISO: string,
	data: ScreenTimeDailyData,
	sensorId?: string
): Promise<Date> {
	const sid = sensorId ?? (await getOrCreateScreenTimeSensor(userId));
	const ts = dayTimestamp(dateISO);

	const existing = await db.query.sensorEvents.findFirst({
		where: and(
			eq(sensorEvents.sensorId, sid),
			eq(sensorEvents.dataType, SCREEN_TIME_DATATYPE),
			eq(sensorEvents.timestamp, ts)
		)
	});
	const existingData = (existing?.data as ScreenTimeDailyData | undefined) ?? undefined;
	const existingIsDaily = existingData?.captureType === 'daily';

	let merged: ScreenTimeDailyData;
	if (data.captureType === 'weekly' && existingIsDaily) {
		// Detaljert dag finnes allerede — ikke degrader. Behold alt, oppdater kun totalen
		// hvis ukesbildet har en verdi og dagen mangler en.
		merged = {
			...existingData!,
			totalMinutes: existingData!.totalMinutes || data.totalMinutes
		};
	} else if (data.captureType === 'daily') {
		// Detaljert dag vinner og beriker.
		merged = {
			...existingData,
			...data,
			categories: data.categories ?? existingData?.categories,
			apps: data.apps ?? existingData?.apps,
			hourly: data.hourly ?? existingData?.hourly
		};
	} else {
		// Ukesbilde, ingen detaljert dag fra før.
		merged = { ...existingData, ...data };
	}

	await SensorEventService.write(
		{
			userId,
			sensorId: sid,
			eventType: 'measurement',
			dataType: SCREEN_TIME_DATATYPE,
			timestamp: ts,
			data: merged as unknown as Record<string, unknown>,
			source: data.captureType === 'daily' ? 'screen_time_daily_screenshot' : 'screen_time_weekly_screenshot'
		},
		{ conflictMode: 'upsert_sensor_datatype_timestamp' }
	);

	return ts;
}

/**
 * Skriv et detaljert dagsbilde og re-aggreger berørt periode.
 */
export async function ingestDailyScreenTime(
	userId: string,
	dateISO: string,
	data: ScreenTimeDailyData
): Promise<{ dateISO: string }> {
	const sid = await getOrCreateScreenTimeSensor(userId);
	const ts = await recordScreenTimeDay(userId, dateISO, { ...data, captureType: 'daily' }, sid);
	await aggregatePeriodsFrom(userId, new Date(ts.getTime() - 1000));
	return { dateISO };
}

/**
 * Skriv et ukesbilde: 1 ukesoppsummering + opptil 7 dags-totaler.
 * `weekStartISO` = mandag i den aktuelle ISO-uken (default forrige uke).
 */
export async function ingestWeeklyScreenTime(
	userId: string,
	week: ScreenTimeWeeklyData,
	weekStartISO?: string
): Promise<{ weekStartISO: string; days: string[] }> {
	const sid = await getOrCreateScreenTimeSensor(userId);
	const mondayISO = weekStartISO ?? previousIsoWeekMondayISO();
	const mondayTs = dayTimestamp(mondayISO);

	// Ukesoppsummering
	await SensorEventService.write(
		{
			userId,
			sensorId: sid,
			eventType: 'measurement',
			dataType: SCREEN_TIME_WEEK_DATATYPE,
			timestamp: mondayTs,
			data: {
				weekTotalMinutes: week.weekTotalMinutes,
				avgPerDayMinutes: week.avgPerDayMinutes,
				percentChange: week.percentChange,
				categories: week.categories,
				apps: week.apps,
				dailyTotals: week.dailyTotals,
				sourceImageUrl: week.sourceImageUrl
			} as unknown as Record<string, unknown>,
			source: 'screen_time_weekly_screenshot'
		},
		{ conflictMode: 'upsert_sensor_datatype_timestamp' }
	);

	// Dags-totaler (merge-bevarende)
	const days: string[] = [];
	if (Array.isArray(week.dailyTotals)) {
		for (let i = 0; i < Math.min(7, week.dailyTotals.length); i++) {
			const minutes = week.dailyTotals[i];
			if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) continue;
			const d = new Date(mondayTs);
			d.setDate(d.getDate() + i);
			const dayISO = toISODate(d);
			await recordScreenTimeDay(
				userId,
				dayISO,
				{ totalMinutes: Math.round(minutes), captureType: 'weekly' },
				sid
			);
			days.push(dayISO);
		}
	}

	await aggregatePeriodsFrom(userId, new Date(mondayTs.getTime() - 1000));
	return { weekStartISO: mondayISO, days };
}

/** Formater minutter som «7t 3m» (norsk iOS-stil). */
export function formatScreenTime(minutes: number | undefined | null): string {
	if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) return '0m';
	const h = Math.floor(minutes / 60);
	const m = Math.round(minutes % 60);
	if (h <= 0) return `${m}m`;
	if (m <= 0) return `${h}t`;
	return `${h}t ${m}m`;
}
