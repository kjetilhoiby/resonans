import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, eq, gte } from 'drizzle-orm';

export type EgenfrekvensSlot = 'morning' | 'evening';

export interface EgenfrekvensSlotPoint {
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

export interface EgenfrekvensCheckinPoint {
	day: string;
	count: number;
	morning: EgenfrekvensSlotPoint | null;
	evening: EgenfrekvensSlotPoint | null;
	// Aggregert "samlet" for én-event-dager eller fallback til legacy (uten slot)
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
	avgLevel: number | null;
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

function rowToSlotPoint(
	id: string,
	data: Record<string, unknown>,
	timestamp: Date
): EgenfrekvensSlotPoint {
	return {
		eventId: id,
		mode: data.mode === 'quick' ? 'quick' : 'full',
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
		morning: EgenfrekvensSlotPoint | null;
		morningTs: number;
		evening: EgenfrekvensSlotPoint | null;
		eveningTs: number;
		legacy: EgenfrekvensSlotPoint | null; // events uten slot
		legacyTs: number;
		extreme: boolean;
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
				morning: null,
				morningTs: 0,
				evening: null,
				eveningTs: 0,
				legacy: null,
				legacyTs: 0,
				extreme: false
			};
			byDay.set(day, bucket);
		}
		bucket.ids.push(row.id);
		bucket.extreme = bucket.extreme || Boolean(data.extreme);
		const ts = row.timestamp.getTime();
		const point = rowToSlotPoint(row.id, data, row.timestamp);
		const slot = data.slot;
		if (slot === 'morning') {
			if (ts >= bucket.morningTs) {
				bucket.morning = point;
				bucket.morningTs = ts;
			}
		} else if (slot === 'evening') {
			if (ts >= bucket.eveningTs) {
				bucket.evening = point;
				bucket.eveningTs = ts;
			}
		} else if (ts >= bucket.legacyTs) {
			bucket.legacy = point;
			bucket.legacyTs = ts;
		}
	}

	const points: EgenfrekvensCheckinPoint[] = Array.from(byDay.values())
		.map((b) => {
			// Velg "samlet" baseline for legacy-felt: snitt av tilgjengelige slot-balanser, ellers legacy.
			const balances: number[] = [];
			const thoughts: number[] = [];
			const feelings: number[] = [];
			const actions: number[] = [];
			const collect = (p: EgenfrekvensSlotPoint | null) => {
				if (!p) return;
				if (p.balance !== null) balances.push(p.balance);
				if (p.thoughts !== null) thoughts.push(p.thoughts);
				if (p.feelings !== null) feelings.push(p.feelings);
				if (p.actions !== null) actions.push(p.actions);
			};
			collect(b.morning);
			collect(b.evening);
			collect(b.legacy);

			// Note/reflection: foretrekk legacy (full-flow) eller siste full event blant slotene
			const fullSource =
				b.legacy?.mode === 'full'
					? b.legacy
					: b.evening?.mode === 'full'
						? b.evening
						: b.morning?.mode === 'full'
							? b.morning
							: b.legacy ?? b.evening ?? b.morning;

			return {
				day: b.day,
				count: b.ids.length,
				morning: b.morning,
				evening: b.evening,
				balance: avg(balances),
				thoughts: avg(thoughts),
				feelings: avg(feelings),
				actions: avg(actions),
				note: fullSource?.note ?? null,
				reflection: fullSource?.reflection ?? null,
				extreme: b.extreme,
				eventIds: b.ids
			};
		})
		.sort((a, b) => (a.day < b.day ? 1 : -1));

	const levels = points.flatMap((p) => [p.morning?.level, p.evening?.level].filter(
		(v): v is number => typeof v === 'number'
	));
	const stats: EgenfrekvensTrendStats = {
		count: points.length,
		avgBalance: avg(points.map((p) => p.balance)),
		avgLevel: levels.length > 0 ? levels.reduce((s, n) => s + n, 0) / levels.length : null,
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
