import { db } from '$lib/db';
import { checklists, checklistItems } from '$lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { dayContextForDate } from '$lib/server/iso-week';

const WEEKDAYS = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];

function weekdayTitle(isoDate: string): string {
	const [y, m, d] = isoDate.split('-').map(Number);
	const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
	return weekday.charAt(0).toUpperCase() + weekday.slice(1);
}

/**
 * Finn eller opprett dag-sjekklisten for en ISO-dato (context `week:..:day:..`),
 * som er det HomeScreen viser som «dagens liste».
 */
export async function findOrCreateDayChecklist(userId: string, isoDate: string) {
	const context = dayContextForDate(isoDate);
	const existing = await db.query.checklists.findFirst({
		where: and(eq(checklists.userId, userId), eq(checklists.context, context))
	});
	if (existing) return existing;

	const [created] = await db
		.insert(checklists)
		.values({ userId, title: weekdayTitle(isoDate), emoji: '🗓️', context })
		.returning();
	return created;
}

export type DatedItem = {
	isoDate: string; // dagen punktet skal vises på
	text: string;
	dueDate?: string; // hard frist (ISO) — settes for f.eks. innlevering
	metadata?: Record<string, unknown>;
};

/**
 * Legg daterte punkter inn i riktig dag-sjekkliste. Idempotent på
 * `metadata.gmailMessageId` + tekst, slik at samme e-post ikke dobbeltimporterer.
 */
export async function addDatedItems(userId: string, items: DatedItem[]): Promise<number> {
	let inserted = 0;
	// Grupper per dato for å unngå å slå opp samme sjekkliste flere ganger.
	const byDate = new Map<string, DatedItem[]>();
	for (const item of items) {
		const list = byDate.get(item.isoDate) ?? [];
		list.push(item);
		byDate.set(item.isoDate, list);
	}

	for (const [isoDate, dayItems] of byDate) {
		const checklist = await findOrCreateDayChecklist(userId, isoDate);

		const existing = await db.query.checklistItems.findMany({
			where: and(
				eq(checklistItems.checklistId, checklist.id),
				eq(checklistItems.userId, userId)
			),
			columns: { id: true, text: true }
		});
		const existingTexts = new Set(existing.map((e) => e.text));

		let sortOrder = existing.length;
		for (const item of dayItems) {
			if (existingTexts.has(item.text)) continue;

			const gmailMessageId = item.metadata?.gmailMessageId as string | undefined;
			if (gmailMessageId) {
				const dup = await db.query.checklistItems.findFirst({
					where: and(
						eq(checklistItems.userId, userId),
						eq(checklistItems.checklistId, checklist.id),
						sql`metadata->>'gmailMessageId' = ${gmailMessageId}`,
						eq(checklistItems.text, item.text)
					)
				});
				if (dup) continue;
			}

			await db.insert(checklistItems).values({
				checklistId: checklist.id,
				userId,
				text: item.text,
				dueDate: item.dueDate ?? null,
				sortOrder: sortOrder++,
				metadata: item.metadata ?? {}
			});
			existingTexts.add(item.text);
			inserted += 1;
		}
	}

	return inserted;
}
