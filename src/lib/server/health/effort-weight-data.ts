import { sql } from 'drizzle-orm';
import { db, rowsOf } from '$lib/db';
import { WorkoutProjectionService } from '$lib/server/services/workout-projection-service';
import { mondayOfDate } from '$lib/server/tracks/curve';
import type { WeeklyEffortWeightInput } from '$lib/util/effort-weight-model';

/**
 * Datainnhenting for effort→vekt-modellen — DIREKTE fra kildene, ikke fra
 * sensor_aggregates: historiske ukerader kan mangle metrics.weeklyEffort
 * (aggregert før effort-feltet fantes) og ville telle som falske 0-effort-uker.
 * Ved å lese sensor_events (vekt) og canonical_workouts (effort) fitter
 * modellen på hele historikken umiddelbart, uten backfill.
 */

export interface EffortWeightInputs {
	weeks: WeeklyEffortWeightInput[];
	rolling7dEffort: number;
}

export async function buildEffortWeightInputs(userId: string, weeksBack = 26): Promise<EffortWeightInputs> {
	const now = new Date();
	const windowStart = new Date(now.getTime() - weeksBack * 7 * 24 * 3600_000);

	// Manglende historisk projeksjon (effort_score) køes for oppfrisking uten
	// å blokkere requesten — neste innlasting ser mer komplett historikk.
	try {
		await WorkoutProjectionService.ensureFreshnessForRange(userId, windowStart, now, undefined, undefined, {
			syncPolicy: 'enqueue_only'
		});
	} catch (err) {
		console.warn('[effort-weight-data] freshness-sjekk feilet (fortsetter):', err);
	}

	// Vekt per ISO-uke direkte fra sensor_events
	const weightRows = rowsOf<{ day: string; weight: string | number }>(
		await db.execute(sql`
			SELECT timestamp::date::text AS day, (data->>'weight')::numeric AS weight
			FROM sensor_events
			WHERE user_id = ${userId}
			  AND data_type = 'weight'
			  AND data->>'weight' IS NOT NULL
			  AND timestamp >= ${windowStart}
			  AND timestamp <= ${now}
		`)
	);

	// Effort per ISO-uke direkte fra canonical_workouts
	const effortRows = rowsOf<{ day: string; effort: string | number }>(
		await db.execute(sql`
			SELECT start_time::date::text AS day, effort_score AS effort
			FROM canonical_workouts
			WHERE user_id = ${userId}
			  AND effort_score IS NOT NULL
			  AND start_time >= ${windowStart}
			  AND start_time <= ${now}
		`)
	);

	const weightByWeek = new Map<string, number[]>();
	for (const row of weightRows) {
		const weight = Number(row.weight);
		if (!Number.isFinite(weight) || weight <= 0) continue;
		const week = mondayOfDate(row.day);
		const list = weightByWeek.get(week) ?? [];
		list.push(weight);
		weightByWeek.set(week, list);
	}

	const effortByWeek = new Map<string, number>();
	let rolling7dEffort = 0;
	const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 3600_000).toISOString().slice(0, 10);
	for (const row of effortRows) {
		const effort = Number(row.effort);
		if (!Number.isFinite(effort) || effort <= 0) continue;
		const week = mondayOfDate(row.day);
		effortByWeek.set(week, (effortByWeek.get(week) ?? 0) + effort);
		if (row.day >= sevenDaysAgo) rolling7dEffort += effort;
	}

	// Sammenhengende ukeliste fra vinduets start til nå — uker uten økter er
	// reelle hvileuker (effort 0), ikke manglende data.
	const weeks: WeeklyEffortWeightInput[] = [];
	const firstMonday = mondayOfDate(windowStart.toISOString().slice(0, 10));
	const lastMonday = mondayOfDate(now.toISOString().slice(0, 10));
	for (
		let cursor = new Date(`${firstMonday}T00:00:00Z`);
		cursor.toISOString().slice(0, 10) <= lastMonday;
		cursor.setUTCDate(cursor.getUTCDate() + 7)
	) {
		const weekKey = cursor.toISOString().slice(0, 10);
		const weights = weightByWeek.get(weekKey) ?? [];
		weeks.push({
			weekKey,
			weightAvg: weights.length > 0 ? weights.reduce((a, b) => a + b, 0) / weights.length : null,
			weighInCount: weights.length,
			effort: Math.round((effortByWeek.get(weekKey) ?? 0) * 10) / 10
		});
	}

	return { weeks, rolling7dEffort: Math.round(rolling7dEffort) };
}
