import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { checklistItems, checklists } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { parseListRepeatCount } from '$lib/server/list-repeat-parser';
import { parseChecklistItemIntent, findLinkedTask, stripTimeFromText } from '$lib/server/checklist-intent-linker';
import { getOrCreatePlanningGoal, createTask } from '$lib/server/goals';
import { enqueueBackgroundJob } from '$lib/server/background-jobs';

/** Extract week keys from a checklist context string like "week:2026-W16:day:2026-04-13" */
function extractWeekKeys(context: string | null): { dashedKey: string; compactKey: string } | null {
	if (!context) return null;
	const m = context.match(/week:(\d{4}-W\d{2})/);
	if (!m) return null;
	const dashedKey = m[1]; // "2026-W16"
	const compactKey = dashedKey.replace('-', ''); // "2026W16"
	return { dashedKey, compactKey };
}

// POST /api/checklists/[id]/items — legg til et nytt punkt
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;
	const { text, sortOrder = 9999, count = 1, parentId } = await request.json() as {
		text: string;
		sortOrder?: number;
		count?: number;
		parentId?: string;
	};

	if (!text) return json({ error: 'text er påkrevd' }, { status: 400 });

	// Load checklist to get context (for week key extraction)
	const checklist = await db.query.checklists.findFirst({
		where: and(eq(checklists.id, params.id), eq(checklists.userId, userId)),
		columns: { id: true, context: true }
	});
	if (!checklist) return json({ error: 'Sjekkliste ikke funnet' }, { status: 404 });

	const parsed = parseListRepeatCount(text, count || 1, 12);
	const repeatCount = parsed.repeatCount;

	// --- Intent parsing + task linking (only for single items, not repeat patterns) ---
	let itemMetadata: Record<string, unknown> = {};
	if (repeatCount === 1 && !parentId) {
		// Only parse intent for non-subtask items
		const weekKeys = extractWeekKeys(checklist.context);
		const isWeekLevel = weekKeys !== null && !checklist.context!.includes(':day:');
		const intent = parseChecklistItemIntent(parsed.label);

		if (isWeekLevel && weekKeys) {
			// Wake-time items: store target metadata, no linked task needed
			if (intent.wakeTargetHour !== undefined) {
				itemMetadata = {
					wakeTargetHour: intent.wakeTargetHour,
					wakeTargetMinute: intent.wakeTargetMinute ?? 0
				};
			} else {
			// Week-level items: always create (or find) a task so progress can be tracked
			const linkedTask = await findLinkedTask({
				userId,
				itemText: parsed.label,
				weekDashedKey: weekKeys.dashedKey,
				weekCompactKey: weekKeys.compactKey
			});

			if (linkedTask) {
				itemMetadata = {
					linkedTaskId: linkedTask.taskId,
					linkedTaskTitle: linkedTask.taskTitle,
					...(intent.activityType && { activityType: intent.activityType }),
					...(intent.durationMinutes !== undefined && { durationMinutes: intent.durationMinutes }),
					...(intent.distanceKm !== undefined && { distanceKm: intent.distanceKm })
				};
			} else {
				// No existing task — create one under the planning goal
				try {
					const planningGoalId = await getOrCreatePlanningGoal(userId);
					const newTask = await createTask({
						goalId: planningGoalId,
						title: parsed.label,
						frequency: 'weekly',
						periodType: 'week',
						periodId: weekKeys.dashedKey,
						...(intent.activityType && { unit: intent.activityType }),
					});
					await enqueueBackgroundJob({
						userId,
						type: 'task_intent_parse',
						payload: { taskId: newTask.id, rawText: parsed.label },
						priority: 8,
						maxAttempts: 2
					});
					itemMetadata = {
						linkedTaskId: newTask.id,
						linkedTaskTitle: parsed.label,
						...(intent.activityType && { activityType: intent.activityType }),
						...(intent.durationMinutes !== undefined && { durationMinutes: intent.durationMinutes }),
						...(intent.distanceKm !== undefined && { distanceKm: intent.distanceKm })
					};
				} catch (err) {
					console.warn('[checklist items] Failed to create task for week item:', err);
				}
			}
			} // end non-wake branch
		} else if (weekKeys) {
			// Day-level items: parse time + optionally link to existing task
			const timeFields = intent.timeHour !== undefined
				? { timeHour: intent.timeHour, timeMinute: intent.timeMinute ?? 0 }
				: {};

			if (intent.matched) {
				const linkedTask = await findLinkedTask({
					userId,
					itemText: parsed.label,
					weekDashedKey: weekKeys.dashedKey,
					weekCompactKey: weekKeys.compactKey
				});

				if (linkedTask) {
					itemMetadata = {
						...timeFields,
						linkedTaskId: linkedTask.taskId,
						linkedTaskTitle: linkedTask.taskTitle,
						activityType: intent.activityType,
						...(intent.durationMinutes !== undefined && { durationMinutes: intent.durationMinutes }),
						...(intent.distanceKm !== undefined && { distanceKm: intent.distanceKm })
					};
				} else if (intent.activityType) {
					itemMetadata = {
						...timeFields,
						activityType: intent.activityType,
						...(intent.durationMinutes !== undefined && { durationMinutes: intent.durationMinutes }),
						...(intent.distanceKm !== undefined && { distanceKm: intent.distanceKm })
					};
				} else {
					itemMetadata = { ...timeFields };
				}
			} else if (Object.keys(timeFields).length > 0) {
				itemMetadata = { ...timeFields };
			}
		}
	}

	// Wake-time items propagate metadata to all repeat slots
	const slotMeta = (itemMetadata.wakeTargetHour !== undefined)
		? itemMetadata
		: null;
	const baseLabel = itemMetadata.timeHour !== undefined ? stripTimeFromText(parsed.label) : parsed.label;
	const createdItems = await db.insert(checklistItems).values(
		Array.from({ length: repeatCount }, (_, index) => ({
			checklistId: params.id,
			userId,
			parentId: parentId || null, // Support subtasks
			text: repeatCount > 1 ? `${baseLabel} (${index + 1}/${repeatCount})` : baseLabel,
			sortOrder: sortOrder + index,
			...(slotMeta
				? { metadata: slotMeta }
				: repeatCount === 1 && Object.keys(itemMetadata).length > 0 ? { metadata: itemMetadata } : {})
		}))
	).returning();

	return json(createdItems, { status: 201 });
};
