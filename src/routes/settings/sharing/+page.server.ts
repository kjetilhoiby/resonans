import { fail } from '@sveltejs/kit';
import { db } from '$lib/db';
import { checklists, themeLists, themes } from '$lib/db/schema';
import { eq, inArray } from 'drizzle-orm';
import {
	listShareTokensForOwner,
	revokeShareToken,
	ShareTokensStorageNotReadyError,
	type ShareTokenListItem
} from '$lib/server/share-tokens';
import type { Actions, PageServerLoad } from './$types';

type EnrichedShare = ShareTokenListItem & {
	resourceTitle: string | null;
};

async function enrich(userId: string, shares: ShareTokenListItem[]): Promise<EnrichedShare[]> {
	const checklistIds = shares.filter((s) => s.resourceType === 'checklist').map((s) => s.resourceId);
	const themeListIds = shares.filter((s) => s.resourceType === 'themeList').map((s) => s.resourceId);
	const themeIds = shares.filter((s) => s.resourceType === 'tripPosition').map((s) => s.resourceId);

	const [cls, tls, ths] = await Promise.all([
		checklistIds.length > 0
			? db.query.checklists.findMany({
					where: inArray(checklists.id, checklistIds),
					columns: { id: true, title: true, userId: true }
				})
			: Promise.resolve([] as Array<{ id: string; title: string; userId: string }>),
		themeListIds.length > 0
			? db.query.themeLists.findMany({
					where: inArray(themeLists.id, themeListIds),
					columns: { id: true, title: true, userId: true }
				})
			: Promise.resolve([] as Array<{ id: string; title: string; userId: string }>),
		themeIds.length > 0
			? db.query.themes.findMany({
					where: inArray(themes.id, themeIds),
					columns: { id: true, name: true, userId: true }
				})
			: Promise.resolve([] as Array<{ id: string; name: string; userId: string }>)
	]);

	const checklistMap = new Map(cls.filter((c) => c.userId === userId).map((c) => [c.id, c.title]));
	const themeListMap = new Map(tls.filter((c) => c.userId === userId).map((c) => [c.id, c.title]));
	const themeMap = new Map(ths.filter((c) => c.userId === userId).map((c) => [c.id, c.name]));

	return shares.map((s) => ({
		...s,
		resourceTitle:
			s.resourceType === 'checklist'
				? (checklistMap.get(s.resourceId) ?? null)
				: s.resourceType === 'themeList'
					? (themeListMap.get(s.resourceId) ?? null)
					: (themeMap.get(s.resourceId) ?? null)
	}));
}

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.userId;
	try {
		const shares = await listShareTokensForOwner(userId);
		const enriched = await enrich(userId, shares);
		return { shares: enriched, tableReady: true };
	} catch (error) {
		if (error instanceof ShareTokensStorageNotReadyError) {
			return { shares: [] as EnrichedShare[], tableReady: false };
		}
		throw error;
	}
};

export const actions = {
	revoke: async ({ request, locals }) => {
		const formData = await request.formData();
		const id = formData.get('id');
		if (typeof id !== 'string' || !id) {
			return fail(400, { error: 'Mangler id.' });
		}
		try {
			const revoked = await revokeShareToken(locals.userId, id);
			if (!revoked) {
				return fail(404, { error: 'Fant ingen aktiv deling.' });
			}
			return { success: true };
		} catch (error) {
			if (error instanceof ShareTokensStorageNotReadyError) {
				return fail(503, { error: error.message });
			}
			throw error;
		}
	}
} satisfies Actions;
