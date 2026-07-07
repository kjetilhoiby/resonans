import type { EffortBudget, EnduranceConfig, EnduranceWorkout } from './types';
import { countsTowardEndurance, effortPerRunKm } from './endurance-engine';
import { mondayOfDate, weekNumberAt } from './curve';
import { fmtMinutter } from '$lib/util/duration';

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
// Vedlikeholdsmodus (aktiv reise/ferie): båndet senkes til «hold litt ved like»
// framfor progressiv overload — en lett uke på reise skal ikke leses som svikt.
const MAINTENANCE_MIN_FACTOR = 0.5;
const MAINTENANCE_MAX_FACTOR = 0.8;
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
	today: string,
	maintenanceMode = false
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

	// Vedlikeholdsmodus overstyrer vekst/deload: hold-ved-like-bånd rundt ankeret.
	const bandMin = maintenanceMode
		? Math.round(anchorEffort * MAINTENANCE_MIN_FACTOR)
		: Math.round(anchorEffort * deloadFactor);
	const bandMax = maintenanceMode
		? Math.round(anchorEffort * MAINTENANCE_MAX_FACTOR)
		: Math.round(anchorEffort * growthFactor * deloadFactor);

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
		anchor,
		maintenance: maintenanceMode
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
	return `F.eks. ${fmtKm(runKm)} km løp (~${runEffort}) + ${fmtMinutter(cyclingMin)} sykkel (~${cyclingEffort})`;
}

function fmtKm(km: number): string {
	return km % 1 === 0 ? String(km) : km.toFixed(1).replace('.', ',');
}

// ─── Ukeskomposisjon: «gikk uka bra» og «sånn blir uka» ─────────────────────

export interface WeekSessionSlice {
	date: string;
	family: string;
	effort: number;
}

/** Denne ukas registrerte økter som segmenter til den stablede budsjettgrafen. */
export function summarizeWeekSessions(workouts: EnduranceWorkout[], today: string): WeekSessionSlice[] {
	const monday = mondayOfDate(today);
	return workouts
		.filter(
			(w) =>
				w.date >= monday && w.date <= today && countsTowardEndurance(w.family) && (w.effortScore ?? 0) > 0
		)
		.map((w) => ({ date: w.date, family: w.family, effort: Math.round(w.effortScore!) }));
}

// ─── Ukesprognose: se tidlig om uka må dras opp av grøfta ────────────────────

export interface WeekProjection {
	/** Forventet effort resten av uka (fra ditt vanlige mønster per ukedag, siste 4 uker). */
	expectedRemaining: number;
	/** Forbrukt + forventet rest. */
	projectedTotal: number;
	/** Antall gjenstående dager i uka (etter i dag). */
	remainingDays: number;
}

const PROJECTION_WEEKS = 4;

/**
 * Prognose for ukas totale effort: det du har gjort + det du VANLIGVIS gjør
 * resten av uka (snitt per ukedag over de siste 4 hele ukene — inkluderer
 * sykkelvanene automatisk). Gjør det mulig å se onsdag at uka ligger an til
 * å lande under terskelen, mens det fortsatt er tid til en kveldstur.
 */
export function projectWeekEffort(workouts: EnduranceWorkout[], today: string): WeekProjection {
	const counted = workouts.filter((w) => countsTowardEndurance(w.family));
	const thisMonday = mondayOfDate(today);

	// Snitt effort per ukedag over de siste 4 hele ukene (før denne uka)
	const weekdayTotals = new Map<number, number>();
	for (let d = 1; d <= 7; d++) weekdayTotals.set(d, 0);
	const projStart = addDays(thisMonday, -7 * PROJECTION_WEEKS);
	for (const w of counted) {
		if (w.date < projStart || w.date >= thisMonday) continue;
		const day = new Date(`${w.date}T00:00:00Z`).getUTCDay();
		const weekday = day === 0 ? 7 : day;
		weekdayTotals.set(weekday, (weekdayTotals.get(weekday) ?? 0) + (w.effortScore ?? 0));
	}

	const todayDay = new Date(`${today}T00:00:00Z`).getUTCDay();
	const todayWeekday = todayDay === 0 ? 7 : todayDay;

	let expectedRemaining = 0;
	for (let d = todayWeekday + 1; d <= 7; d++) {
		expectedRemaining += (weekdayTotals.get(d) ?? 0) / PROJECTION_WEEKS;
	}

	const spentThisWeek = counted
		.filter((w) => w.date >= thisMonday && w.date <= today)
		.reduce((sum, w) => sum + (w.effortScore ?? 0), 0);

	return {
		expectedRemaining: Math.round(expectedRemaining),
		projectedTotal: Math.round(spentThisWeek + expectedRemaining),
		remainingDays: 7 - todayWeekday
	};
}

/**
 * Minste typiske økt som tetter gapet — «en løpetur i skogen en kveld».
 * Returnerer null når ingenting trengs; største eksempel hvis gapet er
 * større enn alle.
 */
export function pickBoostSuggestion(
	gap: number,
	examples: WeekPlanExample[]
): WeekPlanExample | null {
	if (gap <= 0 || examples.length === 0) return null;
	const sorted = [...examples].sort((a, b) => a.effort - b.effort);
	return sorted.find((e) => e.effort >= gap) ?? sorted[sorted.length - 1];
}

export interface WeekRecipe {
	/** F.eks. «Rolig 8 km + Intervaller 30 min». */
	label: string;
	totalEffort: number;
	sessions: string[];
}

/**
 * Setter sammen en konkret øktoppskrift som tetter gjenstående effort:
 * «Rolig 8 km + Intervaller 30 min (~208)». Enumererer kombinasjoner på
 * 1–3 økter fra en liten katalog og foretrekker: total innenfor intervallet,
 * minst én løpeøkt (støtter km-målet), færrest økter, nærmest midten.
 * Intervaller prises med terskel-intensitetsfaktor — konsistent med
 * met_pace-skåringen som faktiske harde økter får.
 */
export function composeWeekRecipe(
	remainingMin: number,
	remainingMax: number,
	paceSekPerKm: number,
	opts?: { preferVariety?: boolean }
): WeekRecipe | null {
	if (remainingMax <= 20) return null; // uken er i praksis i mål

	const runEffort = (km: number) => Math.round(km * (paceSekPerKm / 60) * MET_CALIBRATION);
	// Terskelfart ≈ 85 % av easy-pace-tiden → intensitetsfaktor (1/0.85)² ≈ 1.38
	// (samme kvadratiske modell som met_pace i effort-service).
	const INTERVAL_INTENSITET = 1.38;
	const catalog: Array<{ label: string; effort: number; isRun: boolean }> = [
		{ label: 'Rolig 5 km', effort: runEffort(5), isRun: true },
		{ label: 'Rolig 8 km', effort: runEffort(8), isRun: true },
		{ label: 'Intervaller 30 min', effort: Math.round(30 * MET_CALIBRATION * INTERVAL_INTENSITET), isRun: true },
		{ label: 'Sykkeltur 40 min', effort: Math.round(40 * CYCLING_FAKTOR * MET_CALIBRATION), isRun: false },
		{ label: 'El-sykkel 40 min', effort: Math.round(40 * EBIKE_FAKTOR * MET_CALIBRATION), isRun: false }
	];

	const target = Math.max(remainingMin, 1);
	const mid = (Math.max(remainingMin, 0) + remainingMax) / 2;

	interface Candidate {
		sessions: typeof catalog;
		total: number;
	}
	const candidates: Candidate[] = [];
	const n = catalog.length;
	for (let a = 0; a < n; a++) {
		candidates.push({ sessions: [catalog[a]], total: catalog[a].effort });
		for (let b = a; b < n; b++) {
			candidates.push({ sessions: [catalog[a], catalog[b]], total: catalog[a].effort + catalog[b].effort });
			for (let c = b; c < n; c++) {
				candidates.push({
					sessions: [catalog[a], catalog[b], catalog[c]],
					total: catalog[a].effort + catalog[b].effort + catalog[c].effort
				});
			}
		}
	}

	const inBand = candidates.filter((c) => c.total >= target && c.total <= remainingMax);
	const pool = inBand.length > 0 ? inBand : candidates.filter((c) => c.total >= target);
	if (pool.length === 0) return null;

	// Belønning av variasjon: når balansen viser at løp dominerer perioden,
	// foretrekkes oppskrifter som inneholder en ikke-løpsøkt (kryss-trening) —
	// ellers foretrekkes løp (støtter km-målet). Påvirker kun sorteringen, ikke
	// hvilke kombinasjoner som er lovlige, og default (opt-in) er uendret.
	const preferVariety = opts?.preferVariety ?? false;
	pool.sort((x, y) => {
		if (preferVariety) {
			const xVar = x.sessions.some((s) => !s.isRun) ? 0 : 1;
			const yVar = y.sessions.some((s) => !s.isRun) ? 0 : 1;
			if (xVar !== yVar) return xVar - yVar; // kryss-trening foretrekkes
		} else {
			const xRun = x.sessions.some((s) => s.isRun) ? 0 : 1;
			const yRun = y.sessions.some((s) => s.isRun) ? 0 : 1;
			if (xRun !== yRun) return xRun - yRun; // løp foretrekkes
		}
		if (x.sessions.length !== y.sessions.length) return x.sessions.length - y.sessions.length;
		return Math.abs(x.total - mid) - Math.abs(y.total - mid);
	});

	const best = pool[0];
	return {
		label: best.sessions.map((s) => s.label).join(' + '),
		totalEffort: best.total,
		sessions: best.sessions.map((s) => s.label)
	};
}

export interface WeekPlanExample {
	label: string;
	effort: number;
	/** Andel av ukas mål (midten av intervallet), i prosent. */
	pctOfBand: number;
}

const CYCLING_FAKTOR = 0.85;
const EBIKE_FAKTOR = 0.4;

/**
 * «Sånn blir uka»-planleggeren: hva typiske økter gir i effort og som andel
 * av ukas mål — så det er lett å se at f.eks. to 8 km-løp dekker X % og to
 * el-sykkelturer bare legger Y % på toppen.
 */
export function buildWeekPlanExamples(
	paceSekPerKm: number,
	bandMin: number,
	bandMax: number
): WeekPlanExample[] {
	const bandMid = Math.max(1, (bandMin + bandMax) / 2);
	const runEffort = (km: number) => km * (paceSekPerKm / 60) * MET_CALIBRATION;

	const items = [
		{ label: 'Løp 5 km', effort: runEffort(5) },
		{ label: 'Løp 8 km', effort: runEffort(8) },
		{ label: 'Sykkeltur 40 min', effort: 40 * CYCLING_FAKTOR * MET_CALIBRATION },
		{ label: 'El-sykkel 40 min', effort: 40 * EBIKE_FAKTOR * MET_CALIBRATION }
	];

	return items.map((i) => ({
		label: i.label,
		effort: Math.round(i.effort),
		pctOfBand: Math.round((i.effort / bandMid) * 100)
	}));
}
