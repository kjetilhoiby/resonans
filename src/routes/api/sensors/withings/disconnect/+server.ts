import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import type { RequestHandler } from './$types';

/**
 * Disconnect Withings account
 * POST /api/sensors/withings/disconnect
 */
export const POST: RequestHandler = async ({ locals }) => {
	try {
		const userId = locals.userId;

		// Soft delete: mark as inactive
		await db.update(sensors)
			.set({
				isActive: false,
				updatedAt: new Date()
			})
			.where(
				and(
					eq(sensors.userId, userId),
					eq(sensors.provider, 'withings')
				)
			);

		return json({ success: true });
	} catch (error) {
		console.error('Withings disconnect error:', error);
		return json({ error: 'Failed to disconnect' }, { status: 500 });
	}
};
