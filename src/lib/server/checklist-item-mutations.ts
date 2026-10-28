/**
 * Endringer på ett sjekklistepunkt (dags-, uke- og prosjektlister): avkryssing,
 * hopp over, redigering, sletting og flytting — med bivirkningene.
 *
 * Bodde inline i `PATCH/DELETE /api/checklists/[id]/items/[itemId]` fram til
 * oktober 2026. Trukket ut da MCP-verktøyet `manage_plan_item` skulle krysse av
 * de samme punktene: en kopi av avkryssingen uten fremdrift, streak-runde og
 * speiling til ukepunktet ville sett ferdig ut i ChatGPT og vært halv i appen.
 * Endepunktet og verktøyet går nå gjennom de samme funksjonene.
 */

import { db } from '$lib/db';
import { checklistItems, checklists } from '$lib/db/schema';
import { and, count, eq, isNull, ne, sql } from 'drizzle-orm';
import { isWeekItemComplete } from '$lib/domain/week-item-target';
import { TaskExecutionService } from '$lib/server/services/task-execution-service';
import { parseTaskDateTime } from '$lib/server/date-time-parser';
import {
	buildChecklistItemFields,
	PARSE_DERIVED_METADATA_KEYS
} from '$lib/server/checklist-item-builder';
import { PersonMentionService } from '$lib/server/services/person-mention-service';
import { runInBackground } from '$lib/server/run-in-background';
import { syncStaysForDate } from '$lib/server/stays';
import { afterMealItemWritten, afterMealItemDeleted, moveMealPlanToDate } from '$lib/server/services/meal-plan-sync';
import { shouldParentBeChecked } from '$lib/components/domain/ukeplan/week-schedule-logic';
import { logStreakRound, deleteStreakRound } from '$lib/server/services/streak-service';

export type ChecklistItemRow = typeof checklistItems.$inferSelect;

export interface ChecklistItemUpdate {
	checked?: boolean;
	text?: string;
	sortOrder?: number;
	skipped?: boolean;
}

export async function syncChecklistCompletion(checklistId: string) {
	// Et item regnes som "behandlet" hvis det er enten avkrysset eller skipped.
	// Skipped items skal ikke blokkere fullføring av sjekklisten.
	const allItems = await db.query.checklistItems.findMany({
		where: eq(checklistItems.checklistId, checklistId),
		columns: { id: true, checked: true, skippedAt: true }
	});

	const remaining = allItems.filter((i) => !i.checked && !i.skippedAt);

	if (allItems.length > 0 && remaining.length === 0) {
		await db
			.update(checklists)
			.set({ completedAt: new Date() })
			.where(and(eq(checklists.id, checklistId), isNull(checklists.completedAt)));
		return;
	}

	await db.update(checklists).set({ completedAt: null }).where(eq(checklists.id, checklistId));
}

/**
 * Bivirkninger av å (av)krysse ett punkt: logg/fjern fremdrift for koblet
 * tema/mål-oppgave (linkedTaskId), og speil avkryssingen til et koblet
 * ukeliste-punkt (linkedChecklistItemId). Returnerer oppdatert metadata for
 * punktet (progressRecordId lagt til/fjernet).
 *
 * Kalles både for punktet som ble togglet direkte, og for en forelder som
 * auto-hakes når alle barna er ferdige — slik kaskaderer nedbrytning opp til
 * ukeplan.
 */
async function applyItemCheckedSideEffects(
	userId: string,
	item: typeof checklistItems.$inferSelect,
	checked: boolean
): Promise<Record<string, unknown>> {
	const meta = (item.metadata ?? {}) as Record<string, unknown>;
	let resultMeta: Record<string, unknown> = meta;

	// Koblet tema/mål-oppgave → fremdrift.
	const linkedTaskId = typeof meta.linkedTaskId === 'string' ? meta.linkedTaskId : null;
	if (checked && linkedTaskId && !meta.progressRecordId) {
		const progressRecord = await TaskExecutionService.recordTaskProgress({
			taskId: linkedTaskId,
			userId,
			value: 1,
			note: `Auto-loggert fra dagsjekkliste: "${item.text}"`,
			completedAt: item.checkedAt ?? new Date()
		});
		if (progressRecord) {
			resultMeta = { ...meta, progressRecordId: progressRecord.id };
			await db.update(checklistItems).set({ metadata: resultMeta }).where(eq(checklistItems.id, item.id));
		}
	} else if (!checked) {
		const progressRecordId = typeof meta.progressRecordId === 'string' ? meta.progressRecordId : null;
		if (progressRecordId) {
			await TaskExecutionService.deleteProgressRecord(progressRecordId);
			resultMeta = { ...meta };
			delete resultMeta.progressRecordId;
			await db.update(checklistItems).set({ metadata: resultMeta }).where(eq(checklistItems.id, item.id));
		}
	}

	// Koblet streak (periodisk vedlikehold) → logg/angre en runde. Samme hendelse
	// nullstiller forfallet og holder streaken i live, så det plukkede dag-punktet
	// er hele registreringen — ingen egen «marker som gjort» andre steder.
	const linkedStreakId = typeof meta.linkedStreakId === 'string' ? meta.linkedStreakId : null;
	if (linkedStreakId) {
		const existingEventId = typeof resultMeta.streakEventId === 'string' ? resultMeta.streakEventId : null;
		// En slettet eller omgjort streak skal aldri blokkere avkryssing av dag-punktet.
		try {
			if (checked && !existingEventId) {
				const eventId = await logStreakRound(userId, linkedStreakId, item.checkedAt ?? new Date());
				if (eventId) {
					resultMeta = { ...resultMeta, streakEventId: eventId };
					await db.update(checklistItems).set({ metadata: resultMeta }).where(eq(checklistItems.id, item.id));
				}
			} else if (!checked && existingEventId) {
				await deleteStreakRound(userId, existingEventId);
				resultMeta = { ...resultMeta };
				delete resultMeta.streakEventId;
				await db.update(checklistItems).set({ metadata: resultMeta }).where(eq(checklistItems.id, item.id));
			}
		} catch (err) {
			console.error('[streak] kunne ikke oppdatere runde for', linkedStreakId, err);
		}
	}

	// Koblet ukeliste-punkt → ferdig når nok dagpunkter er hakket av. Et punkt
	// med målet i parentes («Dele legging (3 ganger)») er ferdig først etter
	// tredje gang; et vanlig punkt følger dagpunktet som før. Regelen bor i
	// `isWeekItemComplete`, som ukeplanen og hjemskjermens brev også leser.
	const linkedChecklistItemId =
		typeof meta.linkedChecklistItemId === 'string' ? meta.linkedChecklistItemId : null;
	if (linkedChecklistItemId && linkedChecklistItemId !== item.id) {
		const weekItem = await db.query.checklistItems.findFirst({
			where: and(eq(checklistItems.id, linkedChecklistItemId), eq(checklistItems.userId, userId)),
			columns: { text: true }
		});
		if (weekItem) {
			const [{ others }] = await db
				.select({ others: count() })
				.from(checklistItems)
				.where(
					and(
						eq(checklistItems.userId, userId),
						eq(checklistItems.checked, true),
						ne(checklistItems.id, item.id),
						sql`${checklistItems.metadata}->>'linkedChecklistItemId' = ${linkedChecklistItemId}`
					)
				);
			const done = isWeekItemComplete(weekItem.text, Number(others) + (checked ? 1 : 0));
			const [linked] = await db
				.update(checklistItems)
				.set({ checked: done, checkedAt: done ? (item.checkedAt ?? new Date()) : null })
				.where(and(eq(checklistItems.id, linkedChecklistItemId), eq(checklistItems.userId, userId)))
				.returning({ checklistId: checklistItems.checklistId });
			if (linked?.checklistId) {
				await syncChecklistCompletion(linked.checklistId);
			}
		}
	}

	return resultMeta;
}

/**
 * Oppdater ett punkt som brukeren eier. `null` når punktet ikke finnes for
 * brukeren. Felt som ikke er med i `body`, røres ikke.
 */
export async function updateChecklistItem(
	userId: string,
	itemId: string,
	body: ChecklistItemUpdate
): Promise<ChecklistItemRow | null> {
	const existingItem = await db.query.checklistItems.findFirst({
		where: and(eq(checklistItems.id, itemId), eq(checklistItems.userId, userId))
	});

	if (!existingItem) return null;

	const updates: Record<string, unknown> = {};
	// Sted-punkt som re-parses til et sted skal trigge opphold-synk for dagen.
	let reparseLocationDayIso: string | null = null;
	// Kontekst for matplan-synk når teksten redigeres (dag-punkter).
	let editedContext: string | null = null;
	if (body.text !== undefined) {
		const itemChecklist = await db.query.checklists.findFirst({
			where: eq(checklists.id, existingItem.checklistId),
			columns: { context: true }
		});
		editedContext = itemChecklist?.context ?? null;

		// Parse-avledede metadata-nøkler nullstilles og bygges på nytt; øvrige
		// nøkler (f.eks. progressRecordId) beholdes.
		const preservedMetadata: Record<string, unknown> = {
			...((existingItem.metadata ?? {}) as Record<string, unknown>)
		};
		for (const k of PARSE_DERIVED_METADATA_KEYS) {
			delete preservedMetadata[k];
		}

		if (existingItem.parentId) {
			// Deloppgaver: behold den enklere dato/tid-parsingen (ingen oppgavekobling).
			const parsed = parseTaskDateTime(body.text);
			updates.text = parsed.text || body.text.trim();
			updates.startDate = parsed.startDate ?? null;
			if (parsed.hour !== undefined) preservedMetadata.timeHour = parsed.hour;
			if (parsed.minute !== undefined) preservedMetadata.timeMinute = parsed.minute;
			updates.metadata = preservedMetadata;
		} else {
			// Toppnivå-punkt: full re-parsing via felles builder — samme resultat som
			// når punktet legges til på nytt (tid, sted, reise, måltid, aktivitet,
			// kobling til eksisterende ukeoppgave). Vi oppretter ikke nye oppgaver
			// ved redigering.
			const fields = await buildChecklistItemFields({
				userId,
				context: itemChecklist?.context ?? null,
				text: body.text,
				allowTaskCreation: false
			});
			updates.text = fields.text;
			updates.startDate = fields.startDate;
			updates.metadata = { ...preservedMetadata, ...fields.metadata };
			reparseLocationDayIso = fields.locationDayIso;
		}
	}
	if (body.sortOrder !== undefined) updates.sortOrder = body.sortOrder;
	if (body.checked !== undefined) {
		updates.checked = body.checked;
		updates.checkedAt = body.checked ? new Date() : null;
		// Krysse av et item rydder opp skipped-status så det ikke ser ut som begge.
		if (body.checked) {
			updates.skippedAt = null;
			updates.snoozedToDate = null;
		}
	}
	if (body.skipped !== undefined) {
		updates.skippedAt = body.skipped ? new Date() : null;
		// Når man fjerner skipped manuelt nullstilles også snooze-koblingen.
		if (!body.skipped) updates.snoozedToDate = null;
		// Skipped + checked er ikke lov — skipped vinner siden brukeren eksplisitt valgte det.
		if (body.skipped) {
			updates.checked = false;
			updates.checkedAt = null;
		}
	}

	const [updated] = await db
		.update(checklistItems)
		.set(updates)
		.where(and(
			eq(checklistItems.id, itemId),
			eq(checklistItems.userId, userId)
		))
		.returning();

	// Re-index @-mentions hvis teksten ble endret — kjører i bakgrunnen via waitUntil.
	if (body.text !== undefined && updated) {
		runInBackground(PersonMentionService.indexChecklistItem(userId, updated.id, updated.text));
	}

	// Sted-punkt → re-synk opphold til reise-/ferieplan som dekker dagen.
	if (reparseLocationDayIso) {
		runInBackground(syncStaysForDate(userId, reparseLocationDayIso));
	}

	// Måltidspunkt redigert → speil endringen til meal_plans (matplan-synk).
	// Gjelder også når prefikset redigeres BORT (linkedMealPlanId uten mealType → rydd).
	if (
		body.text !== undefined &&
		updated &&
		!existingItem.parentId &&
		(updated.metadata?.mealType || updated.metadata?.linkedMealPlanId)
	) {
		runInBackground(afterMealItemWritten(userId, updated, editedContext));
	}

	// (Av)krysning: kjør link-bivirkninger for punktet (fremdrift + speiling til
	// koblet ukeliste-punkt), og kaskader oppover ved nedbrytning.
	if (body.checked !== undefined) {
		updated.metadata = await applyItemCheckedSideEffects(userId, updated, body.checked);

		// Forelder-auto-hak: er dette et barn, hak av (eller opphev) forelderen når
		// alle barna er ferdige. Forelderens egne koblinger kaskaderer videre — slik
		// resolves et nedbrutt ukeliste-punkt når «hele lista» er krysset ut.
		if (updated.parentId) {
			const siblings = await db.query.checklistItems.findMany({
				where: eq(checklistItems.parentId, updated.parentId),
				columns: { checked: true, skippedAt: true }
			});
			const parentShouldBeChecked = shouldParentBeChecked(
				siblings.map((s) => ({ checked: s.checked, skippedAt: s.skippedAt }))
			);
			const parent = await db.query.checklistItems.findFirst({
				where: and(eq(checklistItems.id, updated.parentId), eq(checklistItems.userId, userId))
			});
			if (parent && parent.checked !== parentShouldBeChecked) {
				const [updatedParent] = await db
					.update(checklistItems)
					.set({ checked: parentShouldBeChecked, checkedAt: parentShouldBeChecked ? new Date() : null })
					.where(eq(checklistItems.id, parent.id))
					.returning();
				await applyItemCheckedSideEffects(userId, updatedParent, parentShouldBeChecked);
			}
		}
	}

	await syncChecklistCompletion(updated.checklistId);

	return updated;
}

/** Slett ett punkt (og deloppgavene, via cascade). `null` når det ikke fantes. */
export async function deleteChecklistItem(userId: string, itemId: string): Promise<ChecklistItemRow[] | null> {
	const deleted = await db
		.delete(checklistItems)
		.where(and(eq(checklistItems.id, itemId), eq(checklistItems.userId, userId)))
		.returning();

	const deletedArray = Array.isArray(deleted) ? deleted : [];
	if (!deletedArray.length) return null;

	// Slettet måltidspunkt → slett meal_plans-raden det speilet (matplan-synk).
	for (const item of deletedArray) {
		if (item.metadata?.linkedMealPlanId) {
			runInBackground(afterMealItemDeleted(userId, item));
		}
	}

	await syncChecklistCompletion(deletedArray[0].checklistId);
	return deletedArray;
}

/**
 * Flytt ett punkt til en annen liste — SAMME rad, ny `checklistId`.
 *
 * Ikke det samme som «utsett» (`…/snooze`), som lager en kopi og stryker
 * originalen med vilje: der er sporet poenget («hva blir ofte utsatt?»). En
 * flytting er en rettelse av hvor punktet hører hjemme, og en kopi ville gitt
 * et strøket punkt på en dag det aldri skulle stått på. Id, avkryssing og
 * koblinger (oppgave, ukepunkt, person) følger med.
 *
 * Deloppgaver flyttes med forelderen, siden `checklistId` står på hver rad.
 */
export async function moveChecklistItem(
	userId: string,
	itemId: string,
	target: { checklistId: string; dayIso: string | null }
): Promise<ChecklistItemRow | null> {
	const item = await db.query.checklistItems.findFirst({
		where: and(eq(checklistItems.id, itemId), eq(checklistItems.userId, userId))
	});
	if (!item) return null;
	if (item.checklistId === target.checklistId) return item;

	const last = await db.query.checklistItems.findFirst({
		where: eq(checklistItems.checklistId, target.checklistId),
		orderBy: (items, { desc }) => [desc(items.sortOrder)],
		columns: { sortOrder: true }
	});
	const sourceChecklistId = item.checklistId;

	const [moved] = await db
		.update(checklistItems)
		.set({ checklistId: target.checklistId, sortOrder: (last?.sortOrder ?? -1) + 1 })
		.where(and(eq(checklistItems.id, itemId), eq(checklistItems.userId, userId)))
		.returning();
	await db
		.update(checklistItems)
		.set({ checklistId: target.checklistId })
		.where(and(eq(checklistItems.parentId, itemId), eq(checklistItems.userId, userId)));

	// Måltidspunkt: plan-raden flyttes med, så ukemeny og handleliste følger.
	if (target.dayIso && typeof moved.metadata?.linkedMealPlanId === 'string') {
		runInBackground(moveMealPlanToDate(userId, moved.metadata.linkedMealPlanId, target.dayIso));
	}

	await syncChecklistCompletion(sourceChecklistId);
	await syncChecklistCompletion(target.checklistId);
	return moved;
}
