import { describe, expect, it } from 'vitest';
import { angle } from './geometry';
import { PullupAnalyzer } from './pullup-analyzer';
import { buildCoachContext } from './session-summary';
import type { FrameResult, PoseFrame } from './types';

/**
 * Bygg en syntetisk frame med kjent albuevinkel og nese-høyde.
 *
 * Begge armer får samme vinkel (snitt = angleDeg). Håndledd ligger på y=0.2
 * (⇒ barY=0.2), så `noseY ≤ 0.22` gir hake over stang. Albuen ligger rett
 * over håndleddet; skulderen plasseres så vinkelen ved albuen blir `angleDeg`.
 * 180° = strak arm (bunn), ~90° = topp.
 */
function frame(angleDeg: number, noseY: number, score = 0.9): PoseFrame {
	const rad = (angleDeg * Math.PI) / 180;
	const L = 0.2;
	const arm = (wx: number) => ({
		wrist: { x: wx, y: 0.2, score },
		elbow: { x: wx, y: 0.0, score },
		// E→W = (0, +0.2) (nedover). E→S rotert `angleDeg` fra den ⇒ vinkel = angleDeg.
		shoulder: { x: wx + L * Math.sin(rad), y: L * Math.cos(rad), score }
	});
	const l = arm(0.4);
	const r = arm(0.6);
	return {
		nose: { x: 0.5, y: noseY, score },
		leftShoulder: l.shoulder,
		leftElbow: l.elbow,
		leftWrist: l.wrist,
		rightShoulder: r.shoulder,
		rightElbow: r.elbow,
		rightWrist: r.wrist
	};
}

/** Mat en sekvens av [vinkel, noseY] med 500 ms mellom hver frame. */
function run(seq: Array<[number, number]>, stepMs = 500): FrameResult[] {
	const a = new PullupAnalyzer();
	return seq.map(([deg, noseY], i) => a.push(frame(deg, noseY), i * stepMs));
}

describe('angle() geometri', () => {
	it('gir 180° for en strak linje', () => {
		const a = { x: 0, y: 0, score: 1 };
		const b = { x: 1, y: 0, score: 1 };
		const c = { x: 2, y: 0, score: 1 };
		expect(angle(a, b, c)).toBeCloseTo(180, 5);
	});

	it('gir 90° for en rett vinkel', () => {
		const a = { x: 0, y: 1, score: 1 };
		const b = { x: 0, y: 0, score: 1 };
		const c = { x: 1, y: 0, score: 1 };
		expect(angle(a, b, c)).toBeCloseTo(90, 5);
	});

	it('returnerer null for degenerert (sammenfallende punkter)', () => {
		const b = { x: 0.5, y: 0.5, score: 1 };
		expect(angle(b, b, { x: 1, y: 1, score: 1 })).toBeNull();
	});

	it('er refleksjons-invariant (y-flippet frame gir samme vinkel)', () => {
		const a = { x: 0.5, y: 0.0, score: 1 };
		const b = { x: 0.5, y: 0.2, score: 1 };
		const c = { x: 0.7, y: 0.35, score: 1 };
		const flip = (p: typeof a) => ({ ...p, y: 1 - p.y });
		expect(angle(flip(a), flip(b), flip(c))).toBeCloseTo(angle(a, b, c)!, 5);
	});
});

describe('frame-hjelperen bygger riktige vinkler', () => {
	it('produserer den forespurte albuevinkelen', () => {
		const a = new PullupAnalyzer();
		expect(a.push(frame(170, 0.5), 0).elbowAngle).toBeCloseTo(170, 4);
		expect(a.push(frame(90, 0.5), 500).elbowAngle).toBeCloseTo(90, 4);
	});
});

describe('elbowAngle-utledning', () => {
	it('bruker den ene armen når bare én er synlig', () => {
		const a = new PullupAnalyzer();
		const f = frame(120, 0.5);
		delete f.rightShoulder;
		delete f.rightElbow;
		delete f.rightWrist;
		expect(a.push(f, 0).elbowAngle).toBeCloseTo(120, 4);
	});

	it('gir null når ingen arm når minScore', () => {
		const a = new PullupAnalyzer();
		expect(a.push(frame(120, 0.5, 0.1), 0).elbowAngle).toBeNull();
	});
});

describe('rep-telling og cues (testvektorer §7)', () => {
	it('ren rep: heng→dra→topp→senk→heng ⇒ reps=1, chin+full, cue form-ok', () => {
		const results = run([
			[170, 0.5],
			[120, 0.4],
			[90, 0.2],
			[120, 0.4],
			[170, 0.5]
		]);
		const done = results.find((r) => r.repCompleted)!;
		expect(done.reps).toBe(1);
		expect(done.repCompleted!.chinOverBar).toBe(true);
		expect(done.repCompleted!.fullExtension).toBe(true);
		expect(done.repCompleted!.peakElbowAngle).toBe(90);
		expect(done.repCompleted!.bottomElbowAngle).toBe(170);
		expect(done.cue!.kind).toBe('form-ok');
	});

	it('albue oscillerer 100°↔145° (aldri ≤95) ⇒ reps=0 (hysterese)', () => {
		const results = run([
			[100, 0.5],
			[145, 0.5],
			[100, 0.5],
			[145, 0.5],
			[100, 0.5]
		]);
		expect(results.at(-1)!.reps).toBe(0);
		expect(results.every((r) => r.repCompleted === null)).toBe(true);
	});

	it('flere topp-frames før retur til heng ⇒ reps=1 (ingen dobbelttelling)', () => {
		const results = run([
			[170, 0.5],
			[90, 0.2],
			[92, 0.2],
			[88, 0.2],
			[170, 0.5]
		]);
		expect(results.at(-1)!.reps).toBe(1);
		expect(results.filter((r) => r.repCompleted).length).toBe(1);
	});

	it('topp med nese høyt (aldri over stang) ⇒ cue chin, chinOverBar=false', () => {
		const results = run([
			[170, 0.5],
			[90, 0.5],
			[170, 0.5]
		]);
		const done = results.find((r) => r.repCompleted)!;
		expect(done.repCompleted!.chinOverBar).toBe(false);
		expect(done.cue!.kind).toBe('chin');
	});

	it('bunn når bare 152° (<160) ⇒ cue rom, fullExtension=false', () => {
		const results = run([
			[152, 0.5],
			[90, 0.2],
			[152, 0.5]
		]);
		const done = results.find((r) => r.repCompleted)!;
		expect(done.repCompleted!.fullExtension).toBe(false);
		expect(done.cue!.kind).toBe('rom');
	});

	it('kort konsentrisk fase (<400 ms) ⇒ cue tempo', () => {
		const a = new PullupAnalyzer();
		a.push(frame(170, 0.5), 0);
		a.push(frame(90, 0.2), 200); // hang → top, concentric = 200 ms
		const done = a.push(frame(170, 0.5), 400);
		expect(done.repCompleted!.concentricMs).toBe(200);
		expect(done.cue!.kind).toBe('tempo');
	});

	it('2 reps (én ren, én uten hake) ⇒ chinOverBarReps=1, cleanReps=1', () => {
		const results = run([
			[170, 0.5],
			[90, 0.2], // rep 1: hake
			[170, 0.5],
			[90, 0.5], // rep 2: ingen hake
			[170, 0.5]
		]);
		expect(results.at(-1)!.reps).toBe(2);
		const summary = new PullupAnalyzer();
		// bygg samme økt for oppsummering
		[
			[170, 0.5],
			[90, 0.2],
			[170, 0.5],
			[90, 0.5],
			[170, 0.5]
		].forEach(([deg, noseY], i) => summary.push(frame(deg as number, noseY as number), i * 500));
		const s = summary.buildSessionSummary();
		expect(s.reps).toBe(2);
		expect(s.chinOverBarReps).toBe(1);
		expect(s.cleanReps).toBe(1);
	});
});

describe('no-person-deteksjon (§3.6)', () => {
	it('sender no-person-cue én gang etter 30 tomme frames, så stille', () => {
		const a = new PullupAnalyzer();
		const cues: string[] = [];
		for (let i = 0; i < 40; i++) {
			const r = a.push({}, i * 33);
			if (r.cue) cues.push(r.cue.kind);
		}
		expect(cues).toEqual(['no-person']);
	});

	it('nullstiller telleren når en gyldig frame kommer', () => {
		const a = new PullupAnalyzer();
		for (let i = 0; i < 29; i++) a.push({}, i * 33);
		a.push(frame(170, 0.5), 29 * 33); // gyldig ⇒ reset
		let cued = false;
		for (let i = 0; i < 29; i++) {
			if (a.push({}, (30 + i) * 33).cue) cued = true;
		}
		expect(cued).toBe(false); // ikke nok tomme på rad etter reset
	});
});

describe('hake er klebrig innen en rep (§3.4)', () => {
	it('holder chinOverBar=true selv om nesa synker igjen før rep-slutt', () => {
		const results = run([
			[170, 0.5],
			[90, 0.2], // hake nådd
			[120, 0.6], // nesa synker igjen
			[170, 0.5]
		]);
		const done = results.find((r) => r.repCompleted)!;
		expect(done.repCompleted!.chinOverBar).toBe(true);
	});
});

describe('fase-utledning (UI)', () => {
	it('rapporterer hang, pulling, top og lowering', () => {
		const a = new PullupAnalyzer();
		expect(a.push(frame(170, 0.5), 0).phase).toBe('hang');
		expect(a.push(frame(120, 0.4), 100).phase).toBe('pulling');
		expect(a.push(frame(90, 0.2), 200).phase).toBe('top');
		expect(a.push(frame(120, 0.4), 300).phase).toBe('lowering');
	});
});

describe('buildSessionSummary + coach-kontekst (§6)', () => {
	it('aggregerer reps, snitt-tempo og varighet', () => {
		const a = new PullupAnalyzer();
		[
			[170, 0.5],
			[90, 0.2],
			[170, 0.5], // rep 1 ren
			[90, 0.5],
			[170, 0.5] // rep 2 uten hake
		].forEach(([deg, noseY], i) => a.push(frame(deg as number, noseY as number), i * 500));
		const s = a.buildSessionSummary();
		expect(s.reps).toBe(2);
		expect(s.chinOverBarReps).toBe(1);
		expect(s.fullExtensionReps).toBe(2);
		expect(s.cleanReps).toBe(1);
		expect(s.avgConcentricMs).toBeGreaterThan(0);
		expect(s.avgEccentricMs).toBeGreaterThan(0);
		expect(s.durationMs).toBe(2000);
	});

	it('gir null snitt når ingen reps har målt tempo', () => {
		const a = new PullupAnalyzer();
		const s = a.buildSessionSummary();
		expect(s.reps).toBe(0);
		expect(s.avgConcentricMs).toBeNull();
		expect(s.avgEccentricMs).toBeNull();
		expect(s.durationMs).toBe(0);
	});

	it('bygger norsk context-streng i spec-formatet', () => {
		const context = buildCoachContext({
			reps: 8,
			chinOverBarReps: 5,
			fullExtensionReps: 8,
			cleanReps: 5,
			avgConcentricMs: 1200,
			avgEccentricMs: 1800,
			durationMs: 60000
		});
		expect(context).toBe(
			[
				'Pull-up-økt:',
				'- Reps: 8',
				'- Hake over stang: 5 av 8',
				'- Full utstrekning i bunn: 8 av 8',
				'- Rene reps: 5 av 8',
				'- Snitt opp-fase: 1.2 s',
				'- Snitt ned-fase: 1.8 s'
			].join('\n')
		);
	});

	it('viser «–» for manglende snitt-tempo i context', () => {
		const context = buildCoachContext({
			reps: 0,
			chinOverBarReps: 0,
			fullExtensionReps: 0,
			cleanReps: 0,
			avgConcentricMs: null,
			avgEccentricMs: null,
			durationMs: 0
		});
		expect(context).toContain('- Snitt opp-fase: –');
		expect(context).toContain('- Snitt ned-fase: –');
	});
});
