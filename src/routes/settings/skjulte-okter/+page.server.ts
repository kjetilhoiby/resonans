import { fail } from '@sveltejs/kit';
import { listHiddenWorkouts, restoreHiddenWorkout } from '$lib/server/workouts/hidden-workouts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const hidden = await listHiddenWorkouts(locals.userId);
	return { hidden };
};

export const actions = {
	restore: async ({ request, locals }) => {
		const formData = await request.formData();
		const id = formData.get('id');
		const scopeRaw = formData.get('scope');
		if (typeof id !== 'string' || !id) return fail(400, { error: 'id mangler' });

		const scope = scopeRaw === 'source' ? 'source' : 'activity';
		const result = await restoreHiddenWorkout(locals.userId, id, scope);
		if (!result.ok) return fail(404, { error: 'Fant ikke den skjulte økta' });

		return { success: true };
	}
} satisfies Actions;
