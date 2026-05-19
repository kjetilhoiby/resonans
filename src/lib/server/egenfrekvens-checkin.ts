import { db } from '$lib/db';
import { sensorEvents, sensors, users } from '$lib/db/schema';
import { and, desc, eq, sql } from 'drizzle-orm';
import { SensorEventService } from '$lib/server/services/sensor-event-service';
import {
	EGENFREKVENS_THRESHOLDS,
	isEgenfrekvensThemeName,
	type EgenfrekvensCheckinValues
} from '$lib/domains/egenfrekvens';

export class EgenfrekvensCheckinError extends Error {}

export type EgenfrekvensSlot = 'morning' | 'evening';

export function toIsoDay(date: Date = new Date()) {
	return date.toISOString().slice(0, 10);
}

// Map 1-5 quick level to historical balance range (-5..5) so eksisterende sparkline ikke brytes.
// 1 → -4, 2 → -2, 3 → 0, 4 → 2, 5 → 4
function levelToBalance(level: number): number {
	return (level - 3) * 2;
}

async function getOrCreateEgenfrekvensSensor(userId: string) {
	const existing = await db.query.sensors.findFirst({
		where: and(eq(sensors.userId, userId), eq(sensors.provider, 'egenfrekvens_checkin'))
	});
	if (existing) return existing;
	const [created] = await db
		.insert(sensors)
		.values({
			userId,
			provider: 'egenfrekvens_checkin',
			type: 'manual_log',
			subtype: 'egenfrekvens_daily',
			name: 'Egenfrekvens',
			isActive: true,
			config: { sliderRange: '0_5', balanceRange: [-5, 5] }
		})
		.returning();
	return created;
}

async function getOrCreateMoodSensor(userId: string) {
	const existing = await db.query.sensors.findFirst({
		where: and(eq(sensors.userId, userId), eq(sensors.provider, 'mood'))
	});
	if (existing) return existing;
	const [created] = await db
		.insert(sensors)
		.values({
			userId,
			provider: 'mood',
			type: 'manual_log',
			subtype: 'mood_daily',
			name: 'Humør',
			isActive: true,
			config: { range: [0, 10] }
		})
		.returning();
	return created;
}

export interface EgenfrekvensSlotEntry {
	eventId: string;
	mode: 'quick' | 'full';
	level: number | null;
	balance: number | null;
	thoughts: number | null;
	feelings: number | null;
	actions: number | null;
	note: string | null;
	reflection: string | null;
	extreme: boolean;
	timestamp: string;
}

export interface EgenfrekvensCheckinStatus {
	day: string;
	submitted: boolean;
	count: number;
	morning: EgenfrekvensSlotEntry | null;
	evening: EgenfrekvensSlotEntry | null;
	latest: EgenfrekvensSlotEntry | null;
	// Legacy flate felt — beholder fra siste full-event på dagen (eller siste event om kun quick)
	balance: number | null;
	thoughts: number | null;
	feelings: number | null;
	actions: number | null;
	note: string | null;
	reflection: string | null;
	extreme: boolean;
	eventId?: string | null;
}

export async function countEgenfrekvensCheckinsForDayAndSlot(
	userId: string,
	day: string,
	slot: EgenfrekvensSlot
): Promise<number> {
	const rows = await db
		.select({ id: sensorEvents.id })
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'egenfrekvens_checkin'),
				sql`${sensorEvents.data}->>'day' = ${day}`,
				sql`${sensorEvents.data}->>'slot' = ${slot}`
			)
		);
	return rows.length;
}

function rowToEntry(id: string, data: Record<string, unknown>, timestamp: Date): EgenfrekvensSlotEntry {
	const num = (v: unknown) => (typeof v === 'number' ? v : null);
	const str = (v: unknown) => (typeof v === 'string' ? v : null);
	const mode = data.mode === 'quick' ? 'quick' : 'full';
	return {
		eventId: id,
		mode,
		level: num(data.level),
		balance: num(data.balance),
		thoughts: num(data.thoughts),
		feelings: num(data.feelings),
		actions: num(data.actions),
		note: str(data.note),
		reflection: str(data.reflection),
		extreme: Boolean(data.extreme),
		timestamp: timestamp.toISOString()
	};
}

export async function getEgenfrekvensCheckinStatus(
	userId: string,
	day: string = toIsoDay()
): Promise<EgenfrekvensCheckinStatus> {
	const rows = await db
		.select({ id: sensorEvents.id, data: sensorEvents.data, timestamp: sensorEvents.timestamp })
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'egenfrekvens_checkin'),
				sql`${sensorEvents.data}->>'day' = ${day}`
			)
		)
		.orderBy(desc(sensorEvents.timestamp));

	let morning: EgenfrekvensSlotEntry | null = null;
	let evening: EgenfrekvensSlotEntry | null = null;
	let lastFull: EgenfrekvensSlotEntry | null = null;
	const latest = rows[0]
		? rowToEntry(rows[0].id, (rows[0].data ?? {}) as Record<string, unknown>, rows[0].timestamp)
		: null;

	for (const row of rows) {
		const data = (row.data ?? {}) as Record<string, unknown>;
		const entry = rowToEntry(row.id, data, row.timestamp);
		const slot = data.slot;
		// rows er sortert desc — første treff pr slot er nyeste
		if (slot === 'morning' && !morning) morning = entry;
		if (slot === 'evening' && !evening) evening = entry;
		if (entry.mode === 'full' && !lastFull) lastFull = entry;
	}

	const baseline = lastFull ?? latest;

	return {
		day,
		submitted: rows.length > 0,
		count: rows.length,
		morning,
		evening,
		latest,
		balance: baseline?.balance ?? null,
		thoughts: baseline?.thoughts ?? null,
		feelings: baseline?.feelings ?? null,
		actions: baseline?.actions ?? null,
		note: baseline?.note ?? null,
		reflection: baseline?.reflection ?? null,
		extreme: baseline?.extreme ?? false,
		eventId: baseline?.eventId ?? null
	};
}

function validateValues(values: EgenfrekvensCheckinValues) {
	const inRange = (n: number, lo: number, hi: number) => Number.isInteger(n) && n >= lo && n <= hi;
	if (!inRange(values.balance, -5, 5)) throw new EgenfrekvensCheckinError('Balanse må være et heltall fra -5 til +5.');
	if (!inRange(values.thoughts, 1, 5)) throw new EgenfrekvensCheckinError('Tanker må være et heltall fra 1 til 5.');
	if (!inRange(values.feelings, 1, 5)) throw new EgenfrekvensCheckinError('Følelser må være et heltall fra 1 til 5.');
	if (!inRange(values.actions, 1, 5)) throw new EgenfrekvensCheckinError('Handlinger må være et heltall fra 1 til 5.');
}

function validateSlot(slot: unknown): EgenfrekvensSlot {
	if (slot !== 'morning' && slot !== 'evening') {
		throw new EgenfrekvensCheckinError('Slot må være "morning" eller "evening".');
	}
	return slot;
}

export async function submitEgenfrekvensCheckin(params: {
	userId: string;
	balance: number;
	thoughts: number;
	feelings: number;
	actions: number;
	slot?: EgenfrekvensSlot | null;
	note?: string | null;
	reflection?: string | null;
	reflectionThread?: Array<{ role: string; text: string }> | null;
	reasons?: Record<string, string[]> | null;
	day?: string;
}): Promise<EgenfrekvensCheckinStatus> {
	validateValues(params);
	const day = params.day || toIsoDay();
	const cleanNote = params.note?.trim() || null;
	const cleanReflection = params.reflection?.trim() || null;
	const extreme = EGENFREKVENS_THRESHOLDS.reflectIf(params);
	const slot = params.slot ?? null;

	const sensor = await getOrCreateEgenfrekvensSensor(params.userId);
	const moodSensor = await getOrCreateMoodSensor(params.userId);

	const payload: Record<string, unknown> = {
		day,
		mode: 'full',
		balance: params.balance,
		thoughts: params.thoughts,
		feelings: params.feelings,
		actions: params.actions,
		note: cleanNote,
		reflection: cleanReflection,
		extreme
	};
	if (slot) payload.slot = slot;
	if (params.reasons && Object.keys(params.reasons).length > 0) {
		payload.reasons = params.reasons;
	}
	if (params.reflectionThread && params.reflectionThread.length > 0) {
		payload.reflectionThread = params.reflectionThread;
	}

	const writeResult = await SensorEventService.write({
		userId: params.userId,
		sensorId: sensor.id,
		eventType: 'measurement',
		dataType: 'egenfrekvens_checkin',
		timestamp: new Date(),
		data: payload,
		source: 'egenfrekvens_ui'
	});

	// Mirror balance to mood (0..10) so existing mood widgets keep working.
	await SensorEventService.write(
		{
			userId: params.userId,
			sensorId: moodSensor.id,
			eventType: 'measurement',
			dataType: 'mood',
			timestamp: new Date(),
			data: { day, rating: params.balance + 5, source: 'egenfrekvens', slot },
			source: 'egenfrekvens_ui'
		},
		{ conflictMode: 'ignore' }
	);

	const status = await getEgenfrekvensCheckinStatus(params.userId, day);
	return { ...status, eventId: writeResult.event?.id ?? null };
}

export async function submitEgenfrekvensQuick(params: {
	userId: string;
	level: number;
	slot: EgenfrekvensSlot;
	note?: string | null;
	day?: string;
}): Promise<EgenfrekvensCheckinStatus> {
	const level = Number(params.level);
	if (!Number.isInteger(level) || level < 1 || level > 5) {
		throw new EgenfrekvensCheckinError('Nivå må være et heltall fra 1 til 5.');
	}
	const slot = validateSlot(params.slot);
	const day = params.day || toIsoDay();
	const cleanNote = params.note?.trim() || null;
	const balance = levelToBalance(level);
	const extreme = EGENFREKVENS_THRESHOLDS.reflectIf({
		balance,
		thoughts: level,
		feelings: level,
		actions: level
	});

	const sensor = await getOrCreateEgenfrekvensSensor(params.userId);
	const moodSensor = await getOrCreateMoodSensor(params.userId);

	const payload: Record<string, unknown> = {
		day,
		mode: 'quick',
		slot,
		level,
		balance,
		note: cleanNote,
		extreme
	};

	const writeResult = await SensorEventService.write({
		userId: params.userId,
		sensorId: sensor.id,
		eventType: 'measurement',
		dataType: 'egenfrekvens_checkin',
		timestamp: new Date(),
		data: payload,
		source: 'egenfrekvens_quick_ui'
	});

	await SensorEventService.write(
		{
			userId: params.userId,
			sensorId: moodSensor.id,
			eventType: 'measurement',
			dataType: 'mood',
			timestamp: new Date(),
			data: { day, rating: level * 2, source: 'egenfrekvens_quick', slot },
			source: 'egenfrekvens_quick_ui'
		},
		{ conflictMode: 'ignore' }
	);

	const status = await getEgenfrekvensCheckinStatus(params.userId, day);
	return { ...status, eventId: writeResult.event?.id ?? null };
}

/**
 * Auto-aktiverer egenfrekvens-sjekkin i notification-settings hvis temaet
 * tilhører Egenfrekvens-domenet og brukeren ikke har gjort et eksplisitt valg.
 * Kalles fra theme creation paths.
 */
export async function maybeActivateEgenfrekvensCheckin(
	userId: string,
	theme: { name: string; parentTheme?: string | null }
) {
	if (!isEgenfrekvensThemeName(theme)) return;

	const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
	if (!user) return;
	const settings = (user.notificationSettings ?? {}) as Record<string, any>;

	if (settings.egenfrekvensCheckin !== undefined) return; // respect explicit user choice

	const next = {
		...settings,
		egenfrekvensCheckin: { enabled: true, morningTime: '06:30', eveningTime: '21:00' }
	};
	await db
		.update(users)
		.set({ notificationSettings: next, updatedAt: new Date() })
		.where(eq(users.id, userId));
}
