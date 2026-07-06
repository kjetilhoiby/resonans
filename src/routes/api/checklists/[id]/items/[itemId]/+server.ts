import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { checklistItems, checklists } from '$lib/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { TaskExecutionService } from '$lib/server/services/task-execution-service';
import { parseTaskDateTime } from '$lib/server/date-time-parser';
import {
	buildChecklistItemFields,
	PARSE_DERIVED_METADATA_KEYS
} from '$lib/server/checklist-item-builder';
import { PersonMentionService } from '$lib/server/services/person-mention-service';
import { runInBackground } from '$lib/server/run-in-background';
import { syncStaysForDate } from '$lib/server/stays';
import { shouldParentBeChecked } from '$lib/components/domain/ukeplan/week-schedule-logic';

async function syncChecklistCompletion(checklistId: string) {
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

	// Koblet ukeliste-punkt → speil avkryssingen.
	const linkedChecklistItemId =
		typeof meta.linkedChecklistItemId === 'string' ? meta.linkedChecklistItemId : null;
	if (linkedChecklistItemId && linkedChecklistItemId !== item.id) {
		const [linked] = await db
			.update(checklistItems)
			.set({ checked, checkedAt: checked ? (item.checkedAt ?? new Date()) : null })
			.where(and(eq(checklistItems.id, linkedChecklistItemId), eq(checklistItems.userId, userId)))
			.returning({ checklistId: checklistItems.checklistId });
		if (linked?.checklistId) {
			await syncChecklistCompletion(linked.checklistId);
		}
	}

	return resultMeta;
}

// PATCH /api/checklists/[id]/items/[itemId] — toggle checked / endre tekst
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;
	const body = await request.json() as { checked?: boolean; text?: string; sortOrder?: number; skipped?: boolean };

	const existingItem = await db.query.checklistItems.findFirst({
		where: and(eq(checklistItems.id, params.itemId), eq(checklistItems.userId, userId))
	});

	if (!existingItem) return json({ error: 'Ikke funnet' }, { status: 404 });

	const updates: Record<string, unknown> = {};
	// Sted-punkt som re-parses til et sted skal trigge opphold-synk for dagen.
	let reparseLocationDayIso: string | null = null;
	if (body.text !== undefined) {
		const itemChecklist = await db.query.checklists.findFirst({
			where: eq(checklists.id, existingItem.checklistId),
			columns: { context: true }
		});

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
			eq(checklistItems.id, params.itemId),
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

	await syncChecklistCompletion(params.id);

	return json(updated);
};

// DELETE /api/checklists/[id]/items/[itemId]
export const DELETE: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;

	const deleted = await db
		.delete(checklistItems)
		.where(and(
			eq(checklistItems.id, params.itemId),
			eq(checklistItems.userId, userId)
		))
		.returning();

	const deletedArray = Array.isArray(deleted) ? deleted : [];
	if (!deletedArray.length) return json({ error: 'Ikke funnet' }, { status: 404 });

	await syncChecklistCompletion(params.id);

	return json({ ok: true });
};
