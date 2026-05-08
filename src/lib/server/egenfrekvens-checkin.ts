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

export function toIsoDay(date: Date = new Date()) {
	return date.toISOString().slice(0, 10);
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

export interface EgenfrekvensCheckinStatus {
	day: string;
	submitted: boolean;
	balance: number | null;
	thoughts: number | null;
	feelings: number | null;
	actions: number | null;
	note: string | null;
	reflection: string | null;
	extreme: boolean;
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
		.orderBy(desc(sensorEvents.timestamp))
		.limit(1);

	const row = rows[0];
	const data = (row?.data ?? null) as Record<string, unknown> | null;

	const num = (v: unknown) => (typeof v === 'number' ? v : null);
	const str = (v: unknown) => (typeof v === 'string' ? v : null);

	return {
		day,
		submitted: Boolean(row),
		balance: num(data?.balance),
		thoughts: num(data?.thoughts),
		feelings: num(data?.feelings),
		actions: num(data?.actions),
		note: str(data?.note),
		reflection: str(data?.reflection),
		extreme: Boolean(data?.extreme)
	};
}

function validateValues(values: EgenfrekvensCheckinValues) {
	const inRange = (n: number, lo: number, hi: number) => Number.isInteger(n) && n >= lo && n <= hi;
	if (!inRange(values.balance, -5, 5)) throw new EgenfrekvensCheckinError('Balanse må være et heltall fra -5 til +5.');
	if (!inRange(values.thoughts, 0, 5)) throw new EgenfrekvensCheckinError('Tanker må være et heltall fra 0 til 5.');
	if (!inRange(values.feelings, 0, 5)) throw new EgenfrekvensCheckinError('Følelser må være et heltall fra 0 til 5.');
	if (!inRange(values.actions, 0, 5)) throw new EgenfrekvensCheckinError('Handlinger må være et heltall fra 0 til 5.');
}

export async function submitEgenfrekvensCheckin(params: {
	userId: string;
	balance: number;
	thoughts: number;
	feelings: number;
	actions: number;
	note?: string | null;
	reflection?: string | null;
	day?: string;
}): Promise<EgenfrekvensCheckinStatus> {
	validateValues(params);
	const day = params.day || toIsoDay();
	const cleanNote = params.note?.trim() || null;
	const cleanReflection = params.reflection?.trim() || null;
	const extreme = EGENFREKVENS_THRESHOLDS.reflectIf(params);

	const sensor = await getOrCreateEgenfrekvensSensor(params.userId);
	const moodSensor = await getOrCreateMoodSensor(params.userId);

	const payload = {
		day,
		balance: params.balance,
		thoughts: params.thoughts,
		feelings: params.feelings,
		actions: params.actions,
		note: cleanNote,
		reflection: cleanReflection,
		extreme
	};

	const existing = await db
		.select({ id: sensorEvents.id })
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, params.userId),
				eq(sensorEvents.dataType, 'egenfrekvens_checkin'),
				sql`${sensorEvents.data}->>'day' = ${day}`
			)
		)
		.orderBy(desc(sensorEvents.timestamp))
		.limit(1);

	if (existing[0]) {
		await db
			.update(sensorEvents)
			.set({
				timestamp: new Date(),
				data: payload,
				metadata: { source: 'egenfrekvens_ui', updated: true }
			})
			.where(eq(sensorEvents.id, existing[0].id));
	} else {
		await SensorEventService.write({
			userId: params.userId,
			sensorId: sensor.id,
			eventType: 'measurement',
			dataType: 'egenfrekvens_checkin',
			timestamp: new Date(),
			data: payload,
			source: 'egenfrekvens_ui'
		});
	}

	// Mirror balance to mood (0..10) so existing mood widgets keep working.
	await SensorEventService.write(
		{
			userId: params.userId,
			sensorId: moodSensor.id,
			eventType: 'measurement',
			dataType: 'mood',
			timestamp: new Date(),
			data: { day, rating: params.balance + 5, source: 'egenfrekvens' },
			source: 'egenfrekvens_ui'
		},
		{ conflictMode: 'ignore' }
	);

	return getEgenfrekvensCheckinStatus(params.userId, day);
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
		egenfrekvensCheckin: { enabled: true, time: '09:00' }
	};
	await db
		.update(users)
		.set({ notificationSettings: next, updatedAt: new Date() })
		.where(eq(users.id, userId));
}
