import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildDreamReasons } from '$lib/server/egenfrekvens-dream-reasons';

export const GET: RequestHandler = async ({ locals }) => {
	const reasons = await buildDreamReasons(locals.userId);
	return json(reasons);
};
