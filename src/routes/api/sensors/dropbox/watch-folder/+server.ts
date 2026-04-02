import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		const body = await request.json() as { path?: string };
		const path = typeof body.path === 'string' ? body.path.trim() : '';

		const sensor = await db.query.sensors.findFirst({
			where: and(
				eq(sensors.userId, locals.userId),
				eq(sensors.provider, 'dropbox'),
				eq(sensors.type, 'workout_files'),
				eq(sensors.isActive, true)
			)
		});

		if (!sensor) {
			return json({ error: 'Dropbox er ikke koblet til' }, { status: 401 });
		}

		const config = (sensor.config ?? {}) as Record<string, unknown>;
		await db.update(sensors)
			.set({
				config: {
					...config,
					dropboxFolderPath: path,
					dropboxCursor: null
				},
				updatedAt: new Date(),
				lastError: null
			})
			.where(eq(sensors.id, sensor.id));

		return json({
			success: true,
			message: path ? `Overvåker mappe: ${path}` : 'Mappevalg nullstilt',
			path
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return json({ error: message }, { status: 500 });
	}
};
