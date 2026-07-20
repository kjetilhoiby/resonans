/**
 * Lyd-cues for live teknikk-coaching. Fordi brukeren henger i stanga eller
 * står i en positur og ikke kan se skjermen, er lyd hovedkanalen for
 * tilbakemelding i sanntid.
 */

import { browser } from '$app/environment';

export interface Voice {
	speak(text: string, opts?: { minGapMs?: number }): void;
	cancel(): void;
}

/** Norsk tale via Web Speech API, med en enkel demper mot overlappende cues. */
export function createVoice(): Voice {
	const supported = browser && typeof window !== 'undefined' && 'speechSynthesis' in window;
	let lastSpokenAt = -Infinity;

	return {
		speak(text, { minGapMs = 900 } = {}) {
			if (!supported) return;
			const now = performance.now();
			if (now - lastSpokenAt < minGapMs) return;
			lastSpokenAt = now;
			const utterance = new SpeechSynthesisUtterance(text);
			utterance.lang = 'nb-NO';
			utterance.rate = 1.05;
			window.speechSynthesis.cancel();
			window.speechSynthesis.speak(utterance);
		},
		cancel() {
			if (supported) window.speechSynthesis.cancel();
		}
	};
}

/** Kort pip — brukes til å markere en fullført rep. */
export function beep(freq = 880, ms = 120): void {
	if (!browser) return;
	try {
		const Ctx =
			window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
		if (!Ctx) return;
		const ctx = new Ctx();
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.frequency.value = freq;
		osc.connect(gain);
		gain.connect(ctx.destination);
		gain.gain.setValueAtTime(0.15, ctx.currentTime);
		gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + ms / 1000);
		osc.start();
		osc.stop(ctx.currentTime + ms / 1000);
		osc.onended = () => ctx.close();
	} catch {
		// Lyd er ikke kritisk — ignorer feil (f.eks. autoplay-restriksjoner).
	}
}
