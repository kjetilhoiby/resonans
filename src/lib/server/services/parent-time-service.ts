/**
 * Foreldretid: logget fokusert tid med hvert barn. Skrives som `parent_time_log`-
 * events (egen kilde, uavhengig av tracking_series-baserte family_parent_time_low_7d).
 * Grunnlaget for foreldretid-mål (per barn) og ukesoversikt i OBSERVERT ATFERD.
 */

import { db } from '$lib/db';
import { sensors, sensorEvents } from '$lib/db/schema';
import { and, eq, gte } from 'drizzle-orm';
import { aggregateParentTime, type ParentTimeChild } from '$lib/domain/observed-behavior';

async function ensureParentTimeSensor(userId: string) {
	const existing = await db.query.sensors.findFirst({
		where: and(eq(sensors.userId, userId), eq(sensors.provider, 'parent_time_log'))
	});
	if (existing) return existing;
	const [created] = await db
		.insert(sensors)
		.values({ userId, provider: 'parent_time_log', type: 'manual_log', subtype: 'parent_time', name: 'Foreldretid', isActive: true, config: {} })
		.returning();
	return created;
}

/** Logg fokusert tid med ett barn. */
export async function logParentTime(
	userId: string,
	args: { childName: string; minutes: number; activity?: string; at?: Date }
): Promise<void> {
	const sensor = await ensureParentTimeSensor(userId);
	await db.insert(sensorEvents).values({
		userId,
		sensorId: sensor.id,
		eventType: 'activity',
		dataType: 'parent_time_log',
		timestamp: args.at ?? new Date(),
		data: {
			childName: args.childName,
			minutes: Math.round(args.minutes),
			...(args.activity ? { activity: args.activity } : {})
		},
		metadata: { manual: true }
	});
}

/** Rå foreldretid-logger siste `sinceDays` dager. */
async function readParentTimeLogs(
	userId: string,
	sinceDays: number
): Promise<Array<{ childName: string; minutes: number }>> {
	const since = new Date(Date.now() - sinceDays * 86_400_000);
	const rows = await db
		.select({ data: sensorEvents.data })
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'parent_time_log'),
				gte(sensorEvents.timestamp, since)
			)
		);
	return rows.map((row) => {
		const d = row.data as { childName?: string; minutes?: number } | null;
		return { childName: (d?.childName ?? '').trim(), minutes: Number(d?.minutes) || 0 };
	});
}

/** Foreldretid per barn siste `sinceDays` dager, timer aggregert (lavest først). */
export async function readParentTimeByChild(userId: string, sinceDays = 7): Promise<ParentTimeChild[]> {
	return aggregateParentTime(await readParentTimeLogs(userId, sinceDays));
}

/** Loggede timer med ett bestemt barn siste `sinceDays` dager (for mål-evaluering). */
export async function readParentTimeForChild(
	userId: string,
	childName: string,
	sinceDays = 7
): Promise<number | null> {
	const all = await readParentTimeByChild(userId, sinceDays);
	const key = childName.trim().toLowerCase();
	const hit = all.find((c) => c.childName.toLowerCase() === key);
	return hit ? hit.hours : null;
}
