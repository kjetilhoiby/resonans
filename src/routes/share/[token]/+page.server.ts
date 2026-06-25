import { error, redirect } from '@sveltejs/kit';
import { db } from '$lib/db';
import {
	checklists,
	themeLists,
	liveSessions,
	quizSessions,
	users
} from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { projectQuizBoard, toQuizSessionState, type QuizBoardView } from '$lib/server/assistant/quiz-logic';
import {
	maskEmail,
	recordShareAccess,
	resolveShareToken,
	type ShareAuthContext,
	type ShareResourceType
} from '$lib/server/share-tokens';
import type { PageServerLoad } from './$types';

type SharedChecklist = {
	id: string;
	title: string;
	emoji: string;
	completedAt: Date | null;
	items: Array<{
		id: string;
		text: string;
		checked: boolean;
		sortOrder: number;
		parentId: string | null;
		checkedAt: Date | null;
		checkedViaShareTokenId: string | null;
	}>;
};

type SharedThemeList = {
	id: string;
	title: string;
	emoji: string;
	listType: string;
	themeName: string | null;
	items: Array<{
		id: string;
		text: string;
		checked: boolean;
		notes: string | null;
		itemDate: string | null;
		sortOrder: number;
		checkedAt: Date | null;
		checkedViaShareTokenId: string | null;
	}>;
};

type SharedTripPosition = {
	sportType: string;
	routeLabel: string | null;
	routeCoordinates: [number, number][] | null;
	destLat: number | null;
	destLon: number | null;
	destLabel: string | null;
	routeDistanceM: number | null;
	lastLat: number | null;
	lastLon: number | null;
	lastSpeedMps: number | null;
	etaSeconds: number | null;
	distanceRemainingM: number | null;
	progressFraction: number | null;
	startedAt: string;
	lastPingAt: string | null;
	endedAt: string | null;
	endedReason: string | null;
};

async function loadChecklist(resourceId: string, ownerUserId: string): Promise<SharedChecklist | null> {
	const checklist = await db.query.checklists.findFirst({
		where: and(eq(checklists.id, resourceId), eq(checklists.userId, ownerUserId)),
		with: {
			items: {
				orderBy: (it, { asc }) => [asc(it.sortOrder), asc(it.createdAt)]
			}
		}
	});
	if (!checklist) return null;
	return {
		id: checklist.id,
		title: checklist.title,
		emoji: checklist.emoji,
		completedAt: checklist.completedAt,
		items: checklist.items.map((it) => ({
			id: it.id,
			text: it.text,
			checked: it.checked,
			sortOrder: it.sortOrder,
			parentId: it.parentId,
			checkedAt: it.checkedAt,
			checkedViaShareTokenId: it.checkedViaShareTokenId
		}))
	};
}

async function loadThemeList(resourceId: string, ownerUserId: string): Promise<SharedThemeList | null> {
	const list = await db.query.themeLists.findFirst({
		where: and(eq(themeLists.id, resourceId), eq(themeLists.userId, ownerUserId)),
		with: {
			items: {
				orderBy: (it, { asc }) => [asc(it.sortOrder), asc(it.createdAt)]
			},
			theme: { columns: { name: true } }
		}
	});
	if (!list) return null;
	return {
		id: list.id,
		title: list.title,
		emoji: list.emoji,
		listType: list.listType,
		themeName: list.theme?.name ?? null,
		items: list.items.map((it) => ({
			id: it.id,
			text: it.text,
			checked: it.checked,
			notes: it.notes,
			itemDate: it.itemDate,
			sortOrder: it.sortOrder,
			checkedAt: it.checkedAt,
			checkedViaShareTokenId: it.checkedViaShareTokenId
		}))
	};
}

async function loadTripPosition(resourceId: string, ownerUserId: string): Promise<SharedTripPosition | null> {
	const session = await db.query.liveSessions.findFirst({
		where: and(eq(liveSessions.id, resourceId), eq(liveSessions.userId, ownerUserId))
	});
	if (!session) return null;

	return {
		sportType: session.sportType,
		routeLabel: session.routeLabel,
		routeCoordinates: (session.routeCoordinates as [number, number][] | null) ?? null,
		destLat: session.destLat,
		destLon: session.destLon,
		destLabel: session.destLabel,
		routeDistanceM: session.routeDistanceM,
		lastLat: session.lastLat,
		lastLon: session.lastLon,
		lastSpeedMps: session.lastSpeedMps,
		etaSeconds: session.etaSeconds,
		distanceRemainingM: session.distanceRemainingM,
		progressFraction: session.progressFraction,
		startedAt: session.startedAt.toISOString(),
		lastPingAt: session.lastPingAt?.toISOString() ?? null,
		endedAt: session.endedAt?.toISOString() ?? null,
		endedReason: session.endedReason
	};
}

async function loadQuizBoard(resourceId: string, ownerUserId: string): Promise<QuizBoardView | null> {
	const session = await db.query.quizSessions.findFirst({
		where: and(eq(quizSessions.id, resourceId), eq(quizSessions.userId, ownerUserId))
	});
	if (!session) return null;
	return projectQuizBoard(toQuizSessionState(session));
}

async function loadOwnerDisplayName(ownerUserId: string): Promise<string | null> {
	const owner = await db.query.users.findFirst({
		where: eq(users.id, ownerUserId),
		columns: { name: true }
	});
	return owner?.name ?? null;
}

export const load: PageServerLoad = async ({ params, locals, url }) => {
	const share = await resolveShareToken(params.token);
	if (!share) {
		throw error(404, 'Denne lenken finnes ikke lenger eller er utløpt.');
	}

	const session = await locals.auth();
	const viewerEmail = session?.user?.email?.trim().toLowerCase() ?? null;
	const viewerUserId = session?.user?.id ?? null;

	// E-post-låst: krev session + matchende e-post
	if (share.allowedEmail) {
		if (!viewerEmail) {
			throw redirect(303, `/auth?next=${encodeURIComponent(url.pathname)}`);
		}
		if (viewerEmail !== share.allowedEmail) {
			return {
				status: 'email_locked' as const,
				maskedEmail: maskEmail(share.allowedEmail),
				viewerEmail
			};
		}
	}

	await recordShareAccess(share.tokenId);

	const ownerName = await loadOwnerDisplayName(share.ownerUserId);
	const viewerIsOwner = viewerUserId === share.ownerUserId;

	const baseResult = {
		status: 'ok' as const,
		token: params.token,
		resourceType: share.resourceType as ShareResourceType,
		accessMode: share.accessMode,
		ownerName,
		viewerIsOwner,
		viewerEmail
	};

	if (share.resourceType === 'checklist') {
		const checklist = await loadChecklist(share.resourceId, share.ownerUserId);
		if (!checklist) throw error(404, 'Sjekklisten finnes ikke lenger.');
		return { ...baseResult, resource: { kind: 'checklist' as const, ...checklist } };
	}

	if (share.resourceType === 'themeList') {
		const list = await loadThemeList(share.resourceId, share.ownerUserId);
		if (!list) throw error(404, 'Lista finnes ikke lenger.');
		return { ...baseResult, resource: { kind: 'themeList' as const, ...list } };
	}

	if (share.resourceType === 'tripPosition') {
		const trip = await loadTripPosition(share.resourceId, share.ownerUserId);
		if (!trip) throw error(404, 'Reisen finnes ikke lenger.');
		return { ...baseResult, resource: { kind: 'tripPosition' as const, ownerName, ...trip } };
	}

	if (share.resourceType === 'quizSession') {
		const board = await loadQuizBoard(share.resourceId, share.ownerUserId);
		if (!board) throw error(404, 'Quizen finnes ikke lenger.');
		return { ...baseResult, resource: { kind: 'quizSession' as const, board } };
	}

	throw error(400, 'Ukjent ressurstype.');
};

export type ShareLoadData = Awaited<ReturnType<typeof load>>;
export type { ShareAuthContext };
