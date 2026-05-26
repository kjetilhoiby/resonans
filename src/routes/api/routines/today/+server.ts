import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { materializeTodaysRoutines } from '$lib/server/services/routine-service';

export const GET: RequestHandler = async ({ locals }) => {
	const userId = locals.userId;
	const routines = await materializeTodaysRoutines(userId);
	return json(routines);
};
