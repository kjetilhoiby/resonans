import { db } from '$lib/db';
import { checklistItems, themes } from '$lib/db/schema';
import { and, eq, asc, sql } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

// Handleliste per butikk: alle innkjøps-oppgaver (checklist_items med metadata.shopping=true)
// på tvers av hjem-prosjekter (parentTheme='Hjem'), gruppert på metadata.store.
export const load: PageServerLoad = async ({ locals, url }) => {
	const userId = locals.userId;
	const store = url.searchParams.get('store')?.trim() || null;

	const rows = await db
		.select({
			id: checklistItems.id,
			text: checklistItems.text,
			checked: checklistItems.checked,
			themeId: checklistItems.themeId,
			metadata: checklistItems.metadata,
			createdAt: checklistItems.createdAt,
			projectName: themes.name,
			projectEmoji: themes.emoji
		})
		.from(checklistItems)
		.innerJoin(themes, eq(themes.id, checklistItems.themeId))
		.where(
			and(
				eq(checklistItems.userId, userId),
				eq(themes.parentTheme, 'Hjem'),
				eq(themes.archived, false),
				sql`${checklistItems.metadata}->>'shopping' = 'true'`
			)
		)
		.orderBy(asc(checklistItems.checked), asc(checklistItems.createdAt));

	const items = rows.map((r) => {
		const m = (r.metadata ?? {}) as Record<string, unknown>;
		return {
			id: r.id,
			text: r.text,
			checked: r.checked,
			themeId: r.themeId as string,
			store: (m.store as string | undefined) ?? null,
			projectName: r.projectName,
			projectEmoji: r.projectEmoji
		};
	});

	const filtered = store ? items.filter((i) => i.store === store) : items;

	// Grupper per butikk (null/ukjent → "Uten butikk"), kun for oversikten (uten filter).
	const groupMap = new Map<string, typeof items>();
	for (const it of items) {
		const key = it.store ?? 'Uten butikk';
		if (!groupMap.has(key)) groupMap.set(key, []);
		groupMap.get(key)!.push(it);
	}
	const groups = [...groupMap.entries()]
		.map(([storeName, storeItems]) => ({
			store: storeName,
			open: storeItems.filter((i) => !i.checked).length,
			total: storeItems.length
		}))
		.sort((a, b) => b.open - a.open || a.store.localeCompare(b.store, 'nb'));

	return { selectedStore: store, items: filtered, groups };
};
