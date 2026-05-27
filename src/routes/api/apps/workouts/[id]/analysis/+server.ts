import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { canonicalWorkouts, sensorEvents } from '$lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { analyzeWorkout, type BestEfforts, type TrackPoint } from '$lib/server/workouts/workout-analytics';
import { getEffortBaseline } from '$lib/server/services/effort-service';

/**
 * GET /api/apps/workouts/:id/analysis
 *
 * Returnerer analytics (bestEfforts / GAP / HR zone distribution) for én
 * spesifikk workout. ID-en er ENTEN en canonical-workout-id (foretrukket)
 * eller en sensor_event-id (fallback).
 *
 * Hvis lagrede analytics finnes på canonical-raden, returneres de direkte.
 * Ellers kjøres analysen on-demand fra trackPoints.
 */
export const GET: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const id = params.id;

	// Forsøk først som canonical-workout
	const canonical = await db.query.canonicalWorkouts.findFirst({
		where: and(eq(canonicalWorkouts.id, id), eq(canonicalWorkouts.userId, userId))
	});

	if (canonical) {
		if (
			canonical.bestEfforts ||
			canonical.gapSecPerKm != null ||
			canonical.hrZoneDistribution
		) {
			return json({
				ok: true,
				source: 'cached',
				analyticsComputedAt: canonical.analyticsComputedAt?.toISOString() ?? null,
				bestEfforts: canonical.bestEfforts ?? null,
				gapSecPerKm: canonical.gapSecPerKm != null ? Number(canonical.gapSecPerKm) : null,
				hrZoneDistribution: canonical.hrZoneDistribution ?? null
			});
		}
		// Cache mangler — kjør on-demand fra evidence
		const eventIds = (canonical.evidence ?? []).map((e: any) => e.eventId).filter(Boolean);
		const result = await analyzeFromEventIds(userId, eventIds);
		return json({ ok: true, source: 'computed', ...result });
	}

	// Fallback: behandle id som sensor_event-id
	const result = await analyzeFromEventIds(userId, [id]);
	if (!result.bestEfforts && result.gapSecPerKm == null && !result.hrZoneDistribution) {
		throw error(404, 'No analytics available — workout has no trackPoints');
	}
	return json({ ok: true, source: 'computed', ...result });
};

async function analyzeFromEventIds(
	userId: string,
	eventIds: string[]
): Promise<{
	bestEfforts: BestEfforts | null;
	gapSecPerKm: number | null;
	hrZoneDistribution: Record<string, unknown> | null;
}> {
	if (eventIds.length === 0) {
		return { bestEfforts: null, gapSecPerKm: null, hrZoneDistribution: null };
	}
	const rows = await db
		.select({
			id: sensorEvents.id,
			trackPoints: sql<TrackPoint[] | null>`${sensorEvents.data}->'trackPoints'`
		})
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				sql`${sensorEvents.id} IN (${sql.join(eventIds.map((id) => sql`${id}`), sql`, `)})`
			)
		);
	const baseline = await getEffortBaseline(userId);
	let best: ReturnType<typeof analyzeWorkout> | null = null;
	let bestScore = -1;
	for (const r of rows) {
		const pts = Array.isArray(r.trackPoints) ? r.trackPoints : null;
		if (!pts || pts.length < 2) continue;
		const a = analyzeWorkout(pts, { restHr: baseline.restHr, maxHr: baseline.maxHr });
		const score =
			(a.bestEfforts ? Object.keys(a.bestEfforts).length : 0) +
			(a.gapSecPerKm != null ? 1 : 0) +
			(a.hrZoneDistribution ? 1 : 0);
		if (score > bestScore) {
			bestScore = score;
			best = a;
		}
	}
	if (!best) return { bestEfforts: null, gapSecPerKm: null, hrZoneDistribution: null };
	return {
		bestEfforts: best.bestEfforts ?? null,
		gapSecPerKm: best.gapSecPerKm ?? null,
		hrZoneDistribution: (best.hrZoneDistribution as unknown as Record<string, unknown>) ?? null
	};
}
