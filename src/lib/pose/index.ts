/**
 * Pose-analyse for Ekko-pull-ups. Deterministisk, on-device-ekvivalent
 * referanseimplementasjon (TypeScript) som Swift-porten replikerer.
 *
 * Se `docs/EKKO_PULLUP_ANALYSE.md` for full spec og testvektorer.
 */
export { angle } from './geometry';
export { PullupAnalyzer } from './pullup-analyzer';
export { buildCoachContext } from './session-summary';
export {
	DEFAULT_THRESHOLDS,
	type AnalyzerThresholds,
	type Cue,
	type CueKind,
	type FrameResult,
	type Keypoint,
	type KeypointName,
	type Phase,
	type PoseFrame,
	type PullupState,
	type RepMetrics,
	type SessionSummary
} from './types';
