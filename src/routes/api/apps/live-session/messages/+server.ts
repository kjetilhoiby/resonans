import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { liveSessions, liveSessionMessages } from '$lib/db/schema';
import { and, asc, count, eq, gt, gte, isNull } from 'drizzle-orm';
import { resolveShareToken } from '$lib/server/share-tokens';
import { resolveApiSecretAuthFromRequest } from '$lib/server/api-secrets';
import {
	validateMessageInput,
	parseAfterMarker,
	RATE_LIMIT_WINDOW_MS,
	RATE_LIMIT_MAX_PER_WINDOW
} from '$lib/server/services/live-messages';

/**
 * Retur-kanal for delt live posisjon: seere skriver korte meldinger som
 * løper-appen (Ekko) poller og leser opp.
 *
 *  - POST  (offentlig)  : seeren på dele-siden skriver. Scopes via det opake
 *    shareUrl-handtaket (?token=<share-token> som ligger i /share/<token>).
 *  - GET   (Bearer rsn_): appen poller. Scopes via økt-token (samme stabile
 *    handtak som PUT/DELETE bruker), med `after`-markør for kun nyere meldinger.
 *
 * Begge ligger under et offentlig path-prefiks (se hooks.server.ts), så GET
 * autentiserer Bearer-tokenet eksplisitt her inne.
 */

// POST /api/apps/live-session/messages?token=<share-token> — seer skriver (offentlig)
export const POST: RequestHandler = async ({ request, url }) => {
	const shareToken = url.searchParams.get('token');
	const share = await resolveShareToken(shareToken);
	if (!share || share.resourceType !== 'tripPosition') {
		return json({ error: 'not_found' }, { status: 404 });
	}

	const session = await db.query.liveSessions.findFirst({
		where: eq(liveSessions.id, share.resourceId)
	});
	if (!session || session.userId !== share.ownerUserId) {
		return json({ error: 'not_found' }, { status: 404 });
	}
	if (session.endedAt) {
		// Økten er avsluttet — slutt å ta imot meldinger.
		return json({ error: 'session_ended' }, { status: 410 });
	}

	const body = (await request.json().catch(() => ({}))) as { sender?: unknown; text?: unknown };
	const validated = validateMessageInput(body);
	if (!validated.ok) {
		return json({ error: validated.error }, { status: 400 });
	}

	// Rate-limit per økt: alle med lenken kan skrive, så vi begrenser spam.
	const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
	const [{ value: recentCount }] = await db
		.select({ value: count() })
		.from(liveSessionMessages)
		.where(
			and(
				eq(liveSessionMessages.sessionId, session.id),
				gte(liveSessionMessages.createdAt, windowStart)
			)
		);
	if (recentCount >= RATE_LIMIT_MAX_PER_WINDOW) {
		return json({ error: 'rate_limited' }, { status: 429 });
	}

	await db.insert(liveSessionMessages).values({
		sessionId: session.id,
		sender: validated.value.sender,
		text: validated.value.text
	});

	return json({ ok: true });
};

// GET /api/apps/live-session/messages?token=<session-token>&after=<seq> — appen poller (Bearer)
export const GET: RequestHandler = async ({ request, url }) => {
	const auth = await resolveApiSecretAuthFromRequest(request);
	if (!auth) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const sessionToken = url.searchParams.get('token');
	if (!sessionToken) {
		return json({ error: 'token er påkrevd' }, { status: 400 });
	}

	const session = await db.query.liveSessions.findFirst({
		where: and(eq(liveSessions.token, sessionToken), eq(liveSessions.userId, auth.userId))
	});
	if (!session) {
		return json({ error: 'not_found' }, { status: 404 });
	}

	const after = parseAfterMarker(url.searchParams.get('after'));
	const whereClause = after === null
		? eq(liveSessionMessages.sessionId, session.id)
		: and(eq(liveSessionMessages.sessionId, session.id), gt(liveSessionMessages.seq, after));

	const rows = await db.query.liveSessionMessages.findMany({
		where: whereClause,
		orderBy: [asc(liveSessionMessages.seq)],
		limit: 100
	});

	return json({
		messages: rows.map((m) => ({
			id: String(m.seq),
			sender: m.sender,
			text: m.text,
			createdAt: m.createdAt?.toISOString() ?? null
		}))
	});
};
