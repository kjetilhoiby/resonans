import { json, error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { groceryOrders, sensors } from '$lib/db/schema';
import { and, eq, max, count } from 'drizzle-orm';
import { isRemaConfigured } from '$lib/server/integrations/rema';
import { REMA_PROVIDER } from '$lib/server/integrations/rema-sync';
import type { RequestHandler } from './$types';

/** GET /api/sensors/rema/status */
export const GET: RequestHandler = async ({ locals }) => {
	const userId = locals.userId;
	if (!userId) throw error(401, 'Ikke innlogget');

	const sensor = await db.query.sensors.findFirst({
		where: and(eq(sensors.userId, userId), eq(sensors.provider, REMA_PROVIDER), eq(sensors.isActive, true))
	});
	const [receipts] = await db
		.select({ count: count(), latest: max(groceryOrders.purchasedAt) })
		.from(groceryOrders)
		.where(and(eq(groceryOrders.userId, userId), eq(groceryOrders.provider, REMA_PROVIDER)));

	return json({
		configured: isRemaConfigured(),
		connected: Boolean(sensor),
		sensor: sensor
			? { id: sensor.id, lastSync: sensor.lastSync, lastError: sensor.lastError }
			: null,
		receipts: { count: receipts?.count ?? 0, latestPurchase: receipts?.latest ?? null }
	});
};
