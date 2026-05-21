import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { checklistItems, checklists, themeListItems, themeLists } from '$lib/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { resolveShareToken } from '$lib/server/share-tokens';

// POST /api/share-link/[token]/check-item — toggle an item via a share token
//   body: { itemId: string, checked: boolean }
export const POST: RequestHandler = async ({ params, request }) => {
	const share = await resolveShareToken(params.token);
	if (!share) {
		return json({ error: 'Lenken finnes ikke lenger eller er utløpt' }, { status: 404 });
	}
	if (share.accessMode !== 'write') {
		return json({ error: 'Denne lenken er kun lesetilgang' }, { status: 403 });
	}
	if (share.resourceType !== 'checklist' && share.resourceType !== 'themeList') {
		return json({ error: 'Avkryssing støttes ikke for denne ressursen' }, { status: 400 });
	}

	const body = (await request.json().catch(() => ({}))) as {
		itemId?: string;
		checked?: boolean;
	};
	if (!body.itemId || typeof body.checked !== 'boolean') {
		return json({ error: 'Mangler itemId eller checked' }, { status: 400 });
	}

	const now = new Date();

	if (share.resourceType === 'checklist') {
		const existing = await db.query.checklistItems.findFirst({
			where: and(
				eq(checklistItems.id, body.itemId),
				eq(checklistItems.checklistId, share.resourceId),
				eq(checklistItems.userId, share.ownerUserId)
			),
			columns: { id: true }
		});
		if (!existing) {
			return json({ error: 'Elementet tilhører ikke denne delingen' }, { status: 404 });
		}

		await db
			.update(checklistItems)
			.set({
				checked: body.checked,
				checkedAt: body.checked ? now : null,
				checkedViaShareTokenId: body.checked ? share.tokenId : null
			})
			.where(eq(checklistItems.id, body.itemId));

		// Reflekter ferdig-status på sjekklisten hvis alle items er sjekka/skipped
		await syncChecklistCompletion(share.resourceId);

		return json({ ok: true });
	}

	// themeList
	const existing = await db.query.themeListItems.findFirst({
		where: and(
			eq(themeListItems.id, body.itemId),
			eq(themeListItems.listId, share.resourceId),
			eq(themeListItems.userId, share.ownerUserId)
		),
		columns: { id: true }
	});
	if (!existing) {
		return json({ error: 'Elementet tilhører ikke denne delingen' }, { status: 404 });
	}

	await db
		.update(themeListItems)
		.set({
			checked: body.checked,
			checkedAt: body.checked ? now : null,
			checkedViaShareTokenId: body.checked ? share.tokenId : null
		})
		.where(eq(themeListItems.id, body.itemId));

	return json({ ok: true });
};

async function syncChecklistCompletion(checklistId: string) {
	const items = await db.query.checklistItems.findMany({
		where: eq(checklistItems.checklistId, checklistId),
		columns: { checked: true, skippedAt: true }
	});
	const remaining = items.filter((i) => !i.checked && !i.skippedAt);
	if (items.length > 0 && remaining.length === 0) {
		await db
			.update(checklists)
			.set({ completedAt: new Date() })
			.where(and(eq(checklists.id, checklistId), isNull(checklists.completedAt)));
	} else {
		await db.update(checklists).set({ completedAt: null }).where(eq(checklists.id, checklistId));
	}
}
