/**
 * Adaptiv treningsmodus — ren forretningslogikk (ingen DB).
 *
 * Brukes av adaptive-service.ts som kjøres ukentlig (cron, søndag kveld) for
 * programmer med mode='adaptiv'. Tre uavhengige justeringer:
 *
 *  1. Dagplassering: neste ukes løpsøkter flyttes til ukedagene brukeren
 *     faktisk pleier å løpe slike turer (lang/kort/fort), basert på siste
 *     90 dagers løp.
 *  2. Effort-balanse: forrige uke evalueres på faktisk effort per sportsfamilie
 *     (løp/styrke/sykkel/…) mot planlagt — ikke på hvilke økter som ble misset.
 *     En hard sykkeltur teller. Lav dekning demper neste ukes løpsvolum.
 *  3. Temporekalkulering: VDOT re-estimeres fra ukens faktiske løp (best
 *     efforts + puls-respons på pace) og blandes dempet inn i gjeldende VDOT,
 *     slik at tempoforslag glir rolig med formen i stedet for å hoppe.
 */

import { estimateVdotFromBestEfforts, vdotFromPaceAndHr } from '$lib/server/workouts/vdot';
import type { RunType } from './constants';

// Justeringsparametre — eksportert så tester og service bruker samme verdier.
export const ADAPTIVE_PARAMS = {
	/** Hvor mye av observert VDOT-avvik som blandes inn per uke (EWMA) */
	vdotAlpha: 0.3,
	/** Maks VDOT-endring per uke — demper støyete enkeltuker (~4-6 sek/km easy) */
	maxVdotStepPerWeek: 0.6,
	/** Minste VDOT-endring som regnes som reell (under dette: ingen oppdatering) */
	minVdotChange: 0.1,
	/** Minst så mange observasjoner på en ukedag før den regnes som «din» dag */
	minRunsForPreferredDay: 2,
	/** Effort-dekning under dette → neste ukes løpsvolum dempes */
	underCoverageThreshold: 0.6,
	/** Effort-dekning over dette → uken regnes som «over» plan */
	overCoverageThreshold: 1.4,
	/** Volumfaktor for neste uke når forrige uke var under dekning */
	volumeFactorOnUnder: 0.9,
	/** Antatt varighet for en styrkeøkt uten target-varighet (minutter) */
	assumedStrengthMinutes: 30
} as const;

// ── Løpskarakter ─────────────────────────────────────────────────────────────

/** Karakteren til et løp slik brukeren tenker på det: langt, kort eller fort. */
export type RunCharacter = 'lang' | 'kort' | 'fort';

export const RUN_CHARACTER_LABELS: Record<RunCharacter, string> = {
	lang: 'langtur',
	kort: 'kort/rolig løp',
	fort: 'fartsøkt'
};

export const DAY_NAMES = ['mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag'];

/** Planlagte run-typer mapper til samme karakterer som faktiske løp. */
export function runCharacterForType(runType: RunType): RunCharacter {
	switch (runType) {
		case 'long':
			return 'lang';
		case 'easy':
			return 'kort';
		default:
			return 'fort'; // tempo + intervals
	}
}

export interface ObservedRun {
	/** 1=mandag .. 7=søndag */
	dayNumber: number;
	distanceMeters?: number;
	durationSeconds?: number;
	/** Faktisk pace, helst grade-adjusted (GAP) */
	paceSecPerKm?: number;
	avgHeartRate?: number;
	bestEfforts?: { '1k'?: number; '3k'?: number; '5k'?: number; '10k'?: number };
}

/**
 * Klassifiser et faktisk løp relativt til brukerens egne medianer:
 *  - lang: ≥30% lengre enn median-distansen (og minst 5 km), eller ≥30% lengre
 *    varighet enn median når distanse mangler
 *  - fort: ≥6% raskere pace enn median-pace
 *  - kort: alt annet
 */
export function classifyRunCharacter(
	run: Pick<ObservedRun, 'distanceMeters' | 'durationSeconds' | 'paceSecPerKm'>,
	ref: { medianDistanceMeters?: number; medianDurationSeconds?: number; medianPaceSecPerKm?: number }
): RunCharacter {
	if (
		run.distanceMeters != null &&
		ref.medianDistanceMeters != null &&
		run.distanceMeters >= Math.max(ref.medianDistanceMeters * 1.3, 5000)
	) {
		return 'lang';
	}
	if (
		run.distanceMeters == null &&
		run.durationSeconds != null &&
		ref.medianDurationSeconds != null &&
		run.durationSeconds >= ref.medianDurationSeconds * 1.3
	) {
		return 'lang';
	}
	if (
		run.paceSecPerKm != null &&
		ref.medianPaceSecPerKm != null &&
		run.paceSecPerKm <= ref.medianPaceSecPerKm * 0.94
	) {
		return 'fort';
	}
	return 'kort';
}

function median(values: number[]): number | undefined {
	if (values.length === 0) return undefined;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ── Ukedagsprofil ────────────────────────────────────────────────────────────

export interface WeekdayProfile {
	/** counts[karakter][dag-1] = antall slike løp på den ukedagen */
	counts: Record<RunCharacter, number[]>;
	totalRuns: number;
}

/** Bygg profil over hvilke ukedager brukeren pleier å løpe langt/kort/fort. */
export function buildWeekdayProfile(runs: ObservedRun[]): WeekdayProfile {
	const ref = {
		medianDistanceMeters: median(runs.map((r) => r.distanceMeters).filter((v): v is number => v != null && v > 0)),
		medianDurationSeconds: median(runs.map((r) => r.durationSeconds).filter((v): v is number => v != null && v > 0)),
		medianPaceSecPerKm: median(runs.map((r) => r.paceSecPerKm).filter((v): v is number => v != null && v > 0))
	};

	const counts: Record<RunCharacter, number[]> = {
		lang: new Array(7).fill(0),
		kort: new Array(7).fill(0),
		fort: new Array(7).fill(0)
	};
	for (const run of runs) {
		if (run.dayNumber < 1 || run.dayNumber > 7) continue;
		const character = classifyRunCharacter(run, ref);
		counts[character][run.dayNumber - 1] += 1;
	}
	return { counts, totalRuns: runs.length };
}

/**
 * Brukerens foretrukne ukedager for en løpskarakter, sortert etter frekvens.
 * Bare dager med nok observasjoner regnes som en reell vane.
 */
export function preferredDaysFor(profile: WeekdayProfile, character: RunCharacter): number[] {
	return profile.counts[character]
		.map((count, idx) => ({ day: idx + 1, count }))
		.filter((d) => d.count >= ADAPTIVE_PARAMS.minRunsForPreferredDay)
		.sort((a, b) => b.count - a.count)
		.map((d) => d.day);
}

// ── Dagplassering for neste uke ──────────────────────────────────────────────

export interface PlannedSessionLite {
	id: string;
	dayNumber: number;
	kind: 'strength' | 'run';
	isTest?: boolean;
	runType?: RunType;
}

export interface DayMove {
	sessionId: string;
	fromDay: number;
	toDay: number;
	character: RunCharacter;
	reason: string;
}

/**
 * Flytt neste ukes løpsøkter til brukerens vanedager. Test-økter røres ikke,
 * og ingen flytting til dager som allerede har en økt (unik week+day-constraint).
 */
export function planDayMoves(sessions: PlannedSessionLite[], profile: WeekdayProfile): DayMove[] {
	const occupied = new Set(sessions.map((s) => s.dayNumber));
	const moves: DayMove[] = [];

	for (const session of sessions) {
		if (session.kind !== 'run' || session.isTest || !session.runType) continue;
		const character = runCharacterForType(session.runType);
		const preferred = preferredDaysFor(profile, character);
		if (preferred.length === 0 || preferred.includes(session.dayNumber)) continue;

		const target = preferred.find((day) => !occupied.has(day));
		if (target == null) continue;

		occupied.delete(session.dayNumber);
		occupied.add(target);
		const count = profile.counts[character][target - 1];
		moves.push({
			sessionId: session.id,
			fromDay: session.dayNumber,
			toDay: target,
			character,
			reason: `${capitalize(RUN_CHARACTER_LABELS[character])} flyttet til ${DAY_NAMES[target - 1]} — ${count} av ${profile.totalRuns} løp siste 90 dager av denne typen lå der`
		});
	}
	return moves;
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Effort-balanse ───────────────────────────────────────────────────────────

/** Effort per sportsfamilie, i intensitetsvektede minutter. */
export type FamilyEffortMap = Record<string, number>;

const RUN_TYPE_INTENSITY: Record<RunType, number> = {
	easy: 1.0,
	long: 1.0,
	tempo: 1.3,
	intervals: 1.5
};

export interface PlannedSessionEffortInput {
	kind: 'strength' | 'run';
	runType?: RunType;
	targetDistanceMeters?: number;
	targetDurationSeconds?: number;
	paceHintSecPerKm?: number;
}

/** Estimert effort for en planlagt økt: varighet i minutter × intensitetsfaktor. */
export function estimatePlannedEffort(session: PlannedSessionEffortInput): {
	family: 'running' | 'strength';
	effort: number;
} {
	if (session.kind === 'strength') {
		return { family: 'strength', effort: ADAPTIVE_PARAMS.assumedStrengthMinutes * 0.9 };
	}
	const pace = session.paceHintSecPerKm ?? 360;
	const seconds =
		session.targetDurationSeconds ??
		(session.targetDistanceMeters != null ? (session.targetDistanceMeters / 1000) * pace : 30 * 60);
	const intensity = session.runType ? RUN_TYPE_INTENSITY[session.runType] : 1.0;
	return { family: 'running', effort: (seconds / 60) * intensity };
}

export interface ActualWorkoutLite {
	sportFamily: string;
	durationSeconds?: number;
	avgHeartRate?: number;
}

/**
 * Faktisk effort for en gjennomført økt (uansett sport): varighet i minutter ×
 * intensitet fra puls-reserve når puls finnes, ellers 1.0.
 */
export function estimateActualEffort(
	workout: ActualWorkoutLite,
	hr?: { restHr: number; maxHr: number }
): number {
	const minutes = (workout.durationSeconds ?? 0) / 60;
	if (minutes <= 0) return 0;
	let intensity = 1.0;
	if (workout.avgHeartRate != null && hr && hr.maxHr > hr.restHr && workout.avgHeartRate > hr.restHr) {
		const fraction = (workout.avgHeartRate - hr.restHr) / (hr.maxHr - hr.restHr);
		// Skaler slik at moderat innsats (~65% HRR) ≈ 1.0
		intensity = Math.min(1.6, Math.max(0.5, fraction / 0.65));
	}
	return minutes * intensity;
}

export interface EffortBalance {
	plannedTotal: number;
	actualTotal: number;
	/** actualTotal / plannedTotal (1 hvis ingenting var planlagt) */
	coverage: number;
	byFamily: Array<{ family: string; planned: number; actual: number }>;
	verdict: 'under' | 'ok' | 'over';
	/** Faktor for neste ukes løpsvolum (1.0 = uendret) */
	nextWeekVolumeFactor: number;
	reasons: string[];
}

/**
 * Sammenlign forrige ukes planlagte og faktiske effort på tvers av familier.
 * Poenget: en misset løpeøkt kompensert av en hard sykkeltur gir fortsatt god
 * dekning — vi straffer ikke per økt, bare reell underbelastning.
 */
export function evaluateEffortBalance(planned: FamilyEffortMap, actual: FamilyEffortMap): EffortBalance {
	const plannedTotal = sumValues(planned);
	const actualTotal = sumValues(actual);
	const coverage = plannedTotal > 0 ? actualTotal / plannedTotal : 1;

	const families = [...new Set([...Object.keys(planned), ...Object.keys(actual)])].sort();
	const byFamily = families.map((family) => ({
		family,
		planned: Math.round(planned[family] ?? 0),
		actual: Math.round(actual[family] ?? 0)
	}));

	const verdict: EffortBalance['verdict'] =
		coverage < ADAPTIVE_PARAMS.underCoverageThreshold
			? 'under'
			: coverage > ADAPTIVE_PARAMS.overCoverageThreshold
				? 'over'
				: 'ok';

	const reasons: string[] = [];
	const pct = Math.round(coverage * 100);
	const familyDesc = byFamily
		.filter((f) => f.planned > 0 || f.actual > 0)
		.map((f) => `${familyLabel(f.family)} ${f.actual}/${f.planned}`)
		.join(', ');
	reasons.push(`Forrige uke: ${pct}% av planlagt effort gjennomført (${familyDesc || 'ingen aktivitet'})`);

	const crossFamilies = byFamily.filter((f) => f.planned === 0 && f.actual > 0);
	if (crossFamilies.length > 0 && verdict !== 'under') {
		reasons.push(
			`Aktivitet utenfor planen teller med: ${crossFamilies.map((f) => familyLabel(f.family)).join(', ')}`
		);
	}

	let nextWeekVolumeFactor = 1.0;
	if (verdict === 'under') {
		nextWeekVolumeFactor = ADAPTIVE_PARAMS.volumeFactorOnUnder;
		reasons.push('Lav dekning — neste ukes løpsvolum dempes 10% så planen blir realistisk');
	} else if (verdict === 'over') {
		reasons.push('Mer effort enn planlagt — volum holdes uendret, følg med på restitusjon');
	}

	return { plannedTotal, actualTotal, coverage, byFamily, verdict, nextWeekVolumeFactor, reasons };
}

function sumValues(map: FamilyEffortMap): number {
	return Object.values(map).reduce((sum, v) => sum + v, 0);
}

function familyLabel(family: string): string {
	return (
		{
			running: 'løp',
			strength: 'styrke',
			cycling: 'sykkel',
			walking: 'gange',
			swimming: 'svømming'
		}[family] ?? family
	);
}

// ── Ukentlig temporekalkulering ──────────────────────────────────────────────

export interface WeeklyVdotResult {
	newVdot: number;
	/** Median av ukens VDOT-observasjoner (udempet) */
	observedVdot?: number;
	observationCount: number;
	changed: boolean;
	reasons: string[];
}

/**
 * Re-estimer VDOT fra ukens faktiske løp og blend dempet inn i gjeldende verdi.
 * Observasjoner: best efforts i ukens løp (raskeste 3k/5k/10k-strekk) og
 * puls-respons på pace (samme fart på lavere puls → høyere VDOT).
 */
export function recalcWeeklyVdot(args: {
	currentVdot: number;
	runs: ObservedRun[];
	restHr?: number;
	maxHr?: number;
}): WeeklyVdotResult {
	const observations: number[] = [];

	for (const run of args.runs) {
		if (run.bestEfforts) {
			const est = estimateVdotFromBestEfforts(run.bestEfforts);
			if (est) observations.push(est.vdot);
		}
		if (
			run.paceSecPerKm != null &&
			run.avgHeartRate != null &&
			args.restHr != null &&
			args.maxHr != null
		) {
			const est = vdotFromPaceAndHr(run.paceSecPerKm, run.avgHeartRate, args.restHr, args.maxHr);
			if (est != null) observations.push(est);
		}
	}

	if (observations.length === 0) {
		return {
			newVdot: args.currentVdot,
			observationCount: 0,
			changed: false,
			reasons: ['Ingen brukbare tempo-observasjoner denne uken — beholder gjeldende soner']
		};
	}

	const observed = median(observations)!;
	const blended = args.currentVdot + ADAPTIVE_PARAMS.vdotAlpha * (observed - args.currentVdot);
	const clamped = Math.max(
		args.currentVdot - ADAPTIVE_PARAMS.maxVdotStepPerWeek,
		Math.min(args.currentVdot + ADAPTIVE_PARAMS.maxVdotStepPerWeek, blended)
	);
	const newVdot = Math.round(clamped * 10) / 10;
	const changed = Math.abs(newVdot - args.currentVdot) >= ADAPTIVE_PARAMS.minVdotChange;

	const reasons: string[] = [];
	if (changed) {
		const direction = newVdot > args.currentVdot ? 'opp' : 'ned';
		reasons.push(
			`VDOT justert ${direction}: ${args.currentVdot} → ${newVdot} (observert ${Math.round(observed * 10) / 10} fra ${observations.length} målinger denne uken, dempet)`
		);
	} else {
		reasons.push(
			`Ukens løp bekrefter formen (observert VDOT ${Math.round(observed * 10) / 10}) — soner uendret`
		);
	}

	return {
		newVdot: changed ? newVdot : args.currentVdot,
		observedVdot: Math.round(observed * 10) / 10,
		observationCount: observations.length,
		changed,
		reasons
	};
}
