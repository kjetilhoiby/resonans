import { fail } from '@sveltejs/kit';
import { listSnoozesForUser, clearSnooze } from '$lib/server/action-snoozes';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const snoozes = await listSnoozesForUser(locals.userId, new Date());
	return { snoozes };
};

export const actions = {
	clear: async ({ request, locals }) => {
		const formData = await request.formData();
		const chipId = formData.get('chipId');
		if (typeof chipId !== 'string' || !chipId) {
			return fail(400, { error: 'chipId mangler' });
		}
		await clearSnooze(locals.userId, chipId);
		return { success: true };
	}
} satisfies Actions;
