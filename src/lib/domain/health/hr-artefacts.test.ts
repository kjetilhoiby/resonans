import { describe, it, expect } from 'vitest';
import {
	ARTEFACT_MIN_JUMP_BPM,
	MAX_PLAUSIBLE_HR,
	MIN_PINNED_SECONDS,
	describeHrRejection,
	diagnoseHrSeries,
	isCredibleAverageHr,
	type HrSample
} from './hr-artefacts';

/** Referansebrukeren: hvile 46, maks 179 (målt 3. september 2026). */
const baseline = { restHr: 46, maxHr: 179 };

/** Ett punkt per sekund fra en pulsserie. */
function series(hrs: number[]): HrSample[] {
	return hrs.map((hr, i) => ({ tSec: i, hr }));
}

/** `n` sekunder på gitt puls. */
function at(hr: number, n: number): number[] {
	return Array.from({ length: n }, () => hr);
}

/** En troverdig rolig økt: puls som vandrer et par slag, som den gjør. */
function wandering(base: number, n: number): number[] {
	return Array.from({ length: n }, (_, i) => base + (i % 5) - 2);
}

describe('diagnoseHrSeries', () => {
	it('godtar en pulskurve som vandrer', () => {
		const d = diagnoseHrSeries(series(wandering(132, 1800)));
		expect(d.usable).toBe(true);
		expect(d.reasons).toEqual([]);
	});

	it('skiller «ingen puls» fra «puls vi ikke tror på»', () => {
		// Tom serie: ikke brukbar, men INGEN grunn — den som spør skal falle
		// tilbake på «ingen måling», ikke på at sensoren løy.
		const d = diagnoseHrSeries([]);
		expect(d.usable).toBe(false);
		expect(d.reasons).toEqual([]);
		expect(describeHrRejection(d)).toBeNull();
	});

	it('forkaster det gamle beltet: hopp til 230 og fast der oppe', () => {
		const d = diagnoseHrSeries(series([...wandering(130, 300), ...at(230, 2100)]));
		expect(d.usable).toBe(false);
		// To uavhengige detektorer skal fyre på samme kurve.
		expect(d.reasons).toContain('implausible_values');
		expect(d.reasons).toContain('pinned');
		expect(d.longestPinnedSeconds).toBeGreaterThanOrEqual(MIN_PINNED_SECONDS);
		expect(describeHrRejection(d)).toContain('fastlåst');
	});

	it('lar en enkelt gal måling stå — én glipp er ikke et mønster', () => {
		const hrs = wandering(140, 2000);
		hrs[900] = MAX_PLAUSIBLE_HR + 20;
		const d = diagnoseHrSeries(series(hrs));
		expect(d.implausible).toBe(1);
		expect(d.usable).toBe(true);
	});

	it('forkaster kurven når de gale verdiene er et mønster', () => {
		// Hver tiende måling utenfor det mulige er 10 %, altså over terskelen.
		const hrs = wandering(140, 1000).map((hr, i) => (i % 10 === 0 ? MAX_PLAUSIBLE_HR + 15 : hr));
		const d = diagnoseHrSeries(series(hrs));
		expect(d.reasons).toContain('implausible_values');
		expect(d.usable).toBe(false);
	});

	it('godtar en flat kurve UTEN hopp — en glattende enhet er ikke en ødelagt', () => {
		// Fastlåst alene feller ingen økt: se MIN_PINNED_SECONDS for hvorfor.
		const d = diagnoseHrSeries(series(at(142, 1800)));
		expect(d.longestPinnedSeconds).toBeGreaterThanOrEqual(MIN_PINNED_SECONDS);
		expect(d.reasons).not.toContain('pinned');
		expect(d.usable).toBe(true);
	});

	it('regner ikke langsom drift som fastlåst', () => {
		// Ett slag av gangen over en halvtime: strekket måles mot sine EGNE
		// ytterpunkter, ikke mot forrige punkt.
		const hrs = Array.from({ length: 1800 }, (_, i) => 120 + Math.floor(i / 60));
		const d = diagnoseHrSeries(series(hrs));
		expect(d.longestPinnedSeconds).toBeLessThan(MIN_PINNED_SECONDS);
		expect(d.usable).toBe(true);
	});

	it('teller et hopp på ett sekund, men ikke den samme endringen over et hull', () => {
		const jump = diagnoseHrSeries([
			{ tSec: 0, hr: 130 },
			{ tSec: 1, hr: 130 + ARTEFACT_MIN_JUMP_BPM + 5 }
		]);
		expect(jump.jumps).toBe(1);

		const overGap = diagnoseHrSeries([
			{ tSec: 0, hr: 130 },
			{ tSec: 60, hr: 130 + ARTEFACT_MIN_JUMP_BPM + 5 }
		]);
		expect(overGap.jumps).toBe(0);
	});

	it('godtar starten på et hardt drag', () => {
		// ~1,5 slag/s er fysiologi og skal ikke telles som artefakt.
		const hrs = Array.from({ length: 60 }, (_, i) => 130 + Math.round(i * 1.5));
		expect(diagnoseHrSeries(series(hrs)).jumps).toBe(0);
	});

	it('forkaster en kurve som hopper hele veien', () => {
		const hrs = Array.from({ length: 600 }, (_, i) => (i % 2 === 0 ? 120 : 190));
		const d = diagnoseHrSeries(series(hrs));
		expect(d.reasons).toContain('noisy_jumps');
		expect(d.usable).toBe(false);
	});
});

describe('isCredibleAverageHr', () => {
	it('godtar et snitt innenfor reserven', () => {
		expect(isCredibleAverageHr(142, baseline)).toBe(true);
		expect(isCredibleAverageHr(178, baseline)).toBe(true);
	});

	it('godtar et mistenkelig men mulig snitt over anslått maks', () => {
		// Makspulsen er som regel Tanaka, ikke en måling — så litt over er ikke umulig.
		expect(isCredibleAverageHr(185, baseline)).toBe(true);
	});

	it('forkaster et snitt et ødelagt belte ville gitt', () => {
		expect(isCredibleAverageHr(230, baseline)).toBe(false);
		expect(isCredibleAverageHr(210, baseline)).toBe(false);
	});

	it('forkaster tull framfor å dele på et gjettet tall', () => {
		expect(isCredibleAverageHr(0, baseline)).toBe(false);
		expect(isCredibleAverageHr(12, baseline)).toBe(false);
		expect(isCredibleAverageHr(140, { restHr: 60, maxHr: 60 })).toBe(false);
	});
});
