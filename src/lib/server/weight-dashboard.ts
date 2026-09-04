import { osloDayKey } from '$lib/domain/oslo-time';
import { dayNumber, type WeightDay } from '$lib/domain/health/weight-series';
import {
	summarizeCompositionChange,
	type CompositionChangeSummary
} from '$lib/domain/health/weight-measurements';
import { readWeightDays, WEIGHT_HISTORY_DAYS } from '$lib/server/health/weight-history';
import { buildWeightMilestones, type WeightMilestone } from '$lib/domain/health/weight-milestones';
import type { WeightSwing } from '$lib/domain/health/weight-swings';
import { readHealthMetricSettings, readMetricNumber } from '$lib/server/health/metric-settings';
import { readBodyProfile } from '$lib/server/health/body-profile';
import { listWaistMeasurements } from '$lib/server/health/waist-log';
import { dailyWaist, summarizeWaist, type WaistDay, type WaistStatus } from '$lib/domain/health/waist';

/**
 * Vekt-undertemaets dashboard.
 *
 * ## Grafen og milepælene ser like langt
 *
 * Begge leser hele historikken (`MILESTONE_HISTORY_DAYS`). Det var ikke sånn til å
 * begynne med — grafen var kuttet til tre år for å spare payload — og det viste seg å
 * skjære bort flertallet av veiingene, siden tettheten er høyest i de eldste årene.
 * Se `MAX_CHART_POINTS` for hvorfor et radtak erstattet tidsvinduet.
 *
 * Biter radtaket likevel, sier `chartTruncated` det, og `milestonesReachBeyondChart`
 * fyrer — flaten skal aldri kalle noe «Alt» uten at det er alt.
 */

/**
 * Leservinduet. Bor på den delte leseren nå — se `weight-history.ts` for hvorfor
 * det er femten år. Re-eksporteres her fordi flaten og testene leser det her.
 */
export const MILESTONE_HISTORY_DAYS = WEIGHT_HISTORY_DAYS;

/**
 * Tak på antall punkter grafen får — ikke på hvor langt tilbake den ser.
 *
 * ## Hvorfor dette erstattet et tidsvindu
 *
 * Første utgave kuttet grafen til tre år, med begrunnelsen at «ti år med daglige
 * veiinger er nesten en megabyte JSON». Anslaget var feil, og målt mot ekte data ble
 * det synlig: 1204 veiinger over 8,8 år er ~158 KB, altså samme størrelsesorden som
 * helse-payloaden alt hadde.
 *
 * Verre — brukeren veier seg ikke hver dag, og tettheten er høyest i de ELDSTE årene.
 * Tidsvinduet skar derfor bort 730 av 1204 veiinger, altså flertallet av historikken,
 * for å spare noe som ikke trengte spares.
 *
 * Et tak på RADER er den riktige formen: det er rader som koster bytes, ikke år. Med
 * en typisk veiefrekvens biter det aldri, og en bruker som veier seg fem ganger daglig
 * i ti år får de nyeste punktene framfor en avkortet graf uten forklaring.
 */
export const MAX_CHART_POINTS = 4000;

export interface WeightDashboardPayload {
	/** Dagsverdier for grafen, stigende. Hele historikken, med MAX_CHART_POINTS som tak. */
	days: WeightDay[];
	milestones: WeightMilestone[];
	/**
	 * Periodene kurven er delt i — topper og bunner, begge retninger.
	 *
	 * Kommer fra `buildWeightMilestones`, ikke fra et eget kall: setningen om den
	 * pågående perioden og lista under grafen skal ikke kunne vise ulike perioder.
	 * Regnet på HELE historikken, som milepælene — grafen kan være kuttet.
	 */
	swings: WeightSwing[];
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
	/** Sann når grafen ikke rekker like langt som milepælene eller historikken. */
	milestonesReachBeyondChart: boolean;
	/** Sann når `MAX_CHART_POINTS` kuttet de eldste punktene bort. */
	chartTruncated: boolean;
	/** Første veiing i HELE historikken, uansett hva grafen fikk. */
	historyStart: string | null;
	/**
	 * Livvidde — dagsverdier og status.
	 *
	 * Ligger på vektflaten framfor i et eget undertema fordi det er samme spørsmål,
	 * målt annerledes: går det riktig vei. Vekta svarer på hvor mye, livvidda på hva
	 * slags. Se `$lib/domain/health/waist.ts`.
	 */
	waistDays: WaistDay[];
	waist: WaistStatus;
}

export async function loadWeightDashboardData(userId: string): Promise<WeightDashboardPayload> {
	const [allDays, metricSettings, waistRows, bodyProfile] = await Promise.all([
		readWeightDays(userId),
		readHealthMetricSettings(userId),
		listWaistMeasurements(userId),
		readBodyProfile(userId)
	]);

	const today = osloDayKey(new Date());
	const goalKg = readMetricNumber(metricSettings, 'weight', 'goal');

	const milestoneResult = buildWeightMilestones({ days: allDays, today, goalKg });

	// Livvidde er få målinger — hele historikken får plass, uten radtak.
	const waistDays = dailyWaist(waistRows);
	const waist = summarizeWaist(waistDays, { heightCm: bodyProfile.heightCm, today });

	// Nyeste punkter når taket biter. Med typisk veiefrekvens gjør det aldri det.
	const days = allDays.length > MAX_CHART_POINTS ? allDays.slice(-MAX_CHART_POINTS) : allDays;
	const chartTruncated = days.length < allDays.length;

	const earliestOnChart = days[0]?.date ?? null;
	/**
	 * Sann når grafen ikke rekker like langt som milepælene.
	 *
	 * Dekket tidligere BARE tilfellet der en *setning* pekte utenfor grafen. Men
	 * historikken kan strekke seg forbi grafen uten at noen milepæl gjør det — og da
	 * var flaten helt stum om hvorfor «Alt» ikke var alt. Nå fyrer den på begge.
	 */
	const milestonesReachBeyondChart =
		chartTruncated ||
		(earliestOnChart !== null &&
			milestoneResult.milestones.some((m) => m.sinceDate !== undefined && m.sinceDate < earliestOnChart));

	return {
		days,
		milestones: milestoneResult.milestones,
		swings: milestoneResult.swings,
		historyDays: milestoneResult.historyDays,
		weighIns: milestoneResult.weighIns,
		enoughHistory: milestoneResult.enoughHistory,
		goalKg,
		// Endringssetningen leter i hele historikken, ikke bare i grafvinduet:
		// målinger med fettmasse kan ligge spredt, og den nærmeste kan være eldre.
		composition: summarizeCompositionChange(allDays),
		latest: allDays.at(-1) ?? null,
		today,
		milestonesReachBeyondChart,
		chartTruncated,
		historyStart: allDays[0]?.date ?? null,
		waistDays,
		waist
	};
}
