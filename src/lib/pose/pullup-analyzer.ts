/**
 * PullupAnalyzer — den «raske løkka» for live pull-up-coaching.
 *
 * Matet med én `PoseFrame` per videoframe (30 fps) avgjør den deterministisk,
 * uten LLM og uten nettverk:
 *   - repetisjoner (albuevinkel-tilstandsmaskin med hysterese)
 *   - hake-over-stang (nese vs. håndledd-linje) per rep
 *   - full utstrekning i bunn (albuevinkel) per rep
 *   - tempo (konsentrisk/eksentrisk varighet) per rep
 *
 * Cues er korte, prioriterte tekster ment for lyd — se `evaluateRepCue`.
 * Øktoppsummeringen (`summary()`) sendes til LLM-en for coaching i etterkant
 * (den «trege løkka»), aldri per frame.
 *
 * Terskler er kalibrert for en side-/frontvinkel der hele kroppen er i bildet.
 * Alt er rene funksjoner av input-framene, så oppførselen er enhetstestbar
 * ved å mate inn syntetiske sekvenser (se pullup-analyzer.test.ts).
 */

import { angleDeg, averageAngle, isVisible } from './geometry';
import type { PoseFrame } from './types';

export type PullupPhase = 'hang' | 'pulling' | 'top' | 'lowering' | 'unknown';

export type CueKind = 'rep' | 'chin' | 'rom' | 'tempo' | 'form-ok' | 'no-person';

export interface RepRecord {
	index: number;
	/** Nådde nesen stang-linja (håndleddshøyde) på toppen? */
	chinOverBar: boolean;
	/** Nådde armene tilnærmet full utstrekning i bunn? */
	fullExtension: boolean;
	/** Minste albuevinkel i rep-en (mest bøyd = høyest opp). */
	peakElbowAngle: number;
	/** Største albuevinkel rundt rep-en (mest strak = lavest ned). */
	bottomElbowAngle: number;
	concentricMs: number;
	eccentricMs: number;
}

export interface AnalyzerFeedback {
	repCount: number;
	phase: PullupPhase;
	elbowAngle: number | null;
	chinOverBar: boolean;
	/** Ny cue å si høyt akkurat nå, ellers null. */
	cue: string | null;
	cueKind: CueKind | null;
	/** Satt idet en rep fullføres. */
	completedRep: RepRecord | null;
}

export interface SessionSummary {
	reps: number;
	chinOverBarReps: number;
	fullExtensionReps: number;
	cleanReps: number;
	avgConcentricMs: number | null;
	avgEccentricMs: number | null;
	durationMs: number;
}

export interface PullupAnalyzerOptions {
	/** Minste keypoint-konfidens for å stole på et punkt. */
	minScore?: number;
	/** Albuevinkel ≥ denne = hengende/strak (bunn). */
	elbowDownDeg?: number;
	/** Albuevinkel ≤ denne = topp (bøyd). Hysterese mellom de to. */
	elbowUpDeg?: number;
	/** Albuevinkel i bunn må nå denne for å telle som full utstrekning. */
	fullExtensionDeg?: number;
	/** Toleranse (normalisert y) for hake-over-stang: nese ≤ håndledd + tol. */
	chinToleranceY?: number;
	/** Antall frames uten person før vi sier fra. */
	noPersonFrames?: number;
}

const DEFAULTS: Required<PullupAnalyzerOptions> = {
	minScore: 0.4,
	elbowDownDeg: 150,
	elbowUpDeg: 95,
	fullExtensionDeg: 160,
	chinToleranceY: 0.02,
	noPersonFrames: 30
};

export class PullupAnalyzer {
	private readonly opts: Required<PullupAnalyzerOptions>;

	private reps: RepRecord[] = [];
	private state: 'hang' | 'top' = 'hang';
	private phase: PullupPhase = 'unknown';

	private startedTs: number | null = null;
	private lastTs = 0;

	// Tidsstempler for tempo.
	private bottomTs = 0; // siste heng-frame før pull
	private topTs = 0; // idet toppen ble nådd
	private currentConcentricMs = 0; // låst ved hang→top-overgang

	// Per-rep-sporing (nullstilles ved fullført rep).
	private minElbowThisRep = 180;
	private maxElbowThisRep = 0;
	private chinReachedThisRep = false;

	private missingFrames = 0;
	private noPersonAnnounced = false;

	constructor(options: PullupAnalyzerOptions = {}) {
		this.opts = { ...DEFAULTS, ...options };
	}

	get repCount(): number {
		return this.reps.length;
	}

	/** Mat inn én frame. `ts` er millisekunder (monotont økende). */
	update(frame: PoseFrame, ts: number): AnalyzerFeedback {
		if (this.startedTs == null) {
			this.startedTs = ts;
			this.bottomTs = ts;
		}
		this.lastTs = ts;

		const elbowAngle = this.computeElbowAngle(frame);
		if (elbowAngle == null) {
			this.missingFrames++;
			if (this.missingFrames >= this.opts.noPersonFrames && !this.noPersonAnnounced) {
				this.noPersonAnnounced = true;
				return this.feedback(
					null,
					'Jeg ser deg ikke helt — steg litt tilbake så hele kroppen er i bildet.',
					'no-person',
					null
				);
			}
			return this.feedback(elbowAngle, null, null, null);
		}

		this.missingFrames = 0;
		this.noPersonAnnounced = false;

		// Spor rekkevidde + hake i inneværende rep.
		this.minElbowThisRep = Math.min(this.minElbowThisRep, elbowAngle);
		this.maxElbowThisRep = Math.max(this.maxElbowThisRep, elbowAngle);
		if (this.isChinOverBar(frame)) this.chinReachedThisRep = true;

		if (this.state === 'hang') {
			if (elbowAngle <= this.opts.elbowUpDeg) {
				// Nådde toppen — lås konsentrisk varighet (bunn → topp).
				this.topTs = ts;
				this.currentConcentricMs = Math.max(0, ts - this.bottomTs);
				this.state = 'top';
				this.phase = 'top';
			} else if (elbowAngle >= this.opts.elbowDownDeg) {
				// Kun i bunn (full/nær full utstrekning) nullstilles starttidspunktet,
				// slik at konsentrisk varighet spenner over HELE draget — ikke bare
				// siste frame før vi krysser topp-terskelen.
				this.bottomTs = ts;
				this.phase = 'hang';
			} else {
				this.phase = 'pulling';
			}
			return this.feedback(elbowAngle, null, null, null);
		}

		// state === 'top'
		if (elbowAngle >= this.opts.elbowDownDeg) {
			// Tilbake i heng → rep fullført.
			const rep = this.finishRep(ts);
			const { cue, cueKind } = evaluateRepCue(rep);
			return this.feedback(elbowAngle, cue, cueKind, rep);
		}
		this.phase = elbowAngle >= this.opts.elbowUpDeg + 15 ? 'lowering' : 'top';
		return this.feedback(elbowAngle, null, null, null);
	}

	summary(): SessionSummary {
		const reps = this.reps;
		const concentrics = reps.map((r) => r.concentricMs).filter((v) => v > 0);
		const eccentrics = reps.map((r) => r.eccentricMs).filter((v) => v > 0);
		const avg = (xs: number[]) =>
			xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;

		return {
			reps: reps.length,
			chinOverBarReps: reps.filter((r) => r.chinOverBar).length,
			fullExtensionReps: reps.filter((r) => r.fullExtension).length,
			cleanReps: reps.filter((r) => r.chinOverBar && r.fullExtension).length,
			avgConcentricMs: avg(concentrics),
			avgEccentricMs: avg(eccentrics),
			durationMs: this.startedTs != null ? this.lastTs - this.startedTs : 0
		};
	}

	getReps(): ReadonlyArray<RepRecord> {
		return this.reps;
	}

	private finishRep(ts: number): RepRecord {
		const rep: RepRecord = {
			index: this.reps.length + 1,
			chinOverBar: this.chinReachedThisRep,
			fullExtension: this.maxElbowThisRep >= this.opts.fullExtensionDeg,
			peakElbowAngle: Math.round(this.minElbowThisRep),
			bottomElbowAngle: Math.round(this.maxElbowThisRep),
			concentricMs: this.currentConcentricMs,
			eccentricMs: Math.max(0, ts - this.topTs)
		};

		this.reps.push(rep);
		this.state = 'hang';
		this.phase = 'hang';
		this.bottomTs = ts;
		this.minElbowThisRep = 180;
		this.maxElbowThisRep = 0;
		this.chinReachedThisRep = false;
		return rep;
	}

	private computeElbowAngle(frame: PoseFrame): number | null {
		const { minScore } = this.opts;
		const left =
			isVisible(frame.leftShoulder, minScore) &&
			isVisible(frame.leftElbow, minScore) &&
			isVisible(frame.leftWrist, minScore)
				? angleDeg(frame.leftShoulder, frame.leftElbow, frame.leftWrist)
				: null;
		const right =
			isVisible(frame.rightShoulder, minScore) &&
			isVisible(frame.rightElbow, minScore) &&
			isVisible(frame.rightWrist, minScore)
				? angleDeg(frame.rightShoulder, frame.rightElbow, frame.rightWrist)
				: null;
		return averageAngle(left, right);
	}

	private isChinOverBar(frame: PoseFrame): boolean {
		const { minScore, chinToleranceY } = this.opts;
		if (!isVisible(frame.nose, minScore)) return false;
		const wrists = [frame.leftWrist, frame.rightWrist].filter((w) =>
			isVisible(w, minScore)
		) as { y: number }[];
		if (wrists.length === 0) return false;
		const barY = wrists.reduce((sum, w) => sum + w.y, 0) / wrists.length;
		// y øker nedover → nesen er over stanga når nese-y ≤ stang-y (+ toleranse).
		return frame.nose.y <= barY + chinToleranceY;
	}

	private feedback(
		elbowAngle: number | null,
		cue: string | null,
		cueKind: CueKind | null,
		completedRep: RepRecord | null
	): AnalyzerFeedback {
		return {
			repCount: this.reps.length,
			phase: this.phase,
			elbowAngle: elbowAngle != null ? Math.round(elbowAngle) : null,
			chinOverBar: this.chinReachedThisRep,
			cue,
			cueKind,
			completedRep
		};
	}
}

/**
 * Prioritert cue for en fullført rep. Rekkefølge: hake > ROM > tempo > ok.
 * Bare én cue per rep for å unngå lyd-spam.
 */
export function evaluateRepCue(rep: RepRecord): { cue: string; cueKind: CueKind } {
	if (!rep.chinOverBar) {
		return { cue: 'Kom høyere — få haka over stanga.', cueKind: 'chin' };
	}
	if (!rep.fullExtension) {
		return { cue: 'Strekk armene helt ut i bunn.', cueKind: 'rom' };
	}
	if (rep.concentricMs > 0 && rep.concentricMs < 400) {
		return { cue: 'Litt mer kontroll oppover.', cueKind: 'tempo' };
	}
	return { cue: `Bra rep! ${rep.index}.`, cueKind: 'form-ok' };
}
