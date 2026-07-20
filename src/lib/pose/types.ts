/**
 * Delte typer for pose-analyse (pull-ups). Referanseimplementasjon for
 * Ekko-iOS-porten — se `docs/EKKO_PULLUP_ANALYSE.md`.
 *
 * Koordinatkonvensjon: normaliserte punkter i [0, 1] med **y nedover**
 * (0 = topp, 1 = bunn), som MediaPipe. iOS Vision gir y oppover og MÅ
 * konverteres ved inntak (`y' = 1 − y_vision`), se speccen §2.
 */

/** Keypoints vi bruker. Hofter kun til skjelett-tegning, ikke telling. */
export type KeypointName =
	| 'nose'
	| 'leftShoulder'
	| 'rightShoulder'
	| 'leftElbow'
	| 'rightElbow'
	| 'leftWrist'
	| 'rightWrist'
	| 'leftHip'
	| 'rightHip';

/** Ett normalisert punkt. `score` = pose-estimatorens konfidens (0–1). */
export interface Keypoint {
	x: number;
	y: number;
	score: number;
}

/** Én videoframe: et delvis kart fra keypoint-navn til punkt. */
export type PoseFrame = Partial<Record<KeypointName, Keypoint>>;

/** UI-fase (kosmetisk, påvirker ikke telling). */
export type Phase = 'hang' | 'pulling' | 'top' | 'lowering';

/** Intern tilstandsmaskin-tilstand (§3.2). */
export type PullupState = 'hang' | 'top';

/** Terskler for analysatoren (§4). */
export interface AnalyzerThresholds {
	/** Minste keypoint-konfidens for at et punkt teller. */
	minScore: number;
	/** Albuevinkel ≤ denne ⇒ topp. */
	elbowUpDeg: number;
	/** Albuevinkel ≥ denne ⇒ bunn/heng. */
	elbowDownDeg: number;
	/** Maks albuevinkel ≥ denne i rep-en ⇒ full utstrekning. */
	fullExtensionDeg: number;
	/** Slingringsmonn for hake-over-stang (normalisert y). */
	chinToleranceY: number;
	/** Antall sammenhengende tomme frames før no-person-cue. */
	noPersonFrames: number;
}

export const DEFAULT_THRESHOLDS: AnalyzerThresholds = {
	minScore: 0.4,
	elbowUpDeg: 95,
	elbowDownDeg: 150,
	fullExtensionDeg: 160,
	chinToleranceY: 0.02,
	noPersonFrames: 30
};

/** Låst metrikk for én fullført rep (§3.5). */
export interface RepMetrics {
	/** 1-basert rep-nummer. */
	index: number;
	/** Nådde haka over stanga i rep-en. */
	chinOverBar: boolean;
	/** Nådde full utstrekning i bunn. */
	fullExtension: boolean;
	/** Mest bøyd albuevinkel i rep-en (topp), avrundet. */
	peakElbowAngle: number;
	/** Mest strak albuevinkel i rep-en (bunn), avrundet. */
	bottomElbowAngle: number;
	/** Varighet konsentrisk fase (bunn → topp) i ms, 0 hvis ukjent. */
	concentricMs: number;
	/** Varighet eksentrisk fase (topp → bunn) i ms, 0 hvis ukjent. */
	eccentricMs: number;
}

/** Lyd-cue-typer (§5). */
export type CueKind = 'chin' | 'rom' | 'tempo' | 'form-ok' | 'no-person';

/** En cue som skal spilles (norsk tekst + maskinlesbar type). */
export interface Cue {
	kind: CueKind;
	text: string;
	/** Rep-nummer cue-en gjelder (utelatt for no-person). */
	repIndex?: number;
}

/** Resultatet fra å mate inn én frame. */
export interface FrameResult {
	ts: number;
	/** Snitt-albuevinkel i grader, eller null hvis ingen arm er synlig. */
	elbowAngle: number | null;
	phase: Phase;
	state: PullupState;
	/** Totalt antall fullførte reps så langt. */
	reps: number;
	/** Satt kun på framet der en rep fullføres. */
	repCompleted: RepMetrics | null;
	/** Cue å spille dette framet (rep-cue eller no-person), ellers null. */
	cue: Cue | null;
}

/** Aggregert øktoppsummering sendt til backend (§6). Aldri video/frames. */
export interface SessionSummary {
	reps: number;
	chinOverBarReps: number;
	fullExtensionReps: number;
	cleanReps: number;
	avgConcentricMs: number | null;
	avgEccentricMs: number | null;
	durationMs: number;
}
