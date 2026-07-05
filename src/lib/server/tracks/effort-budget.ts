import type { EffortBudget, EnduranceConfig, EnduranceWorkout } from './types';
import { countsTowardEndurance, effortPerRunKm } from './endurance-engine';
import { mondayOfDate, weekNumberAt } from './curve';

/**
 * Effort-budsjettet: et ukesintervall for samlet utholdenhetsbelastning
 * (løp + sykkel + el-sykkel) forankret i forrige ukes FAKTISKE effort —
 * effort 200 én uke gir anbefalt 200–240 uka etter (progressiv overload
 * uten å jage en teoretisk kurve).
 *
 *  - Anker: forrige ukes total; hvis 0 → snitt av siste 4 uker; hvis fortsatt
 *    0 → gulv på 100 (forsiktig oppstart).
 *  - Deload hver N-te uke: band × 0.8.
 *  - Hvileanbefaling: akutt (sum siste 3 dager) mot kronisk (dagsnitt siste
 *    30 × 3) — ratio over terskelen betyr «ta en rolig dag».
 *  - En hardere økt enn planlagt øker spentThisWeek → gjenstående krymper →
 *    neste forslag mindre/hvile, og neste ukes band ankres på faktisk total.
 */

const DEFAULT_GROWTH_FACTOR = 1.2;
const DEFAULT_REST_RATIO = 1.5;
const DELOAD_FACTOR = 0.8;
const FLOOR_EFFORT = 100;
const MIN_HISTORY_DAYS_FOR_RATIO = 14;
const CYCLING_MET = 0.85;
const MET_CALIBRATION = 2.5;

function addDays(iso: string, days: number): string {
	const d = new Date(`${iso}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

function sumEffort(workouts: EnduranceWorkout[]): number {
	return workouts.reduce((sum, w) => sum + (w.effortScore ?? 0), 0);
}

/**
 * Beregner ukens effort-budsjett. `workouts` er siste ~5 uker (kronologisk);
 * kun familier som teller mot utholdenhet brukes (styrke holdes utenfor).
 * `planStartDate` brukes for deload-rytmen (uke 1 = planens startuke).
 */
export function computeEffortBudget(
	workouts: EnduranceWorkout[],
	config: EnduranceConfig,
	planStartDate: string,
	today: string
): EffortBudget {
	const counted = workouts.filter((w) => countsTowardEndurance(w.family));
	const growthFactor = config.effortVekstFaktor ?? DEFAULT_GROWTH_FACTOR;
	const restRatio = config.hvileRatioTerskel ?? DEFAULT_REST_RATIO;

	const thisMonday = mondayOfDate(today);
	const prevMonday = addDays(thisMonday, -7);

	// Anker: forrige uke → snitt siste 4 hele uker → gulv
	const prevWeek = counted.filter((w) => w.date >= prevMonday && w.date < thisMonday);
	const prevWeekEffort = Math.round(sumEffort(prevWeek));

	let anchor: EffortBudget['anchor'];
	let anchorEffort: number;
	if (prevWeekEffort > 0) {
		anchor = 'forrige_uke';
		anchorEffort = prevWeekEffort;
	} else {
		const fourWeeksAgo = addDays(thisMonday, -28);
		const p4w = counted.filter((w) => w.date >= fourWeeksAgo && w.date < thisMonday);
		const p4wAvg = Math.round(sumEffort(p4w) / 4);
		if (p4wAvg > 0) {
			anchor = 'p4w_snitt';
			anchorEffort = p4wAvg;
		} else {
			anchor = 'gulv';
			anchorEffort = FLOOR_EFFORT;
		}
	}

	// Deload følger planens ukerytme
	const weekNumber = weekNumberAt(planStartDate, thisMonday);
	const deload = config.deloadHverNteUke > 0 && weekNumber % config.deloadHverNteUke === 0;
	const deloadFactor = deload ? DELOAD_FACTOR : 1;

	const bandMin = Math.round(anchorEffort * deloadFactor);
	const bandMax = Math.round(anchorEffort * growthFactor * deloadFactor);

	// Forbrukt denne uken
	const thisWeek = counted.filter((w) => w.date >= thisMonday && w.date <= today);
	const spentThisWeek = Math.round(sumEffort(thisWeek));

	// Akutt/kronisk: sum(3d) mot 3 × dagsnitt(30d). Krever ≥ 14 dagers historikk.
	const threeDaysAgo = addDays(today, -2); // inkluderer i dag → 3 dager
	const thirtyDaysAgo = addDays(today, -29);
	const acute = sumEffort(counted.filter((w) => w.date >= threeDaysAgo && w.date <= today));
	const chronicWindow = counted.filter((w) => w.date >= thirtyDaysAgo && w.date <= today);
	const chronicSum = sumEffort(chronicWindow);
	const oldestDate = counted.length > 0 ? counted[0].date : today;
	const historyDays = Math.min(
		30,
		Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${oldestDate}T00:00:00Z`)) / 86400000) + 1
	);

	let acuteChronicRatio: number | null = null;
	if (historyDays >= MIN_HISTORY_DAYS_FOR_RATIO && chronicSum > 0) {
		const dailyChronic = chronicSum / historyDays;
		acuteChronicRatio = Math.round((acute / (3 * dailyChronic)) * 100) / 100;
	}

	const restRecommended = acuteChronicRatio != null && acuteChronicRatio > restRatio;

	return {
		bandMin,
		bandMax,
		spentThisWeek,
		remainingMin: Math.max(0, bandMin - spentThisWeek),
		remainingMax: Math.max(0, bandMax - spentThisWeek),
		acuteChronicRatio,
		restRecommended,
		deload,
		anchor
	};
}

/**
 * Omsetter gjenstående effort til en konkret øktsammensetning, f.eks.
 * «8 km løp (~135) + 45 min sykkel (~95)». Sikter mot midten av intervallet.
 */
export function composeEffortSuggestion(
	remainingMin: number,
	remainingMax: number,
	paceSekPerKm: number
): string | null {
	const target = Math.round((remainingMin + remainingMax) / 2);
	if (target < 20) return null; // uken er i praksis i mål

	const perRunKm = effortPerRunKm(paceSekPerKm);
	const perCyclingMin = CYCLING_MET * MET_CALIBRATION;

	// Under én normal løpeøkt (~5 km): foreslå bare løp
	const smallRunKm = Math.round((target / perRunKm) * 2) / 2;
	if (smallRunKm <= 6) {
		return `F.eks. ${fmtKm(smallRunKm)} km løp (~${Math.round(smallRunKm * perRunKm)})`;
	}

	// Ellers: en løpeøkt på ~60 % av målet + sykkel for resten
	const runKm = Math.round(((target * 0.6) / perRunKm) * 2) / 2;
	const runEffort = Math.round(runKm * perRunKm);
	const cyclingMin = Math.round((target - runEffort) / perCyclingMin / 5) * 5;
	if (cyclingMin < 15) {
		const onlyRunKm = Math.round((target / perRunKm) * 2) / 2;
		return `F.eks. ${fmtKm(onlyRunKm)} km løp (~${Math.round(onlyRunKm * perRunKm)})`;
	}
	const cyclingEffort = Math.round(cyclingMin * perCyclingMin);
	return `F.eks. ${fmtKm(runKm)} km løp (~${runEffort}) + ${cyclingMin} min sykkel (~${cyclingEffort})`;
}

function fmtKm(km: number): string {
	return km % 1 === 0 ? String(km) : km.toFixed(1).replace('.', ',');
}
