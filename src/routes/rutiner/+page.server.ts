import { listRoutineDefinitions } from '$lib/server/services/routine-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.userId;
	const routines = await listRoutineDefinitions(userId, { includeInactive: false });

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
		}))
	};
};
