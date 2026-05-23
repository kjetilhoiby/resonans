import { json } from '@sveltejs/kit';
import { produceActions } from '$lib/server/services/action-suggestion-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	const items = await produceActions(locals.userId);
	return json({ items });
};
