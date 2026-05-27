import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { canonicalWorkouts, sensorEvents } from '$lib/db/schema';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { analyzeWorkout, type TrackPoint } from '$lib/server/workouts/workout-analytics';
import { getEffortBaseline } from '$lib/server/services/effort-service';

/**
 * POST /api/sensors/workouts/reanalyze
 *
 * Idempotent backfill av workout-analytics for brukerens running canonical
 * workouts som mangler analytics. Hopper over de som allerede har
 * analyticsComputedAt satt (med mindre force=true).
 */
export const POST: RequestHandler = async ({ locals, url }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const force = url.searchParams.get('force') === 'true';

	// Hent kandidater
	const candidates = await db
		.select({
			id: canonicalWorkouts.id,
			evidence: canonicalWorkouts.evidence,
			analyticsComputedAt: canonicalWorkouts.analyticsComputedAt
		})
		.from(canonicalWorkouts)
		.where(
			and(
				eq(canonicalWorkouts.userId, userId),
				eq(canonicalWorkouts.sportFamily, 'running'),
				force ? undefined : isNull(canonicalWorkouts.analyticsComputedAt)
			)
		);

	if (candidates.length === 0) {
		return json({ ok: true, analyzed: 0, skipped: 0, message: 'Ingen kandidater' });
	}

	const baseline = await getEffortBaseline(userId);
	const eventIdToCanonical = new Map<string, string>();
	const eventIds = new Set<string>();
	for (const c of candidates) {
		const ev = (c.evidence ?? []) as Array<{ eventId?: string }>;
		for (const e of ev) {
			if (e.eventId) {
				eventIds.add(e.eventId);
				if (!eventIdToCanonical.has(e.eventId)) eventIdToCanonical.set(e.eventId, c.id);
			}
		}
	}

	if (eventIds.size === 0) {
		return json({ ok: true, analyzed: 0, skipped: candidates.length, message: 'Ingen evidence-events' });
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
				sql`${sensorEvents.id} IN (${sql.join(
					[...eventIds].map((id) => sql`${id}`),
					sql`, `
				)})`
			)
		);

	// Aggreger beste analytics per canonical-workout (best score wins)
	const bestPerCanonical = new Map<string, ReturnType<typeof analyzeWorkout>>();
	const scoreOf = (a: ReturnType<typeof analyzeWorkout>) =>
		(a.bestEfforts ? Object.keys(a.bestEfforts).length : 0) +
		(a.gapSecPerKm != null ? 1 : 0) +
		(a.hrZoneDistribution ? 1 : 0);

	for (const row of rows) {
		const pts = Array.isArray(row.trackPoints) ? row.trackPoints : null;
		if (!pts || pts.length < 2) continue;
		const canonicalId = eventIdToCanonical.get(row.id);
		if (!canonicalId) continue;
		const a = analyzeWorkout(pts, { restHr: baseline.restHr, maxHr: baseline.maxHr });
		if (scoreOf(a) === 0) continue;
		const existing = bestPerCanonical.get(canonicalId);
		if (!existing || scoreOf(a) > scoreOf(existing)) {
			bestPerCanonical.set(canonicalId, a);
		}
	}

	let analyzed = 0;
	let skipped = 0;
	const now = new Date();
	for (const c of candidates) {
		const a = bestPerCanonical.get(c.id);
		if (!a) {
			skipped += 1;
			continue;
		}
		await db
			.update(canonicalWorkouts)
			.set({
				bestEfforts: a.bestEfforts ?? null,
				gapSecPerKm: a.gapSecPerKm != null ? String(a.gapSecPerKm) : null,
				hrZoneDistribution: a.hrZoneDistribution ?? null,
				analyticsComputedAt: now,
				updatedAt: now
			})
			.where(eq(canonicalWorkouts.id, c.id));
		analyzed += 1;
	}

	return json({ ok: true, analyzed, skipped, candidates: candidates.length });
};
