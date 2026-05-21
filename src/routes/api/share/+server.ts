import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { checklists, themeLists, themes } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import {
	createShareToken,
	listShareTokensForOwner,
	ShareTokensStorageNotReadyError,
	type ShareAccessMode,
	type ShareResourceType
} from '$lib/server/share-tokens';

const VALID_TYPES: ShareResourceType[] = ['checklist', 'themeList', 'tripPosition'];
const VALID_MODES: ShareAccessMode[] = ['read', 'write'];

async function ownerOwnsResource(
	userId: string,
	resourceType: ShareResourceType,
	resourceId: string
): Promise<boolean> {
	if (resourceType === 'checklist') {
		const row = await db.query.checklists.findFirst({
			where: and(eq(checklists.id, resourceId), eq(checklists.userId, userId)),
			columns: { id: true }
		});
		return Boolean(row);
	}
	if (resourceType === 'themeList') {
		const row = await db.query.themeLists.findFirst({
			where: and(eq(themeLists.id, resourceId), eq(themeLists.userId, userId)),
			columns: { id: true }
		});
		return Boolean(row);
	}
	if (resourceType === 'tripPosition') {
		const row = await db.query.themes.findFirst({
			where: and(eq(themes.id, resourceId), eq(themes.userId, userId)),
			columns: { id: true }
		});
		return Boolean(row);
	}
	return false;
}

// GET /api/share — list owner's shares (optionally filtered by resource)
export const GET: RequestHandler = async ({ locals, url }) => {
	const userId = locals.userId;
	const resourceType = url.searchParams.get('resourceType') as ShareResourceType | null;
	const resourceId = url.searchParams.get('resourceId');

	try {
		const all = await listShareTokensForOwner(userId);
		const filtered =
			resourceType && resourceId
				? all.filter((s) => s.resourceType === resourceType && s.resourceId === resourceId)
				: all;
		return json(filtered);
	} catch (error) {
		if (error instanceof ShareTokensStorageNotReadyError) {
			return json({ error: error.message }, { status: 503 });
		}
		throw error;
	}
};

// POST /api/share — create a new share token
export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	const body = (await request.json().catch(() => ({}))) as {
		resourceType?: string;
		resourceId?: string;
		accessMode?: string;
		allowedEmail?: string | null;
		label?: string | null;
		expiresInDays?: number | null;
	};

	const resourceType = body.resourceType as ShareResourceType;
	const resourceId = body.resourceId;
	if (!resourceType || !VALID_TYPES.includes(resourceType)) {
		return json({ error: 'Ugyldig resourceType' }, { status: 400 });
	}
	if (!resourceId || typeof resourceId !== 'string') {
		return json({ error: 'Ugyldig resourceId' }, { status: 400 });
	}

	const accessMode = (body.accessMode as ShareAccessMode) ?? 'read';
	if (!VALID_MODES.includes(accessMode)) {
		return json({ error: 'Ugyldig accessMode' }, { status: 400 });
	}
	if (resourceType === 'tripPosition' && accessMode !== 'read') {
		return json({ error: 'Live posisjon kan kun deles som lesetilgang' }, { status: 400 });
	}

	const ownsResource = await ownerOwnsResource(userId, resourceType, resourceId);
	if (!ownsResource) {
		return json({ error: 'Ressursen finnes ikke eller tilhører ikke deg' }, { status: 404 });
	}

	let expiresAt: Date | null = null;
	if (body.expiresInDays && Number.isFinite(body.expiresInDays) && body.expiresInDays > 0) {
		expiresAt = new Date();
		expiresAt.setDate(expiresAt.getDate() + Math.floor(body.expiresInDays));
	}

	try {
		const created = await createShareToken({
			ownerUserId: userId,
			resourceType,
			resourceId,
			accessMode,
			allowedEmail: body.allowedEmail ?? null,
			label: body.label ?? null,
			expiresAt
		});
		return json(created, { status: 201 });
	} catch (error) {
		if (error instanceof ShareTokensStorageNotReadyError) {
			return json({ error: error.message }, { status: 503 });
		}
		throw error;
	}
};
