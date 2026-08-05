import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, asc, eq, gte } from 'drizzle-orm';
import { osloDayKey } from '$lib/domain/oslo-time';
import {
	dailyWeights,
	dayNumber,
	type WeightDay
} from '$lib/domain/health/weight-series';
import {
	summarizeCompositionChange,
	toWeightMeasurements,
	type CompositionChangeSummary
} from '$lib/domain/health/weight-measurements';
import { buildWeightMilestones, type WeightMilestone } from '$lib/domain/health/weight-milestones';
import { readHealthMetricSettings, readMetricNumber } from '$lib/server/health/metric-settings';

/**
 * Vekt-undertemaets dashboard.
 *
 * ## To ulike vindusstørrelser, med vilje
 *
 * Milepælene regnes på **hele** historikken (`MILESTONE_HISTORY_DAYS`) — det er
 * nettopp dybden som gjør «laveste siden mars 2023» verdt å lese. Grafen får
 * bare de siste årene (`CHART_HISTORY_DAYS`), fordi dagene sendes over nettet og
 * caches i localStorage: ti år med daglige veiinger er nesten en megabyte JSON
 * for å tegne en linje.
 *
 * Konsekvensen er verdt å kjenne: en milepæl kan peke på en dato som ligger
 * utenfor grafens rekkevidde. Det er riktig prioritering — setningen er sann, og
 * alternativet er å gjøre setningen dårligere for å matche grafen.
 * `milestonesReachBeyondChart` lar flaten si det.
 */

/** Ti år. Praktisk talt «alt» for en Withings-konto. */
export const MILESTONE_HISTORY_DAYS = 3650;

/** Tre år på grafen. Dekker «Alt»-valget uten å sende hele arkivet. */
export const CHART_HISTORY_DAYS = 1095;

export interface WeightDashboardPayload {
	/** Dagsverdier for grafen, stigende. Kuttet til CHART_HISTORY_DAYS. */
	days: WeightDay[];
	milestones: WeightMilestone[];
	/** Dager mellom første og siste veiing i HELE historikken. */
	historyDays: number;
	weighIns: number;
	enoughHistory: boolean;
	/** Målvekt fra mortemaets metricSettings, eller null. */
	goalKg: number | null;
	composition: CompositionChangeSummary | null;
	/** Siste veiing med det den målte. */
	latest: WeightDay | null;
	/** Dagens Oslo-dato, så flaten ikke regner den ut på nytt. */
	today: string;
	/** Sann når en milepæl peker lenger tilbake enn grafens x-akse rekker. */
	milestonesReachBeyondChart: boolean;
}

export async function loadWeightDashboardData(userId: string): Promise<WeightDashboardPayload> {
	const since = new Date(Date.now() - MILESTONE_HISTORY_DAYS * 86_400_000);

	const [rows, metricSettings] = await Promise.all([
		db
			.select({ timestamp: sensorEvents.timestamp, data: sensorEvents.data })
			.from(sensorEvents)
			.where(
				and(
					eq(sensorEvents.userId, userId),
					eq(sensorEvents.dataType, 'weight'),
					gte(sensorEvents.timestamp, since)
				)
			)
			.orderBy(asc(sensorEvents.timestamp)),
		readHealthMetricSettings(userId)
	]);

	const allDays = dailyWeights(toWeightMeasurements(rows));
	const today = osloDayKey(new Date());
	const goalKg = readMetricNumber(metricSettings, 'weight', 'goal');

	const milestoneResult = buildWeightMilestones({ days: allDays, today, goalKg });

	const chartCutoff = allDays.length > 0 ? dayNumber(allDays.at(-1)!.date) - CHART_HISTORY_DAYS : 0;
	const days = allDays.filter((day) => dayNumber(day.date) >= chartCutoff);

	const earliestOnChart = days[0]?.date ?? null;
	const milestonesReachBeyondChart =
		earliestOnChart !== null &&
		milestoneResult.milestones.some((m) => m.sinceDate !== undefined && m.sinceDate < earliestOnChart);

	return {
		days,
		milestones: milestoneResult.milestones,
		historyDays: milestoneResult.historyDays,
		weighIns: milestoneResult.weighIns,
		enoughHistory: milestoneResult.enoughHistory,
		goalKg,
		// Endringssetningen leter i hele historikken, ikke bare i grafvinduet:
		// målinger med fettmasse kan ligge spredt, og den nærmeste kan være eldre.
		composition: summarizeCompositionChange(allDays),
		latest: allDays.at(-1) ?? null,
		today,
		milestonesReachBeyondChart
	};
}
