import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getConnection, resolvePendingUploads } from '$lib/server/services/strava-sync-service';

/**
 * Strava-tilkoblingsstatus. Bearer-autentisert (locals.userId settes av hooks).
 * Poller samtidig ut eventuelle ventende opplastinger (lazy), så ekkos polling
 * i Innstillinger driver oppløsningen av pending → ok/duplicate/error.
 */
export const GET: RequestHandler = async ({ locals }) => {
	const userId = locals.userId;
	if (!userId) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	// Best effort — skal aldri velte status-svaret.
	try {
		await resolvePendingUploads(userId);
	} catch (err) {
		console.warn('Strava resolvePendingUploads feilet:', err);
	}

	const connection = await getConnection(userId);
	if (!connection) {
		return json({ connected: false });
	}

	return json({
		connected: true,
		athleteId: connection.athleteId ?? undefined,
		athleteName: connection.athleteName ?? undefined,
		lastSyncAt: connection.lastSyncAt ? connection.lastSyncAt.toISOString() : undefined,
		lastSyncStatus: connection.lastSyncStatus ?? undefined,
		lastSyncError: connection.lastSyncError ?? undefined
	});
};
