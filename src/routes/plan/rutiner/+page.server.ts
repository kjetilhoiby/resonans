import { listRoutineDefinitions, materializeTodaysRoutines } from '$lib/server/services/routine-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.userId;
	const [routines, todaysRoutines] = await Promise.all([
		listRoutineDefinitions(userId, { includeInactive: false }),
		materializeTodaysRoutines(userId)
	]);

	return {
		routines: routines.map((r) => ({
			id: r.id,
			title: r.title,
			emoji: r.emoji,
			slot: r.slot,
			daysOfWeek: r.daysOfWeek,
			items: r.items,
			active: r.active,
			sortOrder: r.sortOrder
		})),
		todaysRoutines: todaysRoutines.map((r) => ({
			definitionId: r.definition.id,
			title: r.definition.title,
			emoji: r.definition.emoji,
			slot: r.definition.slot,
			checklistId: r.checklistId,
			date: r.date,
			completedAt: r.completedAt ? r.completedAt.toISOString() : null,
			items: r.items.map((it) => ({
				id: it.id,
				text: it.text,
				checked: it.checked,
				sortOrder: it.sortOrder,
				estimateMinutes: it.estimateMinutes
			}))
		}))
	};
};
