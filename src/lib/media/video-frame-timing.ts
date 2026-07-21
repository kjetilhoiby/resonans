/**
 * Ren, delt logikk for keyframe-sampling fra video. Ingen DOM, ingen server-
 * avhengigheter — importeres både av klient-uttrekkeren
 * (`$lib/client/video-frames`) og server-siden (`attachment-extract`).
 */

/** Maks antall keyframes vi sampler fra en video (kostnadstak for vision). */
export const MAX_VIDEO_FRAMES = 6;

/**
 * Velg tidspunkter (sekunder) for keyframe-sampling, jevnt fordelt og med
 * bevisst klaring til start (ofte svart) og slutt.
 */
export function pickFrameOffsets(durationSec: number, maxFrames = MAX_VIDEO_FRAMES): number[] {
	if (!Number.isFinite(durationSec) || durationSec <= 0) return [];
	const count = Math.min(maxFrames, Math.max(2, Math.floor(durationSec / 8)));
	const offsets: number[] = [];
	for (let k = 1; k <= count; k++) {
		const t = (durationSec * k) / (count + 1);
		offsets.push(Math.round(t * 10) / 10);
	}
	return [...new Set(offsets)].filter((t) => t > 0 && t < durationSec);
}

/** Sekunder → «m:ss». */
export function formatTimestamp(sec: number): string {
	const total = Math.max(0, Math.round(sec));
	const m = Math.floor(total / 60);
	const s = total % 60;
	return `${m}:${s.toString().padStart(2, '0')}`;
}
