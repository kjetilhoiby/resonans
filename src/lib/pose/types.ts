/**
 * Delte typer for live pose-analyse.
 *
 * Koordinater er normaliserte (0..1) med origo øverst til venstre — samme
 * konvensjon som MediaPipe Pose. `y` øker altså NEDOVER i bildet. All logikk
 * i `pose/`-modulen er ren og kamera-uavhengig; selve pose-deteksjonen (som
 * krever nettleser + WASM) ligger i `$lib/client/pose-detector`.
 */

export interface Keypoint {
	/** Normalisert x (0..1), venstre → høyre. */
	x: number;
	/** Normalisert y (0..1), topp → bunn (øker nedover). */
	y: number;
	/** Synlighet/konfidens 0..1 fra pose-modellen. */
	score: number;
}

/** Punktene vi trenger for pull-up-analyse. */
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

export type PoseFrame = Partial<Record<KeypointName, Keypoint>>;

/**
 * MediaPipe Pose gir 33 landemerker. Her mapper vi indeksene vi bruker til
 * navngitte punkter, slik at resten av koden slipper å forholde seg til tall.
 * Se https://developers.google.com/mediapipe/solutions/vision/pose_landmarker
 */
export const MEDIAPIPE_LANDMARK_INDEX: Record<KeypointName, number> = {
	nose: 0,
	leftShoulder: 11,
	rightShoulder: 12,
	leftElbow: 13,
	rightElbow: 14,
	leftWrist: 15,
	rightWrist: 16,
	leftHip: 23,
	rightHip: 24
};

/**
 * Bygg en navngitt `PoseFrame` fra MediaPipes flate landemerke-liste.
 * Landemerker har `{ x, y, z, visibility }`; vi beholder x/y + visibility→score.
 */
export function frameFromMediapipeLandmarks(
	landmarks: ReadonlyArray<{ x: number; y: number; visibility?: number }>
): PoseFrame {
	const frame: PoseFrame = {};
	for (const [name, index] of Object.entries(MEDIAPIPE_LANDMARK_INDEX) as [KeypointName, number][]) {
		const lm = landmarks[index];
		if (!lm) continue;
		frame[name] = { x: lm.x, y: lm.y, score: lm.visibility ?? 1 };
	}
	return frame;
}
