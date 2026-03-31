import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals }) => {
	await db
		.update(sensors)
		.set({ isActive: false, credentials: null, updatedAt: new Date() })
		.where(
			and(
				eq(sensors.userId, locals.userId),
				eq(sensors.provider, 'google_sheets'),
				eq(sensors.type, 'spreadsheet')
			)
		);

	return json({ success: true });
};
