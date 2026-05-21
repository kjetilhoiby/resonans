import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { liveSessions } from '$lib/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { randomBytes } from 'crypto';

export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json();
	const { sportType, routeLabel, routeCoordinates, destLat, destLon, destLabel, routeDistanceM, lat, lng } = body;

	if (!sportType) return json({ error: 'sportType er påkrevd' }, { status: 400 });

	const existing = await db.query.liveSessions.findFirst({
		where: and(eq(liveSessions.userId, userId), isNull(liveSessions.endedAt))
	});
	if (existing) {
		await db.update(liveSessions)
			.set({ endedAt: new Date(), endedReason: 'replaced' })
			.where(eq(liveSessions.id, existing.id));
	}

	const token = randomBytes(9).toString('base64url');
	const origin = new URL(request.url).origin;

	const [session] = await db.insert(liveSessions).values({
		userId,
		token,
		sportType,
		routeLabel: routeLabel ?? null,
		routeCoordinates: routeCoordinates ?? null,
		destLat: destLat ?? null,
		destLon: destLon ?? null,
		destLabel: destLabel ?? null,
		routeDistanceM: routeDistanceM ?? null,
		lastLat: lat ?? null,
		lastLon: lng ?? null
	}).returning();

	return json({
		ok: true,
		token,
		sessionId: session.id,
		shareUrl: `${origin}/live/${token}`
	}, { status: 201 });
};

export const PUT: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json();
	const { token, lat, lng, speedMps, etaSeconds, distanceRemainingM, progressFraction } = body;

	if (!token) return json({ error: 'token er påkrevd' }, { status: 400 });

	const result = await db.update(liveSessions)
		.set({
			lastLat: lat,
			lastLon: lng,
			lastSpeedMps: speedMps ?? null,
			etaSeconds: etaSeconds ?? null,
			distanceRemainingM: distanceRemainingM ?? null,
			progressFraction: progressFraction ?? null,
			lastPingAt: new Date()
		})
		.where(and(
			eq(liveSessions.token, token),
			eq(liveSessions.userId, userId),
			isNull(liveSessions.endedAt)
		))
		.returning();

	if (result.length === 0) return json({ error: 'Sesjon ikke funnet' }, { status: 404 });

	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json();
	const { token, reason } = body;

	if (!token) return json({ error: 'token er påkrevd' }, { status: 400 });

	await db.update(liveSessions)
		.set({ endedAt: new Date(), endedReason: reason ?? 'stopped' })
		.where(and(
			eq(liveSessions.token, token),
			eq(liveSessions.userId, userId),
			isNull(liveSessions.endedAt)
		));

	return json({ ok: true });
};
