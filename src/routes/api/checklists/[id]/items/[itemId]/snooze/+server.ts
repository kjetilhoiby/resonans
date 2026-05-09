import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { checklists, checklistItems } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { dayContextForDate } from '$lib/server/iso-week';

/**
 * POST /api/checklists/[id]/items/[itemId]/snooze
 * body: { targetDate: 'YYYY-MM-DD' }
 *
 * Lager en kopi av oppgaven på målets dag-sjekkliste (oppretter sjekklisten ved
 * behov), og markerer originalen som skipped slik at den vises som strøket på
 * opprinnelig dag og dermed gir feedback om hva som ofte blir utsatt.
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;
	const body = await request.json() as { targetDate?: string };
	const targetDate = (body.targetDate ?? '').trim();

	if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
		return json({ error: 'targetDate må være ISO-dato YYYY-MM-DD' }, { status: 400 });
	}

	const original = await db.query.checklistItems.findFirst({
		where: and(eq(checklistItems.id, params.itemId), eq(checklistItems.userId, userId))
	});
	if (!original) return json({ error: 'Ikke funnet' }, { status: 404 });

	const targetContext = dayContextForDate(targetDate);

	let dayChecklist = await db.query.checklists.findFirst({
		where: and(eq(checklists.userId, userId), eq(checklists.context, targetContext))
	});

	if (!dayChecklist) {
		const [created] = await db
			.insert(checklists)
			.values({ userId, title: `Dag ${targetDate}`, emoji: '☑️', context: targetContext })
			.returning();
		dayChecklist = created!;
	}

	const lastSortOrder = await db.query.checklistItems.findFirst({
		where: eq(checklistItems.checklistId, dayChecklist.id),
		orderBy: (items, { desc }) => [desc(items.sortOrder)],
		columns: { sortOrder: true }
	});
	const nextSortOrder = (lastSortOrder?.sortOrder ?? -1) + 1;

	// Ikke ta med tidligere progress/auto-check eller snooze-spor over på kopien.
	const carriedMetadata: typeof original.metadata = { ...original.metadata };
	delete carriedMetadata.progressRecordId;
	delete carriedMetadata.autoChecked;
	delete carriedMetadata.autoCheckedAt;
	delete carriedMetadata.snoozedToItemId;

	const inserted = await db
		.insert(checklistItems)
		.values([{
			checklistId: dayChecklist.id,
			userId,
			text: original.text,
			sortOrder: nextSortOrder,
			startDate: targetDate,
			metadata: carriedMetadata
		}])
		.returning();
	const copy = (inserted as Array<typeof checklistItems.$inferSelect>)[0];
	if (!copy) return json({ error: 'Klarte ikke kopiere oppgave' }, { status: 500 });

	const nextOriginalMetadata: typeof original.metadata = {
		...original.metadata,
		snoozedToItemId: copy.id
	};

	const updatedRows = await db
		.update(checklistItems)
		.set({
			skippedAt: new Date(),
			snoozedToDate: targetDate,
			checked: false,
			checkedAt: null,
			metadata: nextOriginalMetadata
		})
		.where(and(eq(checklistItems.id, original.id), eq(checklistItems.userId, userId)))
		.returning();
	const updatedOriginal = (updatedRows as Array<typeof checklistItems.$inferSelect>)[0];

	return json({ original: updatedOriginal, copy });
};
