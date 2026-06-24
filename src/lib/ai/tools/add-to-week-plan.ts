import { and, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { checklists, checklistItems } from '$lib/db/schema';
import { localIsoWeek } from '$lib/domains/livskompass/dimensions';
import { parseListRepeatCount } from '$lib/server/list-repeat-parser';
import { buildChecklistItemFields } from '$lib/server/checklist-item-builder';

const MAX_REPEAT = 12;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** ISO-ukenøkkel for et antall uker frem (0 = denne uka, 1 = neste uke). */
function weekKeyForOffset(weekOffset: number): string {
	const target = new Date(Date.now() + weekOffset * WEEK_MS);
	return localIsoWeek(target);
}

/**
 * Legger målbare tiltak på en ukes sjekkliste (ukelista), finner-eller-oppretter
 * ukas liste (context = `week:YYYY-Www`). Brukes typisk for å føre opp konkrete
 * mål fra livskompass-coachingen på NESTE ukes liste.
 *
 * Frekvens i teksten tolkes: «Skjermfri 16–19 tre kvelder» → tre punkter
 * «Skjermfri 16–19 (1/3)…». Klokkeslett («kl 21») trekkes ut til metadata.
 */
export const addToWeekPlanTool = {
	name: 'add_to_week_plan',
	execute: async (args: { userId: string; weekOffset?: number; items: string[] }) => {
		const userId = args.userId;
		const weekOffset = Number.isFinite(args.weekOffset)
			? Math.max(0, Math.min(8, Math.trunc(args.weekOffset as number)))
			: 1; // default: neste uke
		const week = weekKeyForOffset(weekOffset);
		const context = `week:${week}`;
		const weekNum = week.split('-W')[1] ?? '';

		let checklist = await db.query.checklists.findFirst({
			where: and(eq(checklists.userId, userId), eq(checklists.context, context))
		});
		if (!checklist) {
			const [created] = await db
				.insert(checklists)
				.values({ userId, title: `Uke ${weekNum}`, emoji: '🗓️', context })
				.returning();
			checklist = created;
		}
		if (!checklist) return { error: 'Kunne ikke opprette ukelisten.' };

		const existing = await db.query.checklistItems.findMany({
			where: eq(checklistItems.checklistId, checklist.id),
			columns: { id: true }
		});
		let sortOrder = existing.length;

		const added: string[] = [];
		for (const raw of (args.items ?? []).map((s) => s.trim()).filter(Boolean)) {
			const parsed = parseListRepeatCount(raw, 1, MAX_REPEAT);
			const baseLabel = parsed.label || raw;
			const count = Math.max(1, parsed.repeatCount);
			const fields = await buildChecklistItemFields({
				userId,
				context,
				text: baseLabel,
				allowTaskCreation: false
			});
			const rows = Array.from({ length: count }, (_, i) => ({
				checklistId: checklist!.id,
				userId,
				text: count > 1 ? `${fields.text} (${i + 1}/${count})` : fields.text,
				startDate: fields.startDate,
				metadata: fields.metadata,
				sortOrder: sortOrder++
			}));
			await db.insert(checklistItems).values(rows);
			added.push(count > 1 ? `${fields.text} ×${count}` : fields.text);
		}

		// Var lista markert som ferdig, åpne den igjen så nye punkter teller.
		if (checklist.completedAt) {
			await db.update(checklists).set({ completedAt: null }).where(eq(checklists.id, checklist.id));
		}

		return { week, weekLabel: `Uke ${weekNum}`, added, count: added.length };
	}
};
