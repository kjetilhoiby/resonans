import { json } from '@sveltejs/kit';
import { syncAllCategorizedEvents } from '$lib/server/integrations/categorized-events';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals }) => {
	const userId = locals.userId;
	const result = await syncAllCategorizedEvents(userId);

	return json({
		processed: result.processed,
		synced: result.synced,
		updated: result.synced
	});
};
