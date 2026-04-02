import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals }) => {
	try {
		await db.update(sensors)
			.set({
				isActive: false,
				updatedAt: new Date()
			})
			.where(and(
				eq(sensors.userId, locals.userId),
				eq(sensors.provider, 'dropbox'),
				eq(sensors.type, 'workout_files')
			));

		return json({ success: true });
	} catch (error) {
		console.error('Dropbox disconnect error:', error);
		return json({ error: 'Failed to disconnect Dropbox' }, { status: 500 });
	}
};
