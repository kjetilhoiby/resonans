import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import type { RequestHandler } from './$types';

/**
 * Koble fra Tesla (soft delete — markerer sensoren inaktiv).
 * POST /api/sensors/tesla/disconnect
 */
export const POST: RequestHandler = async ({ locals }) => {
	try {
		const userId = locals.userId;
		await db
			.update(sensors)
			.set({ isActive: false, updatedAt: new Date() })
			.where(and(eq(sensors.userId, userId), eq(sensors.provider, 'tesla')));
		return json({ success: true });
	} catch (error) {
		console.error('Tesla disconnect error:', error);
		return json({ error: 'Failed to disconnect' }, { status: 500 });
	}
};
