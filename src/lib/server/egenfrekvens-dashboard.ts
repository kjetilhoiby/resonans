import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, eq, gte } from 'drizzle-orm';

/**
 * Datapunkt per dag — én sjekkin (det finnes maks én per dag pga upsert i submitEgenfrekvensCheckin).
 */
export interface EgenfrekvensCheckinPoint {
	day: string;
	balance: number | null;
	thoughts: number | null;
	feelings: number | null;
	actions: number | null;
	note: string | null;
	reflection: string | null;
	extreme: boolean;
}

export interface EgenfrekvensTrendStats {
	count: number;
	avgBalance: number | null;
	avgThoughts: number | null;
	avgFeelings: number | null;
	avgActions: number | null;
	extremeDays: number;
}

export interface EgenfrekvensDashboardData {
	rangeDays: number;
	latest: EgenfrekvensCheckinPoint | null;
	points: EgenfrekvensCheckinPoint[];
	stats: EgenfrekvensTrendStats;
	streakDays: number;
}

function avg(nums: Array<number | null>): number | null {
	const xs = nums.filter((n): n is number => typeof n === 'number');
	if (xs.length === 0) return null;
	return xs.reduce((s, n) => s + n, 0) / xs.length;
}

function num(v: unknown): number | null {
	return typeof v === 'number' ? v : null;
}

function str(v: unknown): string | null {
	return typeof v === 'string' ? v : null;
}

function computeStreak(points: EgenfrekvensCheckinPoint[]): number {
	if (points.length === 0) return 0;
	// Points come sorted descending by day. Streak = consecutive days back from the most recent.
	const sorted = [...points].sort((a, b) => (a.day < b.day ? 1 : -1));
	let streak = 0;
	const today = new Date();
	const cursor = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
	for (const p of sorted) {
		const expected = cursor.toISOString().slice(0, 10);
		if (p.day !== expected) break;
		streak++;
		cursor.setUTCDate(cursor.getUTCDate() - 1);
	}
	return streak;
}

export async function loadEgenfrekvensDashboardData(
	userId: string,
	rangeDays = 30
): Promise<EgenfrekvensDashboardData> {
	const since = new Date();
	since.setUTCDate(since.getUTCDate() - rangeDays);

	const rows = await db
		.select({
			data: sensorEvents.data,
			timestamp: sensorEvents.timestamp
		})
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'egenfrekvens_checkin'),
				gte(sensorEvents.timestamp, since)
			)
		)
		.orderBy(sensorEvents.timestamp);

	// Group by day, latest wins (sorted ascending → take last per day).
	const byDay = new Map<string, EgenfrekvensCheckinPoint>();
	for (const row of rows) {
		const data = (row.data ?? {}) as Record<string, unknown>;
		const day = str(data.day);
		if (!day) continue;
		byDay.set(day, {
			day,
			balance: num(data.balance),
			thoughts: num(data.thoughts),
			feelings: num(data.feelings),
			actions: num(data.actions),
			note: str(data.note),
			reflection: str(data.reflection),
			extreme: Boolean(data.extreme)
		});
	}

	const points = Array.from(byDay.values()).sort((a, b) => (a.day < b.day ? 1 : -1));

	const stats: EgenfrekvensTrendStats = {
		count: points.length,
		avgBalance: avg(points.map((p) => p.balance)),
		avgThoughts: avg(points.map((p) => p.thoughts)),
		avgFeelings: avg(points.map((p) => p.feelings)),
		avgActions: avg(points.map((p) => p.actions)),
		extremeDays: points.filter((p) => p.extreme).length
	};

	return {
		rangeDays,
		latest: points[0] ?? null,
		points,
		stats,
		streakDays: computeStreak(points)
	};
}
