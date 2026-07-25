import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { getOrCreateWorkoutShareToken, buildShareUrl } from '$lib/server/share-tokens';

/**
 * Oppretter (eller gjenbruker) en offentlig delelenke for en opplastet tur (workout), så den
 * kan spilles av i 3D med bilder på `/share/[token]`. Kalles av ekkos «del på web»-knapp.
 *
 * Body: `{ eventId }` (fra opplastingssvaret) eller `{ sessionId }` (ekko-øktas id).
 */
export const POST: RequestHandler = async ({ locals, request, url }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = (await request.json().catch(() => ({}))) as {
		eventId?: string;
		sessionId?: string;
	};
	const eventId = body.eventId?.trim() || null;
	const sessionId = body.sessionId?.trim() || null;

	let workoutId = eventId;

	// Fallback: finn workout-hendelsen for økta via metadata.sessionId.
	if (!workoutId && sessionId) {
		const events = await db.query.sensorEvents.findMany({
			where: and(eq(sensorEvents.userId, userId), eq(sensorEvents.dataType, 'workout')),
			orderBy: (e, { desc }) => [desc(e.timestamp)],
			limit: 100
		});
		workoutId =
			events.find((e) => ((e.metadata as Record<string, unknown> | null)?.sessionId ?? null) === sessionId)
				?.id ?? null;
	}

	if (!workoutId) throw error(400, 'Missing eventId or sessionId');

	// Verifiser eierskap + at det faktisk er en workout.
	const ev = await db.query.sensorEvents.findFirst({
		where: and(eq(sensorEvents.id, workoutId), eq(sensorEvents.userId, userId))
	});
	if (!ev || ev.dataType !== 'workout') throw error(404, 'Workout not found');

	const token = await getOrCreateWorkoutShareToken(userId, workoutId);
	return json({ ok: true, token: token.token, url: buildShareUrl(url.origin, token.token) });
};
