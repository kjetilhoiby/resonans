import type { ActionProducer } from '../action-suggestion-service';
import type { ActionCandidate } from '$lib/types/actions';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/db';
import { nudgeEvents, sensorEvents } from '$lib/db/schema';
import { decideSickChip } from '$lib/domain/health/sick-checkin';
import { getSickState, todayOsloKey } from '$lib/server/health/sick-log';
import { SICK_PERIOD_DATA_TYPE } from '$lib/server/health/sick-log';
import { SYMPTOM_DATA_TYPE } from '$lib/server/health/symptom-log';

/**
 * «Hvordan går det?» som hurtighandling mens en sykeperiode står.
 *
 * Pushen (`$lib/server/sick-checkin.ts`) er tidsgatet og kadensegatet. Chipen er
 * ikke: den er SVARFLATEN, og står så lenge perioden gjør. Et spørsmål som bare
 * finnes i et varsel er borte idet varselet sveipes bort — og friskmeldingen lå
 * ellers to navigasjoner unna. Beslutningen bor rent i `decideSickChip`.
 *
 * Kun en ekte periode med kjent startdag gir chip. Et gammelt nå-flagg vet vi
 * ikke starten på, så «dag 3» kan ikke sies — og pushen fyrer ikke der heller.
 * De to skal være enige om når spørsmålet finnes.
 */
export const sickCheckinProducer: ActionProducer = async (ctx) => {
	try {
		const sick = await getSickState(ctx.userId, ctx.now);
		if (!sick.period) return [];

		const [checkin, answer] = await Promise.all([
			db
				.select({ createdAt: nudgeEvents.createdAt })
				.from(nudgeEvents)
				.where(
					and(eq(nudgeEvents.userId, ctx.userId), eq(nudgeEvents.nudgeType, 'sick_checkin'))
				)
				.orderBy(desc(nudgeEvents.createdAt))
				.limit(1),
			/**
			 * Siste gang brukeren skrev noe om sykdommen.
			 *
			 * `createdAt` (da raden ble mottatt), ALDRI `timestamp`: på et symptom er
			 * tidsstempelet startdagen, så et symptom registrert i etterkant ville
			 * sett ut som et svar som kom før spørsmålet.
			 */
			db
				.select({ createdAt: sensorEvents.createdAt })
				.from(sensorEvents)
				.where(
					and(
						eq(sensorEvents.userId, ctx.userId),
						inArray(sensorEvents.dataType, [SYMPTOM_DATA_TYPE, SICK_PERIOD_DATA_TYPE])
					)
				)
				.orderBy(desc(sensorEvents.createdAt))
				.limit(1)
		]);

		const decision = decideSickChip({
			periodStart: sick.period.startDate,
			checkinSentAt: checkin[0]?.createdAt ?? null,
			lastAnswerAt: answer[0]?.createdAt ?? null,
			todayKey: todayOsloKey(ctx.now)
		});
		if (!decision) return [];

		const candidate: ActionCandidate = {
			id: 'sick-checkin',
			icon: '🤒',
			label: decision.label,
			value: decision.value,
			priority: decision.priority,
			source: 'domain',
			/**
			 * Åpner INNSJEKKEN, ikke Helse-temaet.
			 *
			 * En navigasjon til temaet lander deg på et kort blant mange og lar
			 * spørsmålet stå ubesvart — «Hvordan går det?» fortjener en flate som
			 * stiller spørsmålet. Pushen lenker fortsatt til temaet, siden en
			 * varsel-URL må virke i en kald nettleser uten flyt-tilstand.
			 */
			intent: { kind: 'open-flow', flowId: 'sick_checkin' }
		};
		return [candidate];
	} catch (err) {
		console.warn('[sick-checkin-producer] feilet, ingen chip', err);
		return [];
	}
};
