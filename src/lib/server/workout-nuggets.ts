import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { describeWorkoutSportType } from '$lib/server/workout-taxonomy';
import type { WorkoutContextSummary } from '$lib/server/workout-context';
import { and, eq, gte, ne } from 'drizzle-orm';

export interface WorkoutNugget {
	headline: string;
}

interface HistoryWorkout {
	timestamp: Date;
	sportTitle: string;
	distanceMeters: number | null;
	durationSeconds: number | null;
	paceSecondsPerKm: number | null;
	elevationMeters: number | null;
}

const PR_BUCKETS_DAYS = [365, 180, 90, 60, 30, 14, 7];

function normalizeDistanceMeters(distance: unknown): number | null {
	if (typeof distance !== 'number' || !Number.isFinite(distance) || distance <= 0) return null;
	return distance > 80 ? distance : distance * 1000;
}

function toFiniteNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function startOfDay(date: Date): number {
	const d = new Date(date);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

function startOfWeekMonday(date: Date): number {
	const d = new Date(date);
	d.setHours(0, 0, 0, 0);
	const day = d.getDay(); // 0 = Sunday
	const diff = (day + 6) % 7; // days since Monday
	d.setDate(d.getDate() - diff);
	return d.getTime();
}

function ordinalNb(n: number): string {
	return `${n}.`;
}

async function fetchWorkoutHistory(
	userId: string,
	excludeId: string,
	since: Date
): Promise<HistoryWorkout[]> {
	const rows = await db.query.sensorEvents.findMany({
		where: and(
			eq(sensorEvents.userId, userId),
			eq(sensorEvents.dataType, 'workout'),
			ne(sensorEvents.id, excludeId),
			gte(sensorEvents.timestamp, since)
		),
		columns: { timestamp: true, data: true }
	});

	return rows.map((row) => {
		const sportType = typeof row.data?.sportType === 'string' ? row.data.sportType : 'workout';
		return {
			timestamp: row.timestamp,
			sportTitle: describeWorkoutSportType(sportType),
			distanceMeters: normalizeDistanceMeters(row.data?.distance),
			durationSeconds: toFiniteNumber(row.data?.duration),
			paceSecondsPerKm: toFiniteNumber(row.data?.paceSecondsPerKm),
			elevationMeters:
				typeof row.data?.elevation === 'number' && Number.isFinite(row.data.elevation)
					? row.data.elevation
					: null
		};
	});
}

function withinDays(workoutDate: Date, candidate: Date, days: number): boolean {
	const ms = days * 24 * 60 * 60 * 1000;
	return workoutDate.getTime() - candidate.getTime() <= ms && candidate <= workoutDate;
}

function pickDistanceNugget(
	current: WorkoutContextSummary,
	history: HistoryWorkout[]
): string | null {
	if (current.distanceMeters == null || current.distanceMeters < 1000) return null;
	const sameSport = history.filter((h) => h.sportTitle === current.title && h.distanceMeters != null);
	if (sameSport.length === 0) return null;

	const workoutDate = new Date(current.timestamp);
	const beaten = (days: number) =>
		sameSport
			.filter((h) => withinDays(workoutDate, h.timestamp, days))
			.every((h) => (h.distanceMeters ?? 0) < current.distanceMeters!);

	const allTimeBeats = sameSport.every((h) => (h.distanceMeters ?? 0) < current.distanceMeters!);
	if (allTimeBeats) return `Lengste ${current.title.toLowerCase()} noensinne!`;

	for (const days of PR_BUCKETS_DAYS) {
		const inBucket = sameSport.filter((h) => withinDays(workoutDate, h.timestamp, days));
		if (inBucket.length >= 3 && beaten(days)) {
			return `Lengste ${current.title.toLowerCase()} på ${days} dager!`;
		}
	}
	return null;
}

function pickPaceNugget(
	current: WorkoutContextSummary,
	history: HistoryWorkout[]
): string | null {
	if (current.paceSecondsPerKm == null || current.distanceMeters == null) return null;
	if (current.distanceMeters < 2000) return null; // ignore noise
	if (current.title !== 'Løpetur') return null; // pace mainly meaningful for running

	const sameSport = history.filter(
		(h) => h.sportTitle === current.title && h.paceSecondsPerKm != null && (h.distanceMeters ?? 0) >= 2000
	);
	if (sameSport.length === 0) return null;

	const workoutDate = new Date(current.timestamp);
	const isFaster = (h: HistoryWorkout) => (h.paceSecondsPerKm ?? Infinity) > current.paceSecondsPerKm!;

	const allTime = sameSport.every(isFaster);
	if (allTime) return 'Raskeste tempo noensinne!';

	for (const days of PR_BUCKETS_DAYS) {
		const inBucket = sameSport.filter((h) => withinDays(workoutDate, h.timestamp, days));
		if (inBucket.length >= 3 && inBucket.every(isFaster)) {
			return `Raskeste tempo på ${days} dager!`;
		}
	}
	return null;
}

function pickStreakNugget(current: WorkoutContextSummary, history: HistoryWorkout[]): string | null {
	const workoutDay = startOfDay(new Date(current.timestamp));
	const days = new Set<number>([workoutDay]);
	for (const h of history) days.add(startOfDay(h.timestamp));

	let streak = 1;
	const dayMs = 24 * 60 * 60 * 1000;
	for (let i = 1; i < 60; i++) {
		if (days.has(workoutDay - i * dayMs)) streak += 1;
		else break;
	}

	if (streak >= 3) return `${streak} dager på rad!`;
	return null;
}

function pickWeeklyCountNugget(
	current: WorkoutContextSummary,
	history: HistoryWorkout[]
): string | null {
	const weekStart = startOfWeekMonday(new Date(current.timestamp));
	const weekEndExclusive = weekStart + 7 * 24 * 60 * 60 * 1000;
	const inWeek = history.filter((h) => {
		const t = h.timestamp.getTime();
		return t >= weekStart && t < weekEndExclusive;
	}).length;
	const total = inWeek + 1; // include current
	if (total >= 3) return `${ordinalNb(total)} økt denne uka!`;
	return null;
}

function pickShapeNugget(current: WorkoutContextSummary): string | null {
	const distanceKm = current.distanceKm;
	const minutes = current.durationSeconds != null ? current.durationSeconds / 60 : null;

	if (current.elevationMeters != null && current.elevationMeters >= 200) {
		return `Mye motbakke — ${Math.round(current.elevationMeters)} høydemeter!`;
	}

	if (current.title === 'Løpetur' && distanceKm != null && distanceKm >= 10) {
		return 'Lang økt — godt jobba!';
	}
	if (minutes != null && minutes >= 60) {
		return 'Lang økt — godt jobba!';
	}

	if (
		minutes != null &&
		minutes <= 20 &&
		(distanceKm == null || distanceKm <= 3)
	) {
		return 'Kort og godt!';
	}
	return null;
}

export async function computeWorkoutNugget(
	userId: string,
	workout: WorkoutContextSummary
): Promise<WorkoutNugget | null> {
	const since = new Date(new Date(workout.timestamp).getTime() - 365 * 24 * 60 * 60 * 1000);
	const history = await fetchWorkoutHistory(userId, workout.id, since);

	const candidates = [
		pickDistanceNugget(workout, history),
		pickPaceNugget(workout, history),
		pickStreakNugget(workout, history),
		pickWeeklyCountNugget(workout, history),
		pickShapeNugget(workout)
	].filter((value): value is string => Boolean(value));

	if (candidates.length === 0) return null;
	return { headline: candidates[0] };
}
