import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	try {
		const sensor = await db.query.sensors.findFirst({
			where: and(
				eq(sensors.userId, locals.userId),
				eq(sensors.provider, 'dropbox'),
				eq(sensors.type, 'workout_files')
			)
		});

		if (!sensor) {
			return json({ connected: false, sensor: null });
		}

		const config = (sensor.config ?? {}) as { expiresAt?: number; dropboxFolderPath?: string; lastImportedAt?: string };
		const isExpired = config.expiresAt ? Math.floor(Date.now() / 1000) > config.expiresAt : false;

		return json({
			connected: sensor.isActive,
			sensor: {
				id: sensor.id,
				name: sensor.name,
				provider: sensor.provider,
				type: sensor.type,
				lastSync: sensor.lastSync,
				lastError: sensor.lastError,
				isExpired,
				dropboxFolderPath: config.dropboxFolderPath || '',
				lastImportedAt: config.lastImportedAt || null,
				createdAt: sensor.createdAt
			}
		});
	} catch (error) {
		console.error('Dropbox status error:', error);
		return json({ error: 'Failed to get status' }, { status: 500 });
	}
};
