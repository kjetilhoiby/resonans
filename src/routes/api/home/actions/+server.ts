import { json } from '@sveltejs/kit';
import { produceActions } from '$lib/server/services/action-suggestion-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	const t0 = performance.now();
	const items = await produceActions(locals.userId);
	console.log(`[perf][home/actions] user=${locals.userId} step=total ms=${(performance.now() - t0).toFixed(0)} items=${items.length}`);
	return json({ items });
};
