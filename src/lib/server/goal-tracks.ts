import { db } from '$lib/db';
import { goalTracks } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { METRIC_CATALOG, resolveMetricId, type MetricId } from '$lib/domain/metric-catalog';
import type { GoalTrack } from '$lib/domain/goal-tracks';

function ensureMetric(metricIdInput: string): MetricId {
	const metricId = resolveMetricId(metricIdInput);
	if (!metricId || !METRIC_CATALOG[metricId]) {
		throw new Error('Unknown metric id');
	}
	return metricId;
}

export async function getGoalTracksByMetric(userId: string, metricIdInput: string): Promise<GoalTrack[]> {
	const metricId = ensureMetric(metricIdInput);
	const row = await db.query.goalTracks.findFirst({
		where: and(eq(goalTracks.userId, userId), eq(goalTracks.metricId, metricId))
	});
	const tracks = (row?.tracks ?? []) as GoalTrack[];
	return Array.isArray(tracks) ? tracks : [];
}

export async function saveGoalTracksByMetric(userId: string, metricIdInput: string, tracks: GoalTrack[]) {
	const metricId = ensureMetric(metricIdInput);
	await db
		.insert(goalTracks)
		.values({ userId, metricId, tracks })
		.onConflictDoUpdate({
			target: [goalTracks.userId, goalTracks.metricId],
			set: { tracks, updatedAt: new Date() }
		});
}

export async function upsertGoalTrack(userId: string, metricIdInput: string, track: GoalTrack) {
	const existing = await getGoalTracksByMetric(userId, metricIdInput);
	const next = [...existing.filter((item) => item.id !== track.id), track].sort(
		(a, b) => (b.priority ?? 0) - (a.priority ?? 0)
	);

	await saveGoalTracksByMetric(userId, metricIdInput, next);
	return track;
}

/**
 * Hent alle goal-tracks for en bruker, gruppert per metricId. Brukes av
 * salary-report og DreamService som vil ha hele bildet.
 */
export async function getAllGoalTracksByUser(userId: string): Promise<Partial<Record<MetricId, GoalTrack[]>>> {
	const rows = await db.query.goalTracks.findMany({
		where: eq(goalTracks.userId, userId)
	});
	const out: Partial<Record<MetricId, GoalTrack[]>> = {};
	for (const row of rows) {
		const id = resolveMetricId(row.metricId);
		if (!id) continue;
		const tracks = (row.tracks ?? []) as GoalTrack[];
		out[id] = Array.isArray(tracks) ? tracks : [];
	}
	return out;
}
