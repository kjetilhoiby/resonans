import { and, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { checklists, checklistItems } from '$lib/db/schema';
import { localIsoWeek } from '$lib/domains/livskompass/dimensions';
import { parseListRepeatCount } from '$lib/server/list-repeat-parser';
import { buildChecklistItemFields } from '$lib/server/checklist-item-builder';
import { recordLivskompassGoals } from '$lib/server/livskompass-checkin';
import { normalizeWeekPlanItems, type WeekPlanItemInput } from './week-plan-items';

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
 *
 * Punkter kan sendes som objekter med `dimension` (livskompass-dimensjons-id):
 * da tagges de som kompass-mål (metadata.source = 'livskompass') og
 * ett-poengs-intensjonen persisteres som `livskompass_goal`-event for uka —
 * det er dette som lar neste innsjekk lukke sløyfa.
 */
export const addToWeekPlanTool = {
	name: 'add_to_week_plan',
	execute: async (args: { userId: string; weekOffset?: number; items: WeekPlanItemInput[] }) => {
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

		const normalizedItems = normalizeWeekPlanItems(args.items);
		const added: string[] = [];
		for (const input of normalizedItems) {
			const parsed = parseListRepeatCount(input.text, 1, MAX_REPEAT);
			const baseLabel = parsed.label || input.text;
			const count = Math.max(1, parsed.repeatCount);
			const fields = await buildChecklistItemFields({
				userId,
				context,
				text: baseLabel,
				allowTaskCreation: false
			});
			// Kompass-mål merkes så de kan vises som 🧭 og telles opp ved neste innsjekk.
			const kompassMeta = input.dimension
				? { source: 'livskompass', livskompassDimension: input.dimension }
				: {};
			const rows = Array.from({ length: count }, (_, i) => ({
				checklistId: checklist!.id,
				userId,
				text: count > 1 ? `${fields.text} (${i + 1}/${count})` : fields.text,
				startDate: fields.startDate,
				metadata: { ...fields.metadata, ...kompassMeta },
				sortOrder: sortOrder++
			}));
			await db.insert(checklistItems).values(rows);
			added.push(count > 1 ? `${fields.text} ×${count}` : fields.text);
		}

		// Var lista markert som ferdig, åpne den igjen så nye punkter teller.
		if (checklist.completedAt) {
			await db.update(checklists).set({ completedAt: null }).where(eq(checklists.id, checklist.id));
		}

		// Dimensjons-taggede punkter = ett-poengs-mål → persister intensjonen for uka.
		const dimensionIds = [
			...new Set(normalizedItems.map((i) => i.dimension).filter((d): d is string => !!d))
		];
		let livskompassGoals: Awaited<ReturnType<typeof recordLivskompassGoals>> = [];
		if (dimensionIds.length) {
			try {
				livskompassGoals = await recordLivskompassGoals({ userId, week, dimensionIds });
			} catch (error) {
				console.warn('[add_to_week_plan] kunne ikke lagre livskompass-mål:', error);
			}
		}

		return {
			week,
			weekLabel: `Uke ${weekNum}`,
			added,
			count: added.length,
			...(livskompassGoals.length > 0 && { livskompassGoals })
		};
	}
};
