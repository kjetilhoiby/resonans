import { json, error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { REMA_PROVIDER } from '$lib/server/integrations/rema-sync';
import type { RequestHandler } from './$types';

/**
 * POST /api/sensors/rema/disconnect
 *
 * Sletter tokens og stopper synken. Kvitteringene som alt er hentet blir
 * liggende — de er brukerens historikk, og Rema sletter dem ikke selv om vi
 * kobler fra.
 */
export const POST: RequestHandler = async ({ locals }) => {
	const userId = locals.userId;
	if (!userId) throw error(401, 'Ikke innlogget');
	await db
		.update(sensors)
		.set({ isActive: false, credentials: null, updatedAt: new Date() })
		.where(and(eq(sensors.userId, userId), eq(sensors.provider, REMA_PROVIDER)));
	return json({ success: true });
};
