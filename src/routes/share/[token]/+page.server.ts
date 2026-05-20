import { error, redirect } from '@sveltejs/kit';
import { db } from '$lib/db';
import {
	checklists,
	checklistItems,
	themeLists,
	themeListItems,
	themes,
	sensorEvents,
	users
} from '$lib/db/schema';
import { and, desc, eq, inArray } from 'drizzle-orm';
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
	themeId: string;
	themeName: string;
	themeEmoji: string | null;
	destination: string | null;
	destLat: number | null;
	destLng: number | null;
	currentLat: number | null;
	currentLng: number | null;
	currentSpeedKmh: number | null;
	currentTimestamp: Date | null;
	etaMinutes: number | null;
	distanceKm: number | null;
	isStale: boolean;
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

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
	const R = 6371;
	const toRad = (d: number) => (d * Math.PI) / 180;
	const dLat = toRad(lat2 - lat1);
	const dLng = toRad(lng2 - lng1);
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
	return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

const STALE_AFTER_MINUTES = 15;

async function loadTripPosition(resourceId: string, ownerUserId: string): Promise<SharedTripPosition | null> {
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, resourceId), eq(themes.userId, ownerUserId))
	});
	if (!theme) return null;

	const latest = await db.query.sensorEvents.findFirst({
		where: and(eq(sensorEvents.userId, ownerUserId), inArray(sensorEvents.dataType, ['gps', 'location'])),
		orderBy: [desc(sensorEvents.timestamp)]
	});

	const destLat = theme.tripProfile?.lat ?? null;
	const destLng = theme.tripProfile?.lng ?? null;
	const currentLat = (latest?.data?.lat as number | undefined) ?? null;
	const currentLng = (latest?.data?.lng as number | undefined) ?? null;
	const currentSpeedKmh = (latest?.data?.speedKmh as number | undefined) ?? null;
	const currentTimestamp = latest?.timestamp ?? null;

	let distanceKm: number | null = null;
	let etaMinutes: number | null = null;
	if (currentLat !== null && currentLng !== null && destLat !== null && destLng !== null) {
		distanceKm = haversineKm(currentLat, currentLng, destLat, destLng);
		const speed = Math.max(currentSpeedKmh ?? 0, 30);
		etaMinutes = Math.round((distanceKm / speed) * 60);
	}

	const isStale =
		!currentTimestamp ||
		Date.now() - currentTimestamp.getTime() > STALE_AFTER_MINUTES * 60 * 1000;

	return {
		themeId: theme.id,
		themeName: theme.name,
		themeEmoji: theme.emoji ?? null,
		destination: theme.tripProfile?.destination ?? null,
		destLat,
		destLng,
		currentLat,
		currentLng,
		currentSpeedKmh,
		currentTimestamp,
		etaMinutes,
		distanceKm,
		isStale
	};
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
		return { ...baseResult, resource: { kind: 'tripPosition' as const, ...trip } };
	}

	throw error(400, 'Ukjent ressurstype.');
};

export type ShareLoadData = Awaited<ReturnType<typeof load>>;
export type { ShareAuthContext };
