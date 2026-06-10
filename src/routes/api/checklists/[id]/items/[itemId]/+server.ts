import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { checklistItems, checklists, progress } from '$lib/db/schema';
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

	// When an item is checked and it has a linked task, log a progress record
	if (body.checked === true) {
		const meta = (updated.metadata ?? {}) as Record<string, unknown>;
		const linkedTaskId = typeof meta.linkedTaskId === 'string' ? meta.linkedTaskId : null;

		if (linkedTaskId && !meta.progressRecordId) {
			const progressRecord = await TaskExecutionService.recordTaskProgress({
				taskId: linkedTaskId,
				userId,
				value: 1,
				note: `Auto-loggert fra dagsjekkliste: "${updated.text}"`,
				completedAt: updated.checkedAt ?? new Date()
			});

			if (progressRecord) {
				// Store the progress record ID in metadata so we don't double-log
				await db
					.update(checklistItems)
					.set({ metadata: { ...meta, progressRecordId: progressRecord.id } })
					.where(eq(checklistItems.id, updated.id));

				updated.metadata = { ...meta, progressRecordId: progressRecord.id };
			}
		}
	}

	// When an item is unchecked, remove the progress record if present
	if (body.checked === false) {
		const meta = (updated.metadata ?? {}) as Record<string, unknown>;
		const progressRecordId = typeof meta.progressRecordId === 'string' ? meta.progressRecordId : null;

		if (progressRecordId) {
			await TaskExecutionService.deleteProgressRecord(progressRecordId);

			const newMeta = { ...meta };
			delete newMeta.progressRecordId;
			await db
				.update(checklistItems)
				.set({ metadata: newMeta })
				.where(eq(checklistItems.id, updated.id));

			updated.metadata = newMeta;
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
