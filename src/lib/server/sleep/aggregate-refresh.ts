import {
	aggregateMonthlyData,
	aggregateWeeklyData,
	aggregateYearlyData
} from '$lib/server/integrations/aggregation';
import {
	getMonthsSince,
	getWeeksSince,
	getYearsSince
} from '$lib/server/integrations/time-periods';

/**
 * Oppdaterer aggregatene en søvnregistrering påvirker.
 *
 * Samme grunn som for ernæring: uten dette viser flaten gårsdagens tall til
 * neste cron-kjøring, og man logger ikke noe man ikke ser resultatet av.
 *
 * Bare uke, måned og år — dagsradene skrives av `aggregateDailyEffort`, som
 * setter `metrics` i sin helhet og ville overskrevet et felt her.
 */
export async function invalidateSleepAggregates(userId: string, timestamp?: Date): Promise<void> {
	// To døgn margin: en forstyrrelse registreres ofte morgenen etter, og natta
	// den gjelder kan ligge i uka som nettopp gikk.
	const from = timestamp ?? new Date();
	const fromWithMargin = new Date(from.getTime() - 2 * 24 * 60 * 60 * 1000);

	await aggregateWeeklyData(userId, getWeeksSince(fromWithMargin));
	await aggregateMonthlyData(userId, getMonthsSince(fromWithMargin));
	await aggregateYearlyData(userId, getYearsSince(fromWithMargin));
}
