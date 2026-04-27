import { db } from '$lib/db';
import { canonicalWorkouts } from '$lib/db/schema';
import { and, eq, gte } from 'drizzle-orm';

export type WorkoutWeeklyStat = {
	weeks: number;
	count: number;
	avgPerWeek: number;
};

export type WorkoutStreakStats = {
	lastSessionAt: string | null;
	streakDays: number;
	weeklyStats: WorkoutWeeklyStat[];
};

function utcDayKey(date: Date): string {
	return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
	return new Date(date.getTime() + days * 86400000);
}

function todayUtc(): Date {
	const now = new Date();
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function calculateStreakDays(sessionDays: Set<string>, today: Date): number {
	let streak = 0;
	let cursor = today;
	while (sessionDays.has(utcDayKey(cursor))) {
		streak++;
		cursor = addDays(cursor, -1);
	}
	// If today has no session, check if yesterday starts a streak
	if (streak === 0) {
		cursor = addDays(today, -1);
		while (sessionDays.has(utcDayKey(cursor))) {
			streak++;
			cursor = addDays(cursor, -1);
		}
	}
	return streak;
}

export async function getWorkoutStreakStats(
	userId: string,
	sportFamily: string
): Promise<WorkoutStreakStats> {
	const since = addDays(todayUtc(), -365);

	const sessions = await db
		.select({ startTime: canonicalWorkouts.startTime })
		.from(canonicalWorkouts)
		.where(
			and(
				eq(canonicalWorkouts.userId, userId),
				eq(canonicalWorkouts.sportFamily, sportFamily),
				gte(canonicalWorkouts.startTime, since)
			)
		)
		.orderBy(canonicalWorkouts.startTime);

	if (sessions.length === 0) {
		return { lastSessionAt: null, streakDays: 0, weeklyStats: [] };
	}

	const lastSessionAt = sessions[sessions.length - 1].startTime.toISOString();
	const today = todayUtc();

	const sessionDays = new Set(sessions.map((s) => utcDayKey(s.startTime)));
	const streakDays = calculateStreakDays(sessionDays, today);

	const weeklyStats: WorkoutWeeklyStat[] = [1, 4, 12, 52].map((weeks) => {
		const cutoff = addDays(today, -weeks * 7);
		const count = sessions.filter((s) => s.startTime >= cutoff).length;
		return {
			weeks,
			count,
			avgPerWeek: Math.round((count / weeks) * 10) / 10
		};
	});

	return { lastSessionAt, streakDays, weeklyStats };
}
