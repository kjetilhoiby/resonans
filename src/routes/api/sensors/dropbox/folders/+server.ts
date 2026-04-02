import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { getValidDropboxAccessToken } from '$lib/server/integrations/dropbox-sync';
import { listDropboxFolder } from '$lib/server/integrations/dropbox';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	try {
		const path = url.searchParams.get('path') ?? '';
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

		const accessToken = await getValidDropboxAccessToken(sensor);
		const listing = await listDropboxFolder(accessToken, path);
		const folders = listing.entries
			.filter((entry) => entry['.tag'] === 'folder')
			.map((entry) => ({
				id: entry.id,
				name: entry.name,
				path: entry.path_display || entry.path_lower || ''
			}))
			.sort((a, b) => a.name.localeCompare(b.name, 'nb'));

		return json({
			path,
			folders,
			count: folders.length
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return json({ error: message }, { status: 500 });
	}
};
