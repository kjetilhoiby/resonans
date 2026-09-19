/**
 * Livskompassets sensor-rad, delt av innsjekkene og nedprioriteringene.
 *
 * Egen fil for å bryte en sirkel: `livskompass-checkin.ts` leser
 * nedprioriteringene inn i statusen, og `livskompass-deprioritization.ts`
 * trenger sensoren å skrive på. Lå hjelperen hos den ene, importerte de to
 * modulene hverandre — samme grunn som `loadMerchantMappings` ble flyttet ut av
 * `spending-analyzer.ts`.
 */

import { and, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';

export async function getOrCreateLivskompassSensor(userId: string) {
	const existing = await db.query.sensors.findFirst({
		where: and(eq(sensors.userId, userId), eq(sensors.provider, 'livskompass_checkin'))
	});
	if (existing) return existing;
	const [created] = await db
		.insert(sensors)
		.values({
			userId,
			provider: 'livskompass_checkin',
			type: 'manual_log',
			subtype: 'livskompass_weekly',
			name: 'Livskompasset',
			isActive: true,
			config: { sliderRange: '1_10', cadence: 'weekly' }
		})
		.returning();
	return created;
}
