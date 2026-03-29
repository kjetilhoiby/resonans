import { db } from '$lib/db';
import { memories } from '$lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { METRIC_CATALOG, resolveMetricId, type MetricId } from '$lib/domain/metric-catalog';
import type { GoalTrack } from '$lib/domain/goal-tracks';

const GOAL_TRACKS_SOURCE = 'goal_tracks_v1';

type GoalTracksStore = Partial<Record<MetricId, GoalTrack[]>>;

async function getStoreMemory(userId: string) {
	return await db.query.memories.findFirst({
		where: and(eq(memories.userId, userId), eq(memories.source, GOAL_TRACKS_SOURCE)),
		orderBy: [desc(memories.updatedAt)]
	});
}

function parseStore(content: string | null | undefined): GoalTracksStore {
	if (!content) return {};
	try {
		const parsed = JSON.parse(content) as GoalTracksStore;
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

export async function getGoalTracksByMetric(userId: string, metricIdInput: string): Promise<GoalTrack[]> {
	const metricId = resolveMetricId(metricIdInput);
	if (!metricId || !METRIC_CATALOG[metricId]) {
		throw new Error('Unknown metric id');
	}

	const storeMemory = await getStoreMemory(userId);
	const store = parseStore(storeMemory?.content);
	return store[metricId] ?? [];
}

export async function saveGoalTracksByMetric(userId: string, metricIdInput: string, tracks: GoalTrack[]) {
	const metricId = resolveMetricId(metricIdInput);
	if (!metricId || !METRIC_CATALOG[metricId]) {
		throw new Error('Unknown metric id');
	}

	const storeMemory = await getStoreMemory(userId);
	const store = parseStore(storeMemory?.content);
	store[metricId] = tracks;
	const serialized = JSON.stringify(store);

	if (storeMemory) {
		const [updated] = await db
			.update(memories)
			.set({
				category: 'preferences',
				content: serialized,
				importance: 'high',
				updatedAt: new Date(),
				lastAccessedAt: new Date()
			})
			.where(eq(memories.id, storeMemory.id))
			.returning();
		return updated;
	}

	const [created] = await db
		.insert(memories)
		.values({
			userId,
			category: 'preferences',
			content: serialized,
			importance: 'high',
			source: GOAL_TRACKS_SOURCE
		})
		.returning();

	return created;
}
