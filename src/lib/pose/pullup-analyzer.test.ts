import { describe, it, expect } from 'vitest';
import { PullupAnalyzer, evaluateRepCue, type RepRecord } from './pullup-analyzer';
import type { PoseFrame } from './types';

/**
 * Bygg en syntetisk frame med en gitt albuevinkel (skulder–albue–håndledd)
 * og nese-høyde. Håndleddene ligger på «stang-høyde» (y=0.2), så nese-y ≤ 0.22
 * teller som hake-over-stang med default-toleransen.
 */
function makeFrame(elbowDeg: number, noseY: number, score = 1): PoseFrame {
	const rad = (elbowDeg * Math.PI) / 180;
	const sin = Math.sin(rad);
	const cos = Math.cos(rad);
	const wristY = 0.2;
	const elbowY = 0.35;
	const armLen = 0.2;
	const kp = (x: number, y: number) => ({ x, y, score });
	return {
		nose: kp(0.5, noseY),
		leftShoulder: kp(0.4 + armLen * sin, elbowY - armLen * cos),
		rightShoulder: kp(0.6 - armLen * sin, elbowY - armLen * cos),
		leftElbow: kp(0.4, elbowY),
		rightElbow: kp(0.6, elbowY),
		leftWrist: kp(0.4, wristY),
		rightWrist: kp(0.6, wristY),
		leftHip: kp(0.45, 0.7),
		rightHip: kp(0.55, 0.7)
	};
}

interface Step {
	t: number;
	e: number;
	n: number;
}

/**
 * Én komplett rep som en sekvens av frames: bunn → dra opp → topp → senk → bunn.
 * `chin`/`fullExt` styrer om nesen når stanga og om armene strekkes helt ut,
 * `fast` gir en kort konsentrisk fase (< 400 ms).
 */
function buildRep(
	base: number,
	{ chin = true, fullExt = true, fast = false }: { chin?: boolean; fullExt?: boolean; fast?: boolean } = {}
): Step[] {
	const bottom = fullExt ? 170 : 152;
	const topN = chin ? 0.2 : 0.5;
	const steps: Step[] = [
		{ t: base, e: bottom, n: 0.7 },
		{ t: base + 100, e: bottom, n: 0.7 } // låser bottomTs
	];
	let topT: number;
	if (fast) {
		topT = base + 200;
		steps.push({ t: topT, e: 90, n: topN });
	} else {
		steps.push({ t: base + 200, e: 140, n: 0.6 });
		steps.push({ t: base + 300, e: 125, n: 0.5 });
		steps.push({ t: base + 400, e: 110, n: 0.4 });
		topT = base + 600;
		steps.push({ t: topT, e: 90, n: topN });
	}
	steps.push({ t: topT + 100, e: 75, n: topN }); // topp
	steps.push({ t: topT + 200, e: 120, n: 0.4 }); // senker
	steps.push({ t: topT + 300, e: bottom, n: 0.7 }); // fullført
	return steps;
}

function feed(analyzer: PullupAnalyzer, steps: Step[]) {
	const completed: RepRecord[] = [];
	const cues: string[] = [];
	for (const s of steps) {
		const fb = analyzer.update(makeFrame(s.e, s.n), s.t);
		if (fb.completedRep) completed.push(fb.completedRep);
		if (fb.cue) cues.push(fb.cue);
	}
	return { completed, cues };
}

describe('PullupAnalyzer', () => {
	it('teller én ren rep med hake over stang og full utstrekning', () => {
		const a = new PullupAnalyzer();
		const { completed } = feed(a, buildRep(0));
		expect(a.repCount).toBe(1);
		expect(completed).toHaveLength(1);
		expect(completed[0].chinOverBar).toBe(true);
		expect(completed[0].fullExtension).toBe(true);
		expect(completed[0].peakElbowAngle).toBeLessThanOrEqual(95);
	});

	it('teller flere reps på rad', () => {
		const a = new PullupAnalyzer();
		feed(a, buildRep(0));
		feed(a, buildRep(2000));
		feed(a, buildRep(4000));
		expect(a.repCount).toBe(3);
	});

	it('teller ikke reps når albuen dirrer i dødsonen (hysterese)', () => {
		const a = new PullupAnalyzer();
		const steps: Step[] = [{ t: 0, e: 170, n: 0.7 }];
		// Oscillerer mellom 100 og 145 — aldri ≤ 95, så aldri en «topp».
		for (let i = 1; i <= 20; i++) {
			steps.push({ t: i * 100, e: i % 2 === 0 ? 145 : 100, n: 0.4 });
		}
		feed(a, steps);
		expect(a.repCount).toBe(0);
	});

	it('teller ikke dobbelt når man henger på toppen i flere frames', () => {
		const a = new PullupAnalyzer();
		const steps: Step[] = [
			{ t: 0, e: 170, n: 0.7 },
			{ t: 100, e: 170, n: 0.7 },
			{ t: 200, e: 90, n: 0.2 }, // topp
			{ t: 300, e: 80, n: 0.18 }, // fortsatt topp
			{ t: 400, e: 85, n: 0.19 }, // fortsatt topp
			{ t: 500, e: 75, n: 0.18 }, // fortsatt topp
			{ t: 600, e: 170, n: 0.7 } // ned → 1 rep
		];
		feed(a, steps);
		expect(a.repCount).toBe(1);
	});

	it('gir hake-cue når nesen ikke når stanga', () => {
		const a = new PullupAnalyzer();
		const { completed, cues } = feed(a, buildRep(0, { chin: false }));
		expect(completed[0].chinOverBar).toBe(false);
		expect(cues.some((c) => c.includes('haka'))).toBe(true);
	});

	it('gir ROM-cue når armene ikke strekkes helt ut i bunn', () => {
		const a = new PullupAnalyzer();
		const { completed, cues } = feed(a, buildRep(0, { chin: true, fullExt: false }));
		expect(completed[0].fullExtension).toBe(false);
		expect(cues.some((c) => c.includes('Strekk armene'))).toBe(true);
	});

	it('gir tempo-cue ved for rask konsentrisk fase', () => {
		const a = new PullupAnalyzer();
		const { completed, cues } = feed(a, buildRep(0, { fast: true }));
		expect(completed[0].concentricMs).toBeLessThan(400);
		expect(cues.some((c) => c.includes('kontroll'))).toBe(true);
	});

	it('sier fra når ingen person er i bildet', () => {
		const a = new PullupAnalyzer();
		let noPersonCue: string | null = null;
		for (let i = 0; i < 35; i++) {
			const fb = a.update({}, i * 33);
			if (fb.cueKind === 'no-person') noPersonCue = fb.cue;
		}
		expect(noPersonCue).not.toBeNull();
	});

	it('oppsummerer økten korrekt', () => {
		const a = new PullupAnalyzer();
		feed(a, buildRep(0, { chin: true, fullExt: true })); // ren
		feed(a, buildRep(2000, { chin: false, fullExt: true })); // mangler hake
		const s = a.summary();
		expect(s.reps).toBe(2);
		expect(s.chinOverBarReps).toBe(1);
		expect(s.fullExtensionReps).toBe(2);
		expect(s.cleanReps).toBe(1);
		expect(s.durationMs).toBeGreaterThan(0);
	});
});

describe('evaluateRepCue', () => {
	const base: RepRecord = {
		index: 1,
		chinOverBar: true,
		fullExtension: true,
		peakElbowAngle: 60,
		bottomElbowAngle: 170,
		concentricMs: 800,
		eccentricMs: 800
	};

	it('prioriterer hake foran alt annet', () => {
		expect(evaluateRepCue({ ...base, chinOverBar: false, fullExtension: false }).cueKind).toBe('chin');
	});
	it('så ROM', () => {
		expect(evaluateRepCue({ ...base, fullExtension: false }).cueKind).toBe('rom');
	});
	it('så tempo', () => {
		expect(evaluateRepCue({ ...base, concentricMs: 200 }).cueKind).toBe('tempo');
	});
	it('ellers form-ok', () => {
		expect(evaluateRepCue(base).cueKind).toBe('form-ok');
	});
});
