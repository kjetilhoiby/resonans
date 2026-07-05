import type { PlannedExerciseDTO, PlannedRunDTO } from '../programs/types';

/**
 * Typer for treningsløp-motorene. Motorene er rene funksjoner:
 * faktiske økter injiseres som data, DB-tilgang ligger i repository.ts.
 */

export type TrackKind = 'styrke' | 'utholdenhet';

export interface TrackWindow {
	startDate: string; // YYYY-MM-DD
	targetDate: string; // YYYY-MM-DD
}

// ─── Styrke ──────────────────────────────────────────────────────────────────

export interface StrengthSetActual {
	reps?: number;
	durationSeconds?: number;
	weight?: number;
}

export interface StrengthSessionActual {
	date: string; // YYYY-MM-DD
	exercises: Array<{ name: string; sets: StrengthSetActual[] }>;
}

export interface StrengthGoal {
	armhevinger: { fra: number; til: number };
	planke: { fraSek: number; tilSek: number };
}

/** Sammendrag av én styrkeøkt på metrikkene løpet bryr seg om. */
export interface StrengthSessionSummary {
	date: string;
	armhevingerTotal: number;
	plankeBestSeconds: number;
	pullupNegativBestSeconds: number;
	pullupNegativSets: number;
	pullupReps: number;
}

export type PullupPhase = 'negativer' | 'strikte';

export interface StrengthState {
	armhevinger: { siste: number | null; forventet: number; nesteTarget: number; stall: boolean };
	planke: { sisteSek: number | null; forventetSek: number; nesteTargetSek: number; stall: boolean };
	pullup: {
		fase: PullupPhase;
		sisteNegativSek: number | null;
		sisteReps: number | null;
		nesteTarget: { negativSek?: number; reps?: number };
	};
}

// ─── Utholdenhet ─────────────────────────────────────────────────────────────

export interface EnduranceWorkout {
	date: string; // YYYY-MM-DD
	family: string; // 'running' | 'cycling' | 'ebike' | ...
	effortScore: number | null;
	distanceMeters: number | null;
	durationSeconds: number | null;
}

export interface EnduranceGoal {
	ukesKm: { fra: number; til: number };
	paceSekPerKm: { fra: number; til: number };
}

export interface EnduranceConfig {
	deloadHverNteUke: number; // 0 = aldri
	/** @deprecated Sykkel teller ikke lenger i km-regnskapet — feltet kan stå i DB. */
	maksIkkeLopAndel?: number;
	effortVekstFaktor?: number; // ukesband: forrigeUke × faktor (default 1.2)
	hvileRatioTerskel?: number; // akutt/kronisk-ratio som utløser hvileanbefaling (default 1.5)
}

// ─── Effort-budsjett (uke) ───────────────────────────────────────────────────

export interface EffortBudget {
	/** Intervall for denne uken, forankret i forrige ukes faktiske total. */
	bandMin: number;
	bandMax: number;
	spentThisWeek: number;
	remainingMin: number;
	remainingMax: number;
	/** sum(effort siste 3 dager) / (3 × dagsnitt siste 30). Null ved < 14 dagers historikk. */
	acuteChronicRatio: number | null;
	restRecommended: boolean;
	deload: boolean;
	anchor: 'forrige_uke' | 'p4w_snitt' | 'gulv';
}

export interface EnduranceWeekState {
	weekTargetKm: number; // rene løpe-km — sykkel teller IKKE her (kun i effort-budsjettet)
	deload: boolean;
	runKm: number;
	remainingKm: number;
	stallRebased: boolean;
}

export interface EnduranceState {
	week: EnduranceWeekState;
	forventetPaceSekPerKm: number;
	sistePaceSekPerKm: number | null; // snitt av løpeøkter siste 14 dager
	lengsteLopKmSiste6Uker: number;
}

// ─── Øktforslag ──────────────────────────────────────────────────────────────

export interface SessionSuggestion {
	kind: 'strength' | 'run';
	name: string;
	restSeconds?: number;
	plannedExercises?: PlannedExerciseDTO[];
	plannedRun?: PlannedRunDTO;
	notes?: string;
}
