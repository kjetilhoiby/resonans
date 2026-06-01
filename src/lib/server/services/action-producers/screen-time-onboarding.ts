import type { ActionProducer } from '../action-suggestion-service';
import type { ActionCandidate } from '$lib/types/actions';
import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';

/**
 * Onboarding-chip i hjemmeskjermens action-carousel: «Registrer skjermtid».
 * Vises kun til brukeren har registrert skjermtid (dvs. screen_time-sensoren
 * er opprettet ved første lagring), og forsvinner etterpå.
 */
export const screenTimeOnboardingProducer: ActionProducer = async (ctx) => {
	try {
		const existing = await db
			.select({ id: sensors.id })
			.from(sensors)
			.where(and(eq(sensors.userId, ctx.userId), eq(sensors.provider, 'screen_time')))
			.limit(1);

		if (existing.length > 0) return [];

		const candidate: ActionCandidate = {
			id: 'screen-time-onboarding',
			icon: '📱',
			label: 'Registrer skjermtid',
			priority: 45,
			source: 'onboarding',
			intent: { kind: 'navigate', href: '/skjermtid' }
		};
		return [candidate];
	} catch (err) {
		console.warn('[screen-time-onboarding-producer] feilet, ingen chip', err);
		return [];
	}
};
