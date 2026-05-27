import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getFullProgram } from '$lib/server/programs/repository';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.userId) throw error(401, 'Unauthorized');
	const program = await getFullProgram(locals.userId, params.id);
	if (!program) throw error(404, 'Program ikke funnet');
	return { program };
};
