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

function validateFullValues(values: { level: number; thoughts: number; feelings: number; actions: number }) {
	const inRange = (n: number, lo: number, hi: number) => Number.isInteger(n) && n >= lo && n <= hi;
	if (!inRange(values.level, 1, 5)) throw new EgenfrekvensCheckinError('Nivå må være et heltall fra 1 til 5.');
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

function parseUntilDate(value: unknown): string | null {
	if (value === null || value === undefined || value === '') return null;
	if (typeof value !== 'string') return null;
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
	return value;
}

export async function submitEgenfrekvensCheckin(params: {
	userId: string;
	level: number;
	thoughts: number;
	feelings: number;
	actions: number;
	slot?: EgenfrekvensSlot | null;
	note?: string | null;
	reflection?: string | null;
	reflectionThread?: Array<{ role: string; text: string }> | null;
	reasons?: Record<string, string[]> | null;
	day?: string;
	sickUntil?: string | null;
	crunchUntil?: string | null;
}): Promise<EgenfrekvensCheckinStatus> {
	validateFullValues(params);
	const day = params.day || toIsoDay();
	const cleanNote = params.note?.trim() || null;
	const cleanReflection = params.reflection?.trim() || null;
	const balance = levelToBalance(params.level);
	const extreme = EGENFREKVENS_THRESHOLDS.reflectIf({
		balance,
		thoughts: params.thoughts,
		feelings: params.feelings,
		actions: params.actions
	});
	const slot = params.slot ?? null;

	const sensor = await getOrCreateEgenfrekvensSensor(params.userId);
	const moodSensor = await getOrCreateMoodSensor(params.userId);

	const sickUntil = parseUntilDate(params.sickUntil);
	const crunchUntil = parseUntilDate(params.crunchUntil);

	const payload: Record<string, unknown> = {
		day,
		mode: 'full',
		level: params.level,
		balance, // derivert fra level for kompatibilitet med eksisterende dashboard-data
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
	// Tilstand-flagg: bare lagre hvis bruker satte en dato. Tom verdi
	// betyr "ikke aktivt akkurat nå". Vi nullstiller eksplisitt med 'cleared'-marker
	// slik at readiness-service kan skille "ikke rapportert" fra "rapportert som av".
	if (params.sickUntil === '' || params.sickUntil === null) payload.sickUntil = null;
	else if (sickUntil) payload.sickUntil = sickUntil;
	if (params.crunchUntil === '' || params.crunchUntil === null) payload.crunchUntil = null;
	else if (crunchUntil) payload.crunchUntil = crunchUntil;

	const writeResult = await SensorEventService.write({
		userId: params.userId,
		sensorId: sensor.id,
		eventType: 'measurement',
		dataType: 'egenfrekvens_checkin',
		timestamp: new Date(),
		data: payload,
		source: 'egenfrekvens_ui'
	});

	// Mirror level til mood (0..10) så eksisterende mood-widgets fortsetter å virke.
	await SensorEventService.write(
		{
			userId: params.userId,
			sensorId: moodSensor.id,
			eventType: 'measurement',
			dataType: 'mood',
			timestamp: new Date(),
			data: { day, rating: params.level * 2, source: 'egenfrekvens', slot },
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
	sickUntil?: string | null;
	crunchUntil?: string | null;
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

	const sickUntilQuick = parseUntilDate(params.sickUntil);
	const crunchUntilQuick = parseUntilDate(params.crunchUntil);

	const payload: Record<string, unknown> = {
		day,
		mode: 'quick',
		slot,
		level,
		balance,
		note: cleanNote,
		extreme
	};
	if (params.sickUntil === '' || params.sickUntil === null) payload.sickUntil = null;
	else if (sickUntilQuick) payload.sickUntil = sickUntilQuick;
	if (params.crunchUntil === '' || params.crunchUntil === null) payload.crunchUntil = null;
	else if (crunchUntilQuick) payload.crunchUntil = crunchUntilQuick;

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

export interface EgenfrekvensStateFlags {
	sick: { active: boolean; until: string | null };
	crunch: { active: boolean; until: string | null };
	level: number | null;
	balance: number | null;
	loggedAt: string | null;
}

/**
 * Henter aktive tilstand-flagg basert på siste egenfrekvens-checkin.
 * Sick/crunch er aktive så lenge dagens ISO-dato ≤ sickUntil/crunchUntil.
 * Hvis siste checkin har sickUntil=null betyr det at bruker eksplisitt klarerte
 * status — flagget er av selv om det var satt før.
 */
export async function getActiveEgenfrekvensFlags(
	userId: string,
	today: string = toIsoDay()
): Promise<EgenfrekvensStateFlags> {
	const result: EgenfrekvensStateFlags = {
		sick: { active: false, until: null },
		crunch: { active: false, until: null },
		level: null,
		balance: null,
		loggedAt: null
	};

	// Nyeste egenfrekvens-checkin gir level/balance (og kan inneholde sick/crunch
	// som rapportert da check-in ble gjort).
	const checkinRows = await db
		.select({ data: sensorEvents.data, timestamp: sensorEvents.timestamp })
		.from(sensorEvents)
		.where(and(eq(sensorEvents.userId, userId), eq(sensorEvents.dataType, 'egenfrekvens_checkin')))
		.orderBy(desc(sensorEvents.timestamp))
		.limit(1);

	if (checkinRows.length > 0) {
		const row = checkinRows[0];
		const data = (row.data ?? {}) as Record<string, unknown>;
		const level = typeof data.level === 'number' ? data.level : null;
		const balance = typeof data.balance === 'number' ? data.balance : null;
		result.level = level;
		result.balance = balance;
		result.loggedAt = row.timestamp.toISOString();

		const sickUntil = typeof data.sickUntil === 'string' ? data.sickUntil : null;
		const crunchUntil = typeof data.crunchUntil === 'string' ? data.crunchUntil : null;
		if (sickUntil && sickUntil >= today) {
			result.sick = { active: true, until: sickUntil };
		}
		if (crunchUntil && crunchUntil >= today) {
			result.crunch = { active: true, until: crunchUntil };
		}
	}

	// Nyere dedikert tilstand_flag-events overstyrer (bruker oppdaterte uten å gjøre full check-in).
	const flagRows = await db
		.select({ data: sensorEvents.data, timestamp: sensorEvents.timestamp })
		.from(sensorEvents)
		.where(and(eq(sensorEvents.userId, userId), eq(sensorEvents.dataType, 'tilstand_flag')))
		.orderBy(desc(sensorEvents.timestamp))
		.limit(1);

	if (flagRows.length > 0) {
		const row = flagRows[0];
		const flagTs = row.timestamp.toISOString();
		// Bare overstyr hvis tilstand_flag er nyere enn nyeste egenfrekvens-checkin
		if (!result.loggedAt || flagTs > result.loggedAt) {
			const data = (row.data ?? {}) as Record<string, unknown>;
			const sickUntil = typeof data.sickUntil === 'string' ? data.sickUntil : null;
			const crunchUntil = typeof data.crunchUntil === 'string' ? data.crunchUntil : null;
			result.sick = sickUntil && sickUntil >= today
				? { active: true, until: sickUntil }
				: { active: false, until: null };
			result.crunch = crunchUntil && crunchUntil >= today
				? { active: true, until: crunchUntil }
				: { active: false, until: null };
		}
	}

	return result;
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
