import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { liveSessions, liveSessionMessages } from '$lib/db/schema';
import { and, asc, count, eq, gt, gte } from 'drizzle-orm';
import { resolveShareToken } from '$lib/server/share-tokens';
import { resolveApiSecretAuthFromRequest } from '$lib/server/api-secrets';
import {
	validateMessageInput,
	parseAfterMarker,
	RATE_LIMIT_WINDOW_MS,
	RATE_LIMIT_MAX_PER_WINDOW,
	DIRECTION_VIEWER_TO_RUNNER,
	DIRECTION_RUNNER_TO_VIEWER,
	type MessageDirection
} from '$lib/server/services/live-messages';
import { parseBinaryReplyOptions } from '$lib/server/services/message-reply-intent';

/**
 * Toveis retur-kanal for delt live posisjon. Retningen avgjøres av hvordan
 * kalleren autentiserer seg:
 *
 *  - Bearer rsn_  → LØPEREN (Ekko). Scopes via økt-token (?token=, samme stabile
 *    handtak som PUT/DELETE). POST skriver løper→seer, GET leser seer→løper.
 *  - Ingen secret → SEEREN (dele-siden, offentlig). Scopes via det opake
 *    shareUrl-handtaket (?token=<share-token>). POST skriver seer→løper, GET
 *    leser løper→seer.
 *
 * Begge ligger under et offentlig path-prefiks (se hooks.server.ts), så
 * Bearer-autentisering gjøres eksplisitt her inne.
 */

type ResolvedSession = typeof liveSessions.$inferSelect;

// Løperens økt: Bearer-secret + økt-token må peke på en økt brukeren eier.
async function findRunnerSession(userId: string, sessionToken: string | null): Promise<ResolvedSession | null> {
	if (!sessionToken) return null;
	const session = await db.query.liveSessions.findFirst({
		where: and(eq(liveSessions.token, sessionToken), eq(liveSessions.userId, userId))
	});
	return session ?? null;
}

// Seerens økt: det opake share-token-handtaket fra shareUrl.
async function findViewerSession(shareToken: string | null): Promise<ResolvedSession | null> {
	const share = await resolveShareToken(shareToken);
	if (!share || share.resourceType !== 'tripPosition') return null;
	const session = await db.query.liveSessions.findFirst({
		where: eq(liveSessions.id, share.resourceId)
	});
	if (!session || session.userId !== share.ownerUserId) return null;
	return session;
}

async function readMessages(sessionId: string, direction: MessageDirection, after: number | null) {
	const base = and(
		eq(liveSessionMessages.sessionId, sessionId),
		eq(liveSessionMessages.direction, direction)
	);
	const where = after === null ? base : and(base, gt(liveSessionMessages.seq, after));

	const rows = await db.query.liveSessionMessages.findMany({
		where,
		orderBy: [asc(liveSessionMessages.seq)],
		limit: 100
	});

	return rows.map((m) => ({
		id: String(m.seq),
		sender: m.sender,
		text: m.text,
		// Binært hurtigsvarsett for hands-free Ekko-bruker (kun seer→løper).
		// Tom liste når meldingen ikke har forslag.
		quickReplies: m.quickReplies ?? [],
		createdAt: m.createdAt?.toISOString() ?? null
	}));
}

// POST /api/apps/live-session/messages?token=<token> — skriv melding
export const POST: RequestHandler = async ({ request, url }) => {
	const token = url.searchParams.get('token');
	const auth = await resolveApiSecretAuthFromRequest(request);

	const session = auth ? await findRunnerSession(auth.userId, token) : await findViewerSession(token);
	const direction: MessageDirection = auth ? DIRECTION_RUNNER_TO_VIEWER : DIRECTION_VIEWER_TO_RUNNER;

	if (!session) {
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

	// Rate-limit kun den offentlige seer-kanalen (alle med lenken kan skrive).
	// Løperen er autentisert og trenger ikke samme vern.
	if (direction === DIRECTION_VIEWER_TO_RUNNER) {
		const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
		const [{ value: recentCount }] = await db
			.select({ value: count() })
			.from(liveSessionMessages)
			.where(
				and(
					eq(liveSessionMessages.sessionId, session.id),
					eq(liveSessionMessages.direction, DIRECTION_VIEWER_TO_RUNNER),
					gte(liveSessionMessages.createdAt, windowStart)
				)
			);
		if (recentCount >= RATE_LIMIT_MAX_PER_WINDOW) {
			return json({ error: 'rate_limited' }, { status: 429 });
		}
	}

	// Seer→løper: map meldingen til et binært hurtigsvar Ekko viser som
	// nikk/rist-knapper. Feiler trygt til ingen forslag (NULL) — meldingen
	// sendes uansett. Løper→seer trenger ikke forslag (seeren kan skrive selv).
	let quickReplies: string[] | null = null;
	if (direction === DIRECTION_VIEWER_TO_RUNNER) {
		const intent = await parseBinaryReplyOptions(validated.value.text);
		quickReplies = intent.replies.length > 0 ? intent.replies : null;
	}

	await db.insert(liveSessionMessages).values({
		sessionId: session.id,
		direction,
		sender: validated.value.sender,
		text: validated.value.text,
		quickReplies
	});

	return json({ ok: true });
};

// GET /api/apps/live-session/messages?token=<token>&after=<seq> — hent nye meldinger
export const GET: RequestHandler = async ({ request, url }) => {
	const token = url.searchParams.get('token');
	const after = parseAfterMarker(url.searchParams.get('after'));
	const auth = await resolveApiSecretAuthFromRequest(request);

	if (auth) {
		// Løperen (Ekko) leser seer→løper-heiarop.
		const session = await findRunnerSession(auth.userId, token);
		if (!session) {
			return json({ error: token ? 'not_found' : 'token er påkrevd' }, { status: token ? 404 : 400 });
		}
		return json({ messages: await readMessages(session.id, DIRECTION_VIEWER_TO_RUNNER, after) });
	}

	// Seeren (dele-siden) leser løper→seer-meldinger.
	const session = await findViewerSession(token);
	if (!session) {
		return json({ error: 'not_found' }, { status: 404 });
	}
	return json({ messages: await readMessages(session.id, DIRECTION_RUNNER_TO_VIEWER, after) });
};
