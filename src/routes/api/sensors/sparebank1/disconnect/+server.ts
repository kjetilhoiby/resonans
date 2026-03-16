import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { DEFAULT_USER_ID } from '$lib/server/users';
import type { RequestHandler } from './$types';

/**
 * Disconnect SpareBank1 account
 * POST /api/sensors/sparebank1/disconnect
 */
export const POST: RequestHandler = async () => {
	try {
		const userId = DEFAULT_USER_ID;

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
