/**
 * On-device keyframe-uttrekk fra video (nettleser).
 *
 * Laster videoen lokalt via `createObjectURL` (streames/dekodes — hele fila
 * lastes IKKE inn i JS-minnet), søker til noen jevnt fordelte tidspunkt, tegner
 * hvert til et canvas nedskalert til `maxDimension`, og eksporterer JPEG.
 *
 * Poenget: en 160 MB video treffer Vercels ~4,5 MB body-grense hvis den lastes
 * opp rått. Vi trenger bare 6 frames — dem trekker vi ut her og laster opp bare
 * de små JPEG-ene. Lokal fil via object-URL er same-origin, så canvas blir ikke
 * «tainted» og `toBlob` virker.
 *
 * Kan ikke enhetstestes i Node (krever <video>/<canvas>); tidsvalg-logikken
 * ligger i `$lib/media/video-frame-timing` og er testet der.
 */

import { pickFrameOffsets, MAX_VIDEO_FRAMES } from '$lib/media/video-frame-timing';
import { selectKeyframeOffsets, type FrameSample } from '$lib/media/keyframe-selection';

export interface ExtractedFrame {
	blob: Blob;
	timestampSec: number;
}

export interface VideoFramesResult {
	frames: ExtractedFrame[];
	durationSec: number;
}

export interface ExtractVideoFramesOptions {
	maxFrames?: number;
	/** Lengste kant på utdata-bildet i piksler. */
	maxDimension?: number;
	/** JPEG-kvalitet 0..1. */
	quality?: number;
	/**
	 * Scrubb gjennom videoen for å velge de mest informative framene (klipp /
	 * store endringer) i stedet for jevnt fordelte. Faller tilbake til jevn
	 * fordeling hvis nettleseren mangler requestVideoFrameCallback eller
	 * samplingen gir for få kandidater.
	 */
	contentAware?: boolean;
}

interface VideoFrameCallbackMeta {
	mediaTime: number;
}
type VideoWithFrameCallback = HTMLVideoElement & {
	requestVideoFrameCallback(cb: (now: number, metadata: VideoFrameCallbackMeta) => void): number;
};

function hasVideoFrameCallback(video: HTMLVideoElement): video is VideoWithFrameCallback {
	return 'requestVideoFrameCallback' in video;
}

/** Liten gråtone-signatur av gjeldende videoframe (for endrings-måling). */
function computeSignature(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, size: number): number[] {
	ctx.drawImage(video, 0, 0, size, size);
	const { data } = ctx.getImageData(0, 0, size, size);
	const sig = new Array<number>(size * size);
	for (let i = 0, p = 0; i < data.length; i += 4, p++) {
		sig[p] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
	}
	return sig;
}

/**
 * Spol gjennom videoen (avspilt i høy hastighet) og samle gråtone-signaturer via
 * requestVideoFrameCallback — mye raskere enn å søke frem og tilbake. Throttlet
 * på `minGapSec` og begrenset til `maxSamples`.
 */
async function sampleSignatures(
	video: VideoWithFrameCallback,
	{ minGapSec = 0.4, maxSamples = 120, size = 32, playbackRate = 8 } = {}
): Promise<FrameSample[]> {
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) return [];

	const samples: FrameSample[] = [];
	let lastTs = -Infinity;
	video.muted = true;
	video.playbackRate = playbackRate;

	return new Promise<FrameSample[]>((resolve) => {
		let done = false;
		const finish = () => {
			if (done) return;
			done = true;
			video.pause();
			resolve(samples);
		};
		const onFrame = (_now: number, metadata: VideoFrameCallbackMeta) => {
			if (done) return;
			const t = metadata?.mediaTime ?? video.currentTime;
			if (t - lastTs >= minGapSec) {
				lastTs = t;
				samples.push({ timestampSec: t, signature: computeSignature(ctx, video, size) });
			}
			if (samples.length >= maxSamples) {
				finish();
				return;
			}
			video.requestVideoFrameCallback(onFrame);
		};
		video.addEventListener('ended', finish, { once: true });
		video.requestVideoFrameCallback(onFrame);
		video.play().catch(() => finish());
	});
}

function waitForEvent(el: HTMLMediaElement, event: string, timeoutMs = 15000): Promise<void> {
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			el.removeEventListener(event, onOk);
			el.removeEventListener('error', onErr);
			clearTimeout(timer);
		};
		const onOk = () => {
			cleanup();
			resolve();
		};
		const onErr = () => {
			cleanup();
			reject(new Error(`Videofeil under «${event}»`));
		};
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error(`Tidsavbrudd under «${event}»`));
		}, timeoutMs);
		el.addEventListener(event, onOk, { once: true });
		el.addEventListener('error', onErr, { once: true });
	});
}

function seekTo(video: HTMLVideoElement, timeSec: number): Promise<void> {
	const done = waitForEvent(video, 'seeked');
	video.currentTime = timeSec;
	return done;
}

/**
 * Fang én frame fra et allerede lastet videoelement på gitt tidspunkt, som
 * nedskalert JPEG. Brukes av den manuelle frame-pickeren (brukeren spoler og
 * fanger). Videoelementet må ha metadata lastet (videoWidth/Height satt).
 */
export async function captureFrameAt(
	video: HTMLVideoElement,
	timeSec: number,
	{ maxDimension = 640, quality = 0.7 }: { maxDimension?: number; quality?: number } = {}
): Promise<ExtractedFrame> {
	await seekTo(video, timeSec);
	const vw = video.videoWidth;
	const vh = video.videoHeight;
	if (!vw || !vh) throw new Error('Videoen har ingen dimensjoner');
	const scale = Math.min(1, maxDimension / Math.max(vw, vh));
	const canvas = document.createElement('canvas');
	canvas.width = Math.round(vw * scale);
	canvas.height = Math.round(vh * scale);
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Fikk ikke 2d-kontekst');
	ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
	const blob = await new Promise<Blob | null>((resolve) =>
		canvas.toBlob(resolve, 'image/jpeg', quality)
	);
	if (!blob) throw new Error('toBlob feilet');
	return { blob, timestampSec: Math.round(timeSec * 10) / 10 };
}

/**
 * Trekk ut keyframes fra en videofil. Kaster hvis nettleseren ikke klarer å
 * dekode videoen (så kalleren kan falle tilbake til rå opplasting).
 */
export async function extractVideoFrames(
	file: File,
	{ maxFrames = MAX_VIDEO_FRAMES, maxDimension = 640, quality = 0.7, contentAware = true }: ExtractVideoFramesOptions = {}
): Promise<VideoFramesResult> {
	const url = URL.createObjectURL(file);
	const video = document.createElement('video');
	video.muted = true;
	video.playsInline = true;
	video.preload = 'auto';
	video.src = url;

	try {
		await waitForEvent(video, 'loadedmetadata');
		const duration = video.duration;
		const vw = video.videoWidth;
		const vh = video.videoHeight;
		if (!vw || !vh || !Number.isFinite(duration) || duration <= 0) {
			throw new Error('Klarte ikke å lese videoens dimensjoner/varighet');
		}

		const scale = Math.min(1, maxDimension / Math.max(vw, vh));
		const canvas = document.createElement('canvas');
		canvas.width = Math.round(vw * scale);
		canvas.height = Math.round(vh * scale);
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('Fikk ikke 2d-kontekst');

		// Innholdsbevisst utvalg: spol gjennom, mål endring, velg de mest
		// informative framene. Faller tilbake til jevn fordeling ved behov.
		let offsets = pickFrameOffsets(duration, maxFrames);
		if (contentAware && duration >= 4 && hasVideoFrameCallback(video)) {
			try {
				const samples = await sampleSignatures(video);
				if (samples.length > maxFrames) {
					offsets = selectKeyframeOffsets(samples, maxFrames);
				}
			} catch {
				// behold jevn fordeling
			} finally {
				video.playbackRate = 1;
			}
		}

		const frames: ExtractedFrame[] = [];
		for (const sec of offsets) {
			await seekTo(video, sec);
			ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
			const blob = await new Promise<Blob | null>((resolve) =>
				canvas.toBlob(resolve, 'image/jpeg', quality)
			);
			if (blob) frames.push({ blob, timestampSec: sec });
		}

		if (frames.length === 0) throw new Error('Fikk ikke trukket ut noen frames');
		return { frames, durationSec: duration };
	} finally {
		video.removeAttribute('src');
		video.load();
		URL.revokeObjectURL(url);
	}
}
