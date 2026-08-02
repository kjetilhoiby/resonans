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
 * Oppdaterer aggregatene et logget måltid påvirker.
 *
 * Uten dette ville undertema-flisen og ukesserien vist gårsdagens tall til neste
 * cron-kjøring — man logger frokost og ser ingenting, som er nok til at man
 * slutter å logge.
 *
 * Kun uke, måned og år: dagsaggregatene skrives av `aggregateDailyEffort`, som
 * setter `metrics` i sin helhet (`excluded.metrics`) og dermed ville overskrevet
 * et nutrition-felt på samme rad. Dagens tall leses derfor rett fra loggen
 * (`listIntake`) i stedet — det er også alltid ferskt.
 */
export async function invalidateNutritionAggregates(userId: string, timestamp?: Date): Promise<void> {
	// Litt margin bakover, slik at et måltid logget rett etter midnatt også
	// fanger uka som nettopp gikk.
	const from = timestamp ?? new Date();
	const fromWithMargin = new Date(from.getTime() - 24 * 60 * 60 * 1000);

	await aggregateWeeklyData(userId, getWeeksSince(fromWithMargin));
	await aggregateMonthlyData(userId, getMonthsSince(fromWithMargin));
	await aggregateYearlyData(userId, getYearsSince(fromWithMargin));
}
