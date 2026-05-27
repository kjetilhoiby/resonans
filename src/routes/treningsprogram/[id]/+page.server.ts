import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getFullProgram } from '$lib/server/programs/repository';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.userId) throw error(401, 'Unauthorized');
	let program;
	try {
		program = await getFullProgram(locals.userId, params.id);
	} catch (err) {
		console.error('[treningsprogram/:id] getFullProgram feilet', err);
		throw error(503, 'Programmer-tabellen er ikke synkronisert ennå. Prøv igjen om noen sekunder.');
	}
	if (!program) throw error(404, 'Program ikke funnet');
	return { program };
};
