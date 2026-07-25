import { listRoutineDefinitions, materializeTodaysRoutines } from '$lib/server/services/routine-service';
import { loadStreaks } from '$lib/server/services/streak-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.userId;
	const [routines, todaysRoutines, streaks] = await Promise.all([
		listRoutineDefinitions(userId, { includeInactive: false }),
		materializeTodaysRoutines(userId),
		// Streaks hører hjemme her: en streak er «hvor godt holder jeg rutinen».
		loadStreaks(userId)
	]);

	return {
		streaks: streaks.map((s) => ({
			definition: {
				id: s.definition.id,
				title: s.definition.title,
				emoji: s.definition.emoji,
				rule: s.definition.rule,
				source: s.definition.source
			},
			state: s.state
		})),
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
