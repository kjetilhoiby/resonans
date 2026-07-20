/**
 * Tynn nettleser-wrapper rundt MediaPipe Pose (Tasks Vision).
 *
 * Kjører HELT på klienten: WASM + modell lastes fra CDN i brukerens nettleser,
 * og kroppsvideo forlater aldri enheten. Kun de utledede tallene
 * (rep-oppsummering) sendes videre til serveren/LLM-en.
 *
 * Isolert her fordi den krever `window`/WebGL og ikke kan enhetstestes i Node —
 * all testbar logikk ligger i `$lib/pose/`.
 */

import { browser } from '$app/environment';
import { frameFromMediapipeLandmarks, type PoseFrame } from '$lib/pose/types';

const MEDIAPIPE_VERSION = '0.10.35';
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const MODEL_URL =
	'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

export interface PoseSample {
	frame: PoseFrame;
	/** Alle 33 landemerker (normalisert) — brukes til å tegne skjelettet. */
	landmarks: Array<{ x: number; y: number; visibility: number }>;
}

export interface PoseDetector {
	detect(video: HTMLVideoElement, timestampMs: number): PoseSample | null;
	close(): void;
}

export async function createPoseDetector(): Promise<PoseDetector> {
	if (!browser) throw new Error('Pose-deteksjon krever nettleser');

	const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
	const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
	const landmarker = await PoseLandmarker.createFromOptions(fileset, {
		baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
		runningMode: 'VIDEO',
		numPoses: 1
	});

	return {
		detect(video, ts) {
			const result = landmarker.detectForVideo(video, ts);
			const lm = result.landmarks?.[0];
			if (!lm || lm.length === 0) return null;
			return {
				frame: frameFromMediapipeLandmarks(lm),
				landmarks: lm.map((p) => ({ x: p.x, y: p.y, visibility: p.visibility ?? 1 }))
			};
		},
		close() {
			landmarker.close();
		}
	};
}
