import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getLunchboxOverview, osloToday } from '$lib/server/services/lunchbox-service';

// GET /api/food/lunchbox?date=YYYY-MM-DD&seed=N — dagens matpakke-oversikt.
// seed brukes av «Foreslå annet» for å få en ny variant.
export const GET: RequestHandler = async ({ url, locals }) => {
	const userId = locals.userId;
	const date = url.searchParams.get('date') ?? osloToday();
	const seedParam = url.searchParams.get('seed');
	const overview = await getLunchboxOverview(userId, date, {
		seed: seedParam ? Number(seedParam) : undefined
	});
	return json(overview);
};
