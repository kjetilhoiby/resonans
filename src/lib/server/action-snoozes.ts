import { db } from '$lib/db';
import { actionSnoozes } from '$lib/db/schema';
import { and, eq, gt, sql } from 'drizzle-orm';

export type SnoozeScope = 'today' | 'week' | 'forever';

const FAR_FUTURE = new Date('9999-12-31T00:00:00Z');

function tzOffsetMs(tz: string, at: Date): number {
	const local = new Date(at.toLocaleString('en-US', { timeZone: tz }));
	const utc = new Date(at.toLocaleString('en-US', { timeZone: 'UTC' }));
	return local.getTime() - utc.getTime();
}

interface LocalParts {
	year: number;
	month: number;
	day: number;
	weekdayIdx: number;
}

function localParts(tz: string, now: Date): LocalParts {
	const fmt = new Intl.DateTimeFormat('en-US', {
		timeZone: tz,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		weekday: 'short'
	}).formatToParts(now);
	const map: Record<string, string> = {};
	for (const p of fmt) map[p.type] = p.value;
	const wmap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
	return {
		year: Number(map.year),
		month: Number(map.month),
		day: Number(map.day),
		weekdayIdx: wmap[map.weekday] ?? 0
	};
}

function localMidnightUtc(tz: string, year: number, month: number, day: number): Date {
	const iso = `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}T00:00:00Z`;
	const asUTC = new Date(iso);
	const offset = tzOffsetMs(tz, asUTC);
	return new Date(asUTC.getTime() - offset);
}

function addDays(year: number, month: number, day: number, delta: number) {
	const d = new Date(Date.UTC(year, month - 1, day));
	d.setUTCDate(d.getUTCDate() + delta);
	return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function startOfNextLocalDay(tz: string, now: Date): Date {
	const parts = localParts(tz, now);
	const next = addDays(parts.year, parts.month, parts.day, 1);
	return localMidnightUtc(tz, next.year, next.month, next.day);
}

function startOfNextLocalMonday(tz: string, now: Date): Date {
	const parts = localParts(tz, now);
	const daysUntilMonday = parts.weekdayIdx === 1 ? 7 : (8 - parts.weekdayIdx) % 7 || 7;
	const target = addDays(parts.year, parts.month, parts.day, daysUntilMonday);
	return localMidnightUtc(tz, target.year, target.month, target.day);
}

export function snoozeUntil(scope: SnoozeScope, tz: string, now: Date): Date {
	if (scope === 'forever') return FAR_FUTURE;
	if (scope === 'week') return startOfNextLocalMonday(tz, now);
	return startOfNextLocalDay(tz, now);
}

export async function upsertSnooze(userId: string, chipId: string, until: Date): Promise<void> {
	await db
		.insert(actionSnoozes)
		.values({ userId, chipId, until })
		.onConflictDoUpdate({
			target: [actionSnoozes.userId, actionSnoozes.chipId],
			set: { until }
		});
}

export async function clearSnooze(userId: string, chipId: string): Promise<void> {
	await db
		.delete(actionSnoozes)
		.where(and(eq(actionSnoozes.userId, userId), eq(actionSnoozes.chipId, chipId)));
}

export async function loadActiveSnoozedChipIds(userId: string, now: Date): Promise<Set<string>> {
	const rows = await db
		.select({ chipId: actionSnoozes.chipId })
		.from(actionSnoozes)
		.where(and(eq(actionSnoozes.userId, userId), gt(actionSnoozes.until, now)));
	return new Set(rows.map((r) => r.chipId));
}

export async function purgeExpiredSnoozes(userId: string, now: Date): Promise<void> {
	await db
		.delete(actionSnoozes)
		.where(and(eq(actionSnoozes.userId, userId), sql`${actionSnoozes.until} <= ${now}`));
}
