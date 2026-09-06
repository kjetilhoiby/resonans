/**
 * Planen for å reparere HELE treningshistorikken, fra tidens morgen.
 *
 * ## Hvorfor en plan, og ikke bare en knapp
 *
 * Å reparere treningshistorikken er ikke én operasjon. Det er to rørledninger
 * som må kjøres i RIKTIG REKKEFØLGE, og som til august 2026 het nesten det
 * samme på flaten:
 *
 * 1. **`canonical_workouts`** bygges av `WorkoutProjectionService.refreshForRange`
 *    (`POST /api/helse/trening/reprojiser`). «Akkumulert løping», «Perioder i
 *    vektkurven» og formkurven leser den.
 * 2. **`sensor_aggregates.metrics`** bygges av `aggregateAllPeriods`
 *    (`POST /api/sensors/aggregate`). Periodetabellen (`HealthMetricGrid`) leser
 *    den.
 *
 * Aggregeringen LESER canonical (`computeWorkoutSummaryFromCanonical`), så et
 * hull i canonical bakes inn i månedsradene og blir stående til noe aggregerer
 * på nytt ETTER at canonical er reparert. Rekkefølgen er altså ikke en
 * preferanse: kjører man dem i motsatt rekkefølge, ser begge kjøringene
 * vellykkede ut og hullet står igjen.
 *
 * Fram til 6. september 2026 måtte brukeren vite dette selv — og feilen er
 * stum i alle ledd. Denne modulen legger rekkefølgen i koden.
 *
 * ## Hvorfor flere vinduer, og ikke ett stort
 *
 * `MAX_REPROJECT_WEEKS` (26) er et tak på SPENNET per kjøring, og grunnen er
 * pulskurvene: projeksjonen laster sporet for hver løpeøkt i vinduet for å
 * regne sone- og intensitetsfelt. Ni år i ett kall ville lastet hvert spor
 * samtidig. Planen deler derfor historikken i vinduer på 26 uker, og
 * KLIENTEN kjører dem én for én — samme mønster som `WorkoutReanalyzeCard`:
 * en serverside-løkke ville truffet svartidsgrensa, og en halvferdig jobb uten
 * framdriftstall er verre enn en som teller.
 *
 * ## Hvorfor NYESTE først
 *
 * Rekkefølgen betyr ikke noe for korrektheten — `refreshForRange` sletter og
 * skriver per side, avgrenset til nøyaktig det siden bygger opp igjen. Men en
 * kjøring som avbrytes halvveis (lukket fane, tapt nett) skal ha reparert den
 * enden brukeren faktisk ser på, og det er de siste månedene.
 *
 * Se `docs/changelog/2026-09-06-fiks-treningshistorikk.md`.
 */

import { MAX_REPROJECT_WEEKS } from './reproject-window';

/** Vinduslengden planen bruker: taket, siden hvert vindu koster ett kall. */
export const REPAIR_WINDOW_WEEKS = MAX_REPROJECT_WEEKS;

/**
 * Taket på antall vinduer i én plan.
 *
 * 40 × 26 uker ≈ 20 år. Taket finnes ikke for å beskytte serveren (hvert vindu
 * er et eget kall), men for å gjøre en absurd `historyStart` — en økt med et
 * ødelagt tidsstempel i 1970 — til en plan med et TALL på seg framfor en løkke
 * som ser ut som den henger. `truncated` sier at planen ikke rakk fram.
 */
export const MAX_REPAIR_WINDOWS = 40;

export interface RepairWindow {
	/** 1-basert, i kjørerekkefølge (nyeste vindu er nr. 1). */
	index: number;
	weeks: number;
	/**
	 * `until`-parameteren til reprojiser-endepunktet, `YYYY-MM-DD`.
	 *
	 * `null` på det første vinduet med vilje: det betyr «fram til nå», og dekker
	 * dermed dagen som pågår i sin helhet. En dato ville stoppet ved midnatt og
	 * latt dagens økter stå.
	 */
	until: string | null;
	/** Startpunktet vinduet dekker, `YYYY-MM-DD`. Til visning. */
	fromDay: string;
	/** Sluttpunktet vinduet dekker, `YYYY-MM-DD`. Til visning. */
	toDay: string;
}

export interface HistoryRepairPlan {
	windows: RepairWindow[];
	/** Eldste økt planen er bygget fra, `YYYY-MM-DD`. */
	historyStartDay: string;
	/** Nådde planen `MAX_REPAIR_WINDOWS` før den rakk historikkens start? */
	truncated: boolean;
	/** Dagen den eldste økta planen IKKE dekker ligger på, når `truncated`. */
	uncoveredBeforeDay: string | null;
}

export interface HistoryRepairPlanInput {
	/** Tidsstempelet på den eldste økta i `sensor_events`, ISO. */
	historyStartIso: string;
	nowIso: string;
	weeksPerWindow?: number;
	maxWindows?: number;
}

/**
 * Bygger vinduene som dekker `historyStart` → nå, nyeste først.
 *
 * ## Overlappen på én dag er med vilje
 *
 * Vinduene forskyves med `weeks * 7 − 1` dager, ikke `weeks * 7`. Uten
 * overlappen faller en dag mellom to vinduer: `until` tolkes som midnatt UTC,
 * mens det foregående vinduets startpunkt bærer et klokkeslett. Gapet er noen
 * timer, altså nøyaktig ett døgns økter i verste fall — og et hull en
 * reparasjonsjobb selv etterlater er den verste sorten, fordi den som kjørte den
 * har grunn til å tro at historikken nå er hel. Overlapp koster ingenting:
 * `refreshForRange` er idempotent.
 */
export function planHistoryRepair(input: HistoryRepairPlanInput): HistoryRepairPlan {
	const weeks = input.weeksPerWindow ?? REPAIR_WINDOW_WEEKS;
	const maxWindows = input.maxWindows ?? MAX_REPAIR_WINDOWS;

	const now = new Date(input.nowIso);
	const historyStart = new Date(input.historyStartIso);

	if (!Number.isFinite(now.getTime()) || !Number.isFinite(historyStart.getTime())) {
		return { windows: [], historyStartDay: '', truncated: false, uncoveredBeforeDay: null };
	}

	const historyStartDay = dayKey(historyStart);
	const spanDays = weeks * 7;
	// Forskyvningen er ett døgn kortere enn spennet — se overlapp-notatet over.
	const stepDays = spanDays - 1;

	const windows: RepairWindow[] = [];
	// Sluttpunktet for vinduet som bygges nå. Første runde er `null` = nå.
	let toDate = new Date(now);
	let truncated = false;

	for (let index = 1; index <= maxWindows; index += 1) {
		const fromDate = addDays(toDate, -spanDays);
		windows.push({
			index,
			weeks,
			until: index === 1 ? null : dayKey(toDate),
			fromDay: dayKey(fromDate),
			toDay: dayKey(toDate)
		});

		if (fromDate.getTime() <= historyStart.getTime()) {
			return { windows, historyStartDay, truncated: false, uncoveredBeforeDay: null };
		}

		if (index === maxWindows) {
			truncated = true;
			break;
		}

		toDate = addDays(toDate, -stepDays);
	}

	const lastCovered = windows[windows.length - 1];
	return {
		windows,
		historyStartDay,
		truncated,
		uncoveredBeforeDay: truncated ? (lastCovered?.fromDay ?? null) : null
	};
}

function addDays(date: Date, days: number): Date {
	const next = new Date(date);
	next.setUTCDate(next.getUTCDate() + days);
	return next;
}

function dayKey(date: Date): string {
	return date.toISOString().slice(0, 10);
}
