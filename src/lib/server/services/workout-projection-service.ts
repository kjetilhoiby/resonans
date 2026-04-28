import { db, pgClient } from '$lib/db';
import { canonicalWorkouts, workoutDailyAggregates } from '$lib/db/schema';
import { and, eq, gte, lte, max, sql } from 'drizzle-orm';
import { buildUnifiedWorkoutActivities } from '$lib/server/activity-layer';
import { enqueueWorkoutProjectionRefresh } from '$lib/server/workout-projection-refresh-queue';

export type WorkoutProjectionRefreshResult = {
	canonicalCount: number;
	dailyCount: number;
};

export const WORKOUT_SOFT_STALE_MS = 2 * 60 * 1000;
export const WORKOUT_HARD_STALE_MS = 15 * 60 * 1000;

export type WorkoutProjectionFreshnessState = 'fresh' | 'soft_stale' | 'hard_stale' | 'missing';

export type WorkoutProjectionFreshness = {
	state: WorkoutProjectionFreshnessState;
	ageMs: number | null;
	lastUpdatedAt: Date | null;
	rowCount: number;
};

export type WorkoutProjectionSyncPolicy = 'block' | 'enqueue_only';

export type EnsureWorkoutFreshnessOptions = {
	syncPolicy?: WorkoutProjectionSyncPolicy;
};

export type RunningDailyProjectionRow = {
	date: Date;
	km: number;
};

function sportFamily(value: string): string {
	if (value.includes('running') || value === 'løp' || value === 'run') return 'running';
	if (value.includes('cycling') || value === 'e_bike') return 'cycling';
	if (value.includes('walking') || value === 'hiking') return 'walking';
	if (value.includes('swimming')) return 'swimming';
	return value || 'workout';
}

function utcDay(date: Date): Date {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export class WorkoutProjectionService {
	static readonly SOFT_STALE_MS = WORKOUT_SOFT_STALE_MS;
	static readonly HARD_STALE_MS = WORKOUT_HARD_STALE_MS;

	static async getFreshnessForRange(
		userId: string,
		startDate: Date,
		endDate: Date,
		softStaleMs = WORKOUT_SOFT_STALE_MS,
		hardStaleMs = WORKOUT_HARD_STALE_MS
	): Promise<WorkoutProjectionFreshness> {
		const rows = await db
			.select({
				rowCount: sql<number>`count(*)::int`,
				lastUpdatedAt: max(workoutDailyAggregates.updatedAt)
			})
			.from(workoutDailyAggregates)
			.where(
				and(
					eq(workoutDailyAggregates.userId, userId),
					eq(workoutDailyAggregates.sportFamily, 'running'),
					gte(workoutDailyAggregates.date, utcDay(startDate)),
					lte(workoutDailyAggregates.date, utcDay(endDate))
				)
			);

		const row = rows[0];
		const rowCount = Number(row?.rowCount ?? 0);
		const lastUpdatedAt = row?.lastUpdatedAt ?? null;

		if (rowCount === 0 || !lastUpdatedAt) {
			return { state: 'missing', ageMs: null, lastUpdatedAt: null, rowCount: 0 };
		}

		const ageMs = Date.now() - lastUpdatedAt.getTime();
		if (ageMs > hardStaleMs) {
			return { state: 'hard_stale', ageMs, lastUpdatedAt, rowCount };
		}
		if (ageMs > softStaleMs) {
			return { state: 'soft_stale', ageMs, lastUpdatedAt, rowCount };
		}

		return { state: 'fresh', ageMs, lastUpdatedAt, rowCount };
	}

	static async ensureFreshnessForRange(
		userId: string,
		startDate: Date,
		endDate: Date,
		softStaleMs = WORKOUT_SOFT_STALE_MS,
		hardStaleMs = WORKOUT_HARD_STALE_MS,
		options: EnsureWorkoutFreshnessOptions = {}
	): Promise<WorkoutProjectionFreshness> {
		const syncPolicy = options.syncPolicy ?? 'block';
		const freshness = await this.getFreshnessForRange(userId, startDate, endDate, softStaleMs, hardStaleMs);

		if (freshness.state === 'missing' || freshness.state === 'hard_stale') {
			if (syncPolicy === 'enqueue_only') {
				const reason = freshness.state === 'missing' ? 'missing' : 'hard_stale';
				await enqueueWorkoutProjectionRefresh({
					userId,
					fromDate: new Date(startDate.getTime() - 2 * 60 * 60 * 1000),
					toDate: new Date(),
					reason,
					priority: 4,
					maxAttempts: 3,
					debounceMs: 60 * 1000
				});
				return freshness;
			}

			await this.refreshForRange(userId, startDate, endDate);
			return this.getFreshnessForRange(userId, startDate, endDate, softStaleMs, hardStaleMs);
		}

		if (freshness.state === 'soft_stale') {
			await enqueueWorkoutProjectionRefresh({
				userId,
				fromDate: new Date(startDate.getTime() - 2 * 60 * 60 * 1000),
				toDate: new Date(),
				reason: 'soft_stale',
				priority: 4,
				maxAttempts: 3,
				debounceMs: 60 * 1000
			});
		}

		return freshness;
	}

	static async refreshForRange(
		userId: string,
		startDate: Date,
		endDate: Date
	): Promise<WorkoutProjectionRefreshResult> {
		const t0 = performance.now();
		const unified = await buildUnifiedWorkoutActivities(userId, { since: startDate, limit: 2000 });
		const inRange = unified.filter((workout) => new Date(workout.startTime) <= endDate);

		const canonicalRows = inRange.map((workout) => ({
			userId,
			startTime: new Date(workout.startTime),
			sportType: workout.sportType,
			sportFamily: sportFamily(workout.sportType),
			distanceMeters: workout.distanceMeters !== null ? String(workout.distanceMeters) : null,
			durationSeconds: workout.durationSeconds !== null ? String(workout.durationSeconds) : null,
			avgHeartRate: workout.avgHeartRate !== null ? String(workout.avgHeartRate) : null,
			maxHeartRate: workout.maxHeartRate !== null ? String(workout.maxHeartRate) : null,
			sourceCount: workout.evidenceCount,
			sourceProviders: workout.sources,
			evidence: workout.evidence.map((evidence) => ({
				eventId: evidence.eventId,
				sensorId: evidence.sensorId,
				provider: evidence.provider,
				sensorType: evidence.sensorType,
				timestamp: evidence.timestamp
			})),
			updatedAt: new Date()
		}));

		const dailyMap = new Map<string, {
			date: Date;
			sportFamily: string;
			count: number;
			distanceMetersSum: number;
			durationSecondsSum: number;
			avgHeartRateValues: number[];
			maxHeartRateMax: number;
		}>();

		for (const row of canonicalRows) {
			const keyDate = utcDay(row.startTime);
			const key = `${keyDate.toISOString()}::${row.sportFamily}`;
			const existing = dailyMap.get(key) ?? {
				date: keyDate,
				sportFamily: row.sportFamily,
				count: 0,
				distanceMetersSum: 0,
				durationSecondsSum: 0,
				avgHeartRateValues: [],
				maxHeartRateMax: 0
			};
			existing.count += 1;
			existing.distanceMetersSum += row.distanceMeters ? Number(row.distanceMeters) : 0;
			existing.durationSecondsSum += row.durationSeconds ? Number(row.durationSeconds) : 0;
			if (row.avgHeartRate) existing.avgHeartRateValues.push(Number(row.avgHeartRate));
			if (row.maxHeartRate) existing.maxHeartRateMax = Math.max(existing.maxHeartRateMax, Number(row.maxHeartRate));
			dailyMap.set(key, existing);
		}

		const dailyRows = Array.from(dailyMap.values()).map((agg) => {
			const avgHr = agg.avgHeartRateValues.length
				? agg.avgHeartRateValues.reduce((sum, value) => sum + value, 0) / agg.avgHeartRateValues.length
				: null;
			return {
				userId,
				date: agg.date,
				sportFamily: agg.sportFamily,
				count: agg.count,
				distanceMetersSum: String(agg.distanceMetersSum),
				durationSecondsSum: String(agg.durationSecondsSum),
				avgHeartRateAvg: avgHr === null ? null : String(avgHr),
				maxHeartRateMax: agg.maxHeartRateMax > 0 ? String(agg.maxHeartRateMax) : null,
				updatedAt: new Date()
			};
		});

		await db.delete(canonicalWorkouts).where(
			and(
				eq(canonicalWorkouts.userId, userId),
				gte(canonicalWorkouts.startTime, startDate),
				lte(canonicalWorkouts.startTime, endDate)
			)
		);
		await db.delete(workoutDailyAggregates).where(
			and(
				eq(workoutDailyAggregates.userId, userId),
				gte(workoutDailyAggregates.date, utcDay(startDate)),
				lte(workoutDailyAggregates.date, utcDay(endDate))
			)
		);

		if (canonicalRows.length > 0) {
			await db.insert(canonicalWorkouts).values(canonicalRows);
		}
		if (dailyRows.length > 0) {
			await db.insert(workoutDailyAggregates).values(dailyRows);
		}

		console.log(
			`[workout-projections] refresh ${userId}: unified=${inRange.length}, canonical=${canonicalRows.length}, daily=${dailyRows.length}, ${(performance.now() - t0).toFixed(0)}ms`
		);

		return { canonicalCount: canonicalRows.length, dailyCount: dailyRows.length };
	}

	static async readRunningDailyKmRowsForRange(
		userId: string,
		startDate: Date,
		endDate: Date
	): Promise<RunningDailyProjectionRow[]> {
		const rows = await db
			.select({
				date: workoutDailyAggregates.date,
				distanceMetersSum: workoutDailyAggregates.distanceMetersSum
			})
			.from(workoutDailyAggregates)
			.where(
				and(
					eq(workoutDailyAggregates.userId, userId),
					eq(workoutDailyAggregates.sportFamily, 'running'),
					gte(workoutDailyAggregates.date, startDate),
					lte(workoutDailyAggregates.date, endDate)
				)
			)
			.orderBy(workoutDailyAggregates.date);

		return rows.map((row) => ({
			date: row.date,
			km: Number(row.distanceMetersSum ?? 0) / 1000
		}));
	}

	static async enqueueRefreshForStaleUsers(maxAgeMs = WORKOUT_HARD_STALE_MS, limit = 100) {
		const staleRows = await pgClient.unsafe<{
			user_id: string;
			min_start: string;
			max_end: string;
			last_projection_at: string | null;
		}[]>(`
			WITH running_goal_users AS (
				SELECT
					g.user_id,
					MIN(COALESCE(NULLIF(g.metadata->>'startDate', '')::timestamptz, g.created_at)) AS min_start,
					MAX(COALESCE(NULLIF(g.metadata->>'endDate', '')::timestamptz, NOW())) AS max_end
				FROM goals g
				WHERE g.status = 'active'
				  AND COALESCE(g.metadata->>'metricId', '') = 'running_distance'
				GROUP BY g.user_id
			)
			SELECT
				r.user_id,
				r.min_start::text AS min_start,
				r.max_end::text AS max_end,
				MAX(w.updated_at)::text AS last_projection_at
			FROM running_goal_users r
			LEFT JOIN workout_daily_aggregates w
				ON w.user_id = r.user_id
				AND w.sport_family = 'running'
				AND w.date >= date_trunc('day', r.min_start)
				AND w.date <= date_trunc('day', r.max_end)
			GROUP BY r.user_id, r.min_start, r.max_end
			ORDER BY r.user_id
			LIMIT $1
		`, [Math.max(1, Math.min(limit, 1000))]);

		const staleUsers: Array<{ userId: string; ageMs: number | null }> = [];
		let enqueued = 0;

		for (const row of staleRows) {
			const lastProjectionAt = row.last_projection_at ? new Date(row.last_projection_at) : null;
			const ageMs = lastProjectionAt ? Date.now() - lastProjectionAt.getTime() : null;
			const isStale = ageMs === null || ageMs > maxAgeMs;
			if (!isStale) continue;

			staleUsers.push({ userId: row.user_id, ageMs });

			const fromDate = new Date(row.min_start);
			const toDate = new Date();
			const result = await enqueueWorkoutProjectionRefresh({
				userId: row.user_id,
				fromDate: new Date(fromDate.getTime() - 2 * 60 * 60 * 1000),
				toDate,
				reason: 'cron_sweeper',
				priority: 4,
				maxAttempts: 3,
				debounceMs: 5 * 60 * 1000
			});

			if (result.enqueued) enqueued += 1;
		}

		return {
			scanned: staleRows.length,
			enqueued,
			staleUsers
		};
	}
}