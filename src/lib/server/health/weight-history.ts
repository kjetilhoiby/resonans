/**
 * Den delte veien inn til vekthistorikken som dagsverdier.
 *
 * Lå inni `weight-dashboard.ts` fram til september 2026, som eneste kaller. Da
 * push-krydderet trengte den samme serien, var valget mellom en ny rå spørring
 * og en delt leser — og en ny rå spørring er nettopp mønsteret
 * `sensor-event-access.ts` finnes for å stoppe: to lesere av vekt-rader driver
 * fra hverandre uten at noe sier fra, og et varsel som sier noe annet enn flaten
 * det lenker til er verre enn et varsel uten fakta.
 *
 * Rå lesing skjer HER, ett sted, og går gjennom `toWeightMeasurements` →
 * `dailyWeights` som alt annet.
 */

import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, asc, eq, gte } from 'drizzle-orm';
import { dailyWeights, type WeightDay } from '$lib/domain/health/weight-series';
import { toWeightMeasurements } from '$lib/domain/health/weight-measurements';

/**
 * Leservinduet. Femten år dekker en Withings-konto fra da de første vektene kom.
 *
 * Var ti år, som virket som «praktisk talt alt» — men et tak i årstall er en påstand
 * om når brukeren begynte, og den blir feil. Med backfill til 2014 ville ti år fra
 * 2026 kuttet de tre første årene på nytt, i et annet lag enn det forrige kappet.
 * Femten år er ikke prinsipielt bedre, bare romsligere enn noen konto rekker;
 * kostnaden er en `timestamp >=`-grense som Postgres bruker indeksen på uansett.
 */
export const WEIGHT_HISTORY_DAYS = 5475;

/**
 * Hele vekthistorikken som dagsverdier, stigende.
 *
 * `now` sendes inn så vinduet kan testes; ellers er det klokka.
 */
export async function readWeightDays(
	userId: string,
	options: { now?: Date } = {}
): Promise<WeightDay[]> {
	const now = options.now ?? new Date();
	const since = new Date(now.getTime() - WEIGHT_HISTORY_DAYS * 86_400_000);

	const rows = await db
		.select({ timestamp: sensorEvents.timestamp, data: sensorEvents.data })
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'weight'),
				gte(sensorEvents.timestamp, since)
			)
		)
		.orderBy(asc(sensorEvents.timestamp));

	return dailyWeights(toWeightMeasurements(rows));
}
