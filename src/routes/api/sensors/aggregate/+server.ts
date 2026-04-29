import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { aggregateAllPeriods, aggregatePeriodsFrom } from '$lib/server/integrations/aggregation';

/**
 * POST /api/sensors/aggregate
 * Optional body: { fromDate: 'YYYY-MM-DD' } to limit scope to periods overlapping that date.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		const userId = locals.userId;
		const body = await request.json().catch(() => ({}));
		const fromDate = body?.fromDate ? new Date(body.fromDate) : null;

		if (fromDate && !isNaN(fromDate.getTime())) {
			await aggregatePeriodsFrom(userId, fromDate);
		} else {
			await aggregateAllPeriods(userId);
		}

		return json({ success: true });
	} catch (err) {
		console.error('Aggregation error:', err);
		throw error(500, 'Failed to aggregate sensor data');
	}
};
