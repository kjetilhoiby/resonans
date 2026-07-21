/**
 * PullupAnalyzer — deterministisk sanntidskjerne for pull-up-analyse.
 *
 * Mates med én `PoseFrame` per videoframe pluss en monotont økende tidsstempel
 * (`ts`, ms). Holder tilstand mellom frames og returnerer per-frame resultat
 * med fase, rep-telling og eventuell lyd-cue. Se `docs/EKKO_PULLUP_ANALYSE.md`.
 *
 * All logikk er lokal og rask — ingen nettverk, ingen LLM. Backend-coaching
 * bygges fra `buildSessionSummary()` etter økta.
 */
import { angle } from './geometry';
import {
	DEFAULT_THRESHOLDS,
	type AnalyzerThresholds,
	type Cue,
	type FrameResult,
	type Keypoint,
	type Phase,
	type PoseFrame,
	type PullupState,
	type RepMetrics,
	type SessionSummary
} from './types';

const CUE_TEXT = {
	chin: 'Kom høyere — få haka over stanga.',
	rom: 'Strekk armene helt ut i bunn.',
	tempo: 'Litt mer kontroll oppover.',
	noPerson: 'Jeg ser deg ikke helt — steg litt tilbake så hele kroppen er i bildet.'
} as const;

/** Tempo-terskel: konsentrisk fase raskere enn dette gir en tempo-cue. */
const FAST_CONCENTRIC_MS = 400;
/** Fase-margin over `elbowUpDeg` der vi regner det som senking, ikke topp. */
const LOWERING_MARGIN_DEG = 15;

export class PullupAnalyzer {
	private readonly t: AnalyzerThresholds;

	private state: PullupState = 'hang';
	private phase: Phase = 'hang';
	private repCount = 0;

	// Tidsstempler for tempo (§3.3).
	private bottomTs: number | null = null;
	private topTs: number | null = null;
	private concentricMs = 0;

	// Per-rep-akkumulatorer (nullstilles etter hver fullført rep).
	private minElbowThisRep = Infinity;
	private maxElbowThisRep = -Infinity;
	private chinFlagThisRep = false;

	// No-person-deteksjon.
	private noPersonCount = 0;
	private noPersonCued = false;

	// Øktgrenser.
	private startedTs: number | null = null;
	private lastTs = 0;

	private readonly reps: RepMetrics[] = [];

	constructor(thresholds: Partial<AnalyzerThresholds> = {}) {
		this.t = { ...DEFAULT_THRESHOLDS, ...thresholds };
	}

	/** Alle fullførte reps i rekkefølge (kopi). */
	getReps(): RepMetrics[] {
		return [...this.reps];
	}

	/** Mat inn én frame. Returnerer per-frame tilstand + evt. cue. */
	push(frame: PoseFrame, ts: number): FrameResult {
		if (this.startedTs === null) this.startedTs = ts;
		this.lastTs = ts;

		const elbowAngle = this.computeElbowAngle(frame);

		if (elbowAngle === null) {
			return this.handleNoPerson(ts);
		}

		// Gyldig frame: nullstill no-person-teller.
		this.noPersonCount = 0;
		this.noPersonCued = false;

		// Oppdater per-rep min/maks albuevinkel.
		if (elbowAngle < this.minElbowThisRep) this.minElbowThisRep = elbowAngle;
		if (elbowAngle > this.maxElbowThisRep) this.maxElbowThisRep = elbowAngle;

		// Hake over stang — klebrig innen rep-en (§3.4).
		if (!this.chinFlagThisRep && this.chinOverBarThisFrame(frame)) {
			this.chinFlagThisRep = true;
		}

		// Ekte bunn: oppdater bottomTs KUN når vi faktisk er i heng (§3.3).
		if (elbowAngle >= this.t.elbowDownDeg) {
			this.bottomTs = ts;
		}

		let repCompleted: RepMetrics | null = null;
		let cue: Cue | null = null;

		if (this.state === 'hang' && elbowAngle <= this.t.elbowUpDeg) {
			// hang → top: draget er fullført opp. Fest konsentrisk varighet.
			this.state = 'top';
			this.topTs = ts;
			this.concentricMs = this.bottomTs === null ? 0 : ts - this.bottomTs;
		} else if (this.state === 'top' && elbowAngle >= this.t.elbowDownDeg) {
			// top → hang: rep fullført (retur til heng etter topp).
			this.state = 'hang';
			repCompleted = this.finalizeRep(ts);
			cue = this.cueForRep(repCompleted);
		}

		this.phase = this.computePhase(elbowAngle);

		return {
			ts,
			elbowAngle,
			phase: this.phase,
			state: this.state,
			reps: this.repCount,
			repCompleted,
			cue
		};
	}

	/** Bygg aggregert øktoppsummering (§6). Ingen frames/video. */
	buildSessionSummary(): SessionSummary {
		const reps = this.reps.length;
		const chinOverBarReps = this.reps.filter((r) => r.chinOverBar).length;
		const fullExtensionReps = this.reps.filter((r) => r.fullExtension).length;
		const cleanReps = this.reps.filter((r) => r.chinOverBar && r.fullExtension).length;

		return {
			reps,
			chinOverBarReps,
			fullExtensionReps,
			cleanReps,
			avgConcentricMs: avgPositive(this.reps.map((r) => r.concentricMs)),
			avgEccentricMs: avgPositive(this.reps.map((r) => r.eccentricMs)),
			durationMs: this.startedTs === null ? 0 : this.lastTs - this.startedTs
		};
	}

	// ── interne hjelpere ──────────────────────────────────────────────

	private computeElbowAngle(frame: PoseFrame): number | null {
		const left = this.armAngle(frame.leftShoulder, frame.leftElbow, frame.leftWrist);
		const right = this.armAngle(frame.rightShoulder, frame.rightElbow, frame.rightWrist);
		if (left !== null && right !== null) return (left + right) / 2;
		return left ?? right;
	}

	private armAngle(
		shoulder?: Keypoint,
		elbow?: Keypoint,
		wrist?: Keypoint
	): number | null {
		if (!this.visible(shoulder) || !this.visible(elbow) || !this.visible(wrist)) return null;
		return angle(shoulder!, elbow!, wrist!);
	}

	private visible(k?: Keypoint): boolean {
		return !!k && k.score >= this.t.minScore;
	}

	private chinOverBarThisFrame(frame: PoseFrame): boolean {
		const nose = frame.nose;
		if (!this.visible(nose)) return false;
		const wrists = [frame.leftWrist, frame.rightWrist].filter((w) => this.visible(w)) as Keypoint[];
		if (wrists.length === 0) return false;
		const barY = wrists.reduce((sum, w) => sum + w.y, 0) / wrists.length;
		// y nedover: nesen «over» stanga betyr mindre y (§3.4).
		return nose!.y <= barY + this.t.chinToleranceY;
	}

	private computePhase(elbowAngle: number): Phase {
		if (elbowAngle >= this.t.elbowDownDeg) return 'hang';
		if (elbowAngle <= this.t.elbowUpDeg) return 'top';
		// I dødsonen: retning avgjøres av tilstanden.
		if (this.state === 'top') {
			return elbowAngle >= this.t.elbowUpDeg + LOWERING_MARGIN_DEG ? 'lowering' : 'top';
		}
		return 'pulling';
	}

	private finalizeRep(ts: number): RepMetrics {
		this.repCount += 1;
		const rep: RepMetrics = {
			index: this.repCount,
			chinOverBar: this.chinFlagThisRep,
			fullExtension: this.maxElbowThisRep >= this.t.fullExtensionDeg,
			peakElbowAngle: Math.round(this.minElbowThisRep),
			bottomElbowAngle: Math.round(this.maxElbowThisRep),
			concentricMs: this.concentricMs,
			eccentricMs: this.topTs === null ? 0 : ts - this.topTs
		};
		this.reps.push(rep);

		// Nullstill per-rep-akkumulatorer (§3.5).
		this.minElbowThisRep = Infinity;
		this.maxElbowThisRep = -Infinity;
		this.chinFlagThisRep = false;
		this.concentricMs = 0;

		return rep;
	}

	private cueForRep(rep: RepMetrics): Cue {
		if (!rep.chinOverBar) return { kind: 'chin', text: CUE_TEXT.chin, repIndex: rep.index };
		if (!rep.fullExtension) return { kind: 'rom', text: CUE_TEXT.rom, repIndex: rep.index };
		if (rep.concentricMs > 0 && rep.concentricMs < FAST_CONCENTRIC_MS) {
			return { kind: 'tempo', text: CUE_TEXT.tempo, repIndex: rep.index };
		}
		return { kind: 'form-ok', text: `Bra rep! ${rep.index}.`, repIndex: rep.index };
	}

	private handleNoPerson(ts: number): FrameResult {
		this.noPersonCount += 1;
		let cue: Cue | null = null;
		if (this.noPersonCount >= this.t.noPersonFrames && !this.noPersonCued) {
			this.noPersonCued = true;
			cue = { kind: 'no-person', text: CUE_TEXT.noPerson };
		}
		return {
			ts,
			elbowAngle: null,
			phase: this.phase,
			state: this.state,
			reps: this.repCount,
			repCompleted: null,
			cue
		};
	}
}

/** Snitt over kun positive verdier; null hvis ingen. */
function avgPositive(values: number[]): number | null {
	const positive = values.filter((v) => v > 0);
	if (positive.length === 0) return null;
	return positive.reduce((sum, v) => sum + v, 0) / positive.length;
}
