import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

/**
 * Disconnect SpareBank1 account
 * POST /api/sensors/sparebank1/disconnect
 */
export const POST: RequestHandler = async ({ locals }) => {
	try {
		const userId = locals.userId;

		await db
			.update(sensors)
			.set({
				isActive: false,
				updatedAt: new Date()
			})
			.where(and(eq(sensors.userId, userId), eq(sensors.provider, 'sparebank1')));

		return json({ success: true });
	} catch (error) {
		console.error('SpareBank1 disconnect error:', error);
		return json({ error: 'Failed to disconnect' }, { status: 500 });
	}
};
