import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { checklistItems, checklists, progress } from '$lib/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { TaskExecutionService } from '$lib/server/services/task-execution-service';

async function syncChecklistCompletion(checklistId: string) {
	const remaining = await db.query.checklistItems.findMany({
		where: and(eq(checklistItems.checklistId, checklistId), eq(checklistItems.checked, false)),
		columns: { id: true }
	});

	const allItems = await db.query.checklistItems.findMany({
		where: eq(checklistItems.checklistId, checklistId),
		columns: { id: true }
	});

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
	const body = await request.json() as { checked?: boolean; text?: string; sortOrder?: number };

	const updates: Record<string, unknown> = {};
	if (body.text !== undefined) updates.text = body.text;
	if (body.sortOrder !== undefined) updates.sortOrder = body.sortOrder;
	if (body.checked !== undefined) {
		updates.checked = body.checked;
		updates.checkedAt = body.checked ? new Date() : null;
	}

	const [updated] = await db
		.update(checklistItems)
		.set(updates)
		.where(and(
			eq(checklistItems.id, params.itemId),
			eq(checklistItems.userId, userId)
		))
		.returning();

	if (!updated) return json({ error: 'Ikke funnet' }, { status: 404 });

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

	if (!deleted.length) return json({ error: 'Ikke funnet' }, { status: 404 });

	await syncChecklistCompletion(params.id);

	return json({ ok: true });
};
