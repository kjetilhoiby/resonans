import { and, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import type { ExternalAppConfig } from '$lib/server/app-registry';

/**
 * Sensoren en ekstern app skriver under, slått opp på `provider` fra
 * `APP_REGISTRY`. Null når appen aldri har skrevet noe for brukeren.
 *
 * NB: `/api/apps/event`, `/api/apps/upload` og `healthkit/*` har hver sin private
 * kopi av get-or-create. De er ikke flyttet hit ennå; nye endepunkter bruker denne.
 */
export async function findAppSensorId(userId: string, app: ExternalAppConfig): Promise<string | null> {
	const existing = await db.query.sensors.findFirst({
		where: and(eq(sensors.userId, userId), eq(sensors.provider, app.sensorProvider))
	});
	return existing?.id ?? null;
}

export async function getOrCreateAppSensorId(userId: string, app: ExternalAppConfig): Promise<string> {
	const existing = await findAppSensorId(userId, app);
	if (existing) return existing;

	const [created] = await db
		.insert(sensors)
		.values({
			userId,
			provider: app.sensorProvider,
			type: app.sensorType,
			subtype: app.sensorSubtype,
			name: app.label,
			isActive: true
		})
		.returning();
	return created.id;
}
