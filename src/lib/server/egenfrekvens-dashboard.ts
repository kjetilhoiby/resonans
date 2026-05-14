import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, eq, gte } from 'drizzle-orm';

export interface EgenfrekvensCheckinPoint {
	day: string;
	count: number;
	balance: number | null;
	thoughts: number | null;
	feelings: number | null;
	actions: number | null;
	note: string | null;
	reflection: string | null;
	extreme: boolean;
	eventIds: string[];
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
			id: sensorEvents.id,
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

	type Bucket = {
		day: string;
		ids: string[];
		balances: number[];
		thoughts: number[];
		feelings: number[];
		actions: number[];
		extreme: boolean;
		lastNote: string | null;
		lastReflection: string | null;
	};
	const byDay = new Map<string, Bucket>();
	for (const row of rows) {
		const data = (row.data ?? {}) as Record<string, unknown>;
		const day = str(data.day);
		if (!day) continue;
		let bucket = byDay.get(day);
		if (!bucket) {
			bucket = {
				day,
				ids: [],
				balances: [],
				thoughts: [],
				feelings: [],
				actions: [],
				extreme: false,
				lastNote: null,
				lastReflection: null
			};
			byDay.set(day, bucket);
		}
		bucket.ids.push(row.id);
		const b = num(data.balance);
		const t = num(data.thoughts);
		const f = num(data.feelings);
		const a = num(data.actions);
		if (b !== null) bucket.balances.push(b);
		if (t !== null) bucket.thoughts.push(t);
		if (f !== null) bucket.feelings.push(f);
		if (a !== null) bucket.actions.push(a);
		bucket.extreme = bucket.extreme || Boolean(data.extreme);
		const note = str(data.note);
		if (note) bucket.lastNote = note;
		const reflection = str(data.reflection);
		if (reflection) bucket.lastReflection = reflection;
	}

	const points: EgenfrekvensCheckinPoint[] = Array.from(byDay.values())
		.map((b) => ({
			day: b.day,
			count: Math.max(b.balances.length, b.thoughts.length, b.feelings.length, b.actions.length, 1),
			balance: avg(b.balances),
			thoughts: avg(b.thoughts),
			feelings: avg(b.feelings),
			actions: avg(b.actions),
			note: b.lastNote,
			reflection: b.lastReflection,
			extreme: b.extreme,
			eventIds: b.ids
		}))
		.sort((a, b) => (a.day < b.day ? 1 : -1));

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
