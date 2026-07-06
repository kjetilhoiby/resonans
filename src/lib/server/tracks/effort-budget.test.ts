import { describe, it, expect } from 'vitest';
import {
	buildWeekPlanExamples,
	composeEffortSuggestion,
	computeEffortBudget,
	summarizeWeekSessions
} from './effort-budget';
import type { EnduranceConfig, EnduranceWorkout } from './types';

const CONFIG: EnduranceConfig = { deloadHverNteUke: 4 };
const PLAN_START = '2026-07-06'; // mandag, uke 1

function okt(date: string, effortScore: number, family = 'running'): EnduranceWorkout {
	return { date, family, effortScore, distanceMeters: null, durationSeconds: null };
}

describe('computeEffortBudget', () => {
	it('ankrer intervallet på forrige ukes faktiske effort: 200 → 200–240', () => {
		// Forrige uke (2026-07-06..12): 200 effort. Denne uken (fra 13.): i dag onsdag 15.
		const budget = computeEffortBudget(
			[okt('2026-07-07', 120), okt('2026-07-09', 80, 'cycling')],
			CONFIG,
			PLAN_START,
			'2026-07-15'
		);
		expect(budget.anchor).toBe('forrige_uke');
		expect(budget.bandMin).toBe(200);
		expect(budget.bandMax).toBe(240);
	});

	it('teller både løp, sykkel og el-sykkel — men ikke styrke', () => {
		const budget = computeEffortBudget(
			[
				okt('2026-07-07', 100),
				okt('2026-07-08', 60, 'cycling'),
				okt('2026-07-09', 40, 'ebike'),
				okt('2026-07-10', 500, 'strength')
			],
			CONFIG,
			PLAN_START,
			'2026-07-15'
		);
		expect(budget.bandMin).toBe(200);
	});

	it('trekker forbrukt effort fra intervallet — hard økt tar ned resten av uka', () => {
		// Forrige uke 200 → band 200–240. Planlagt ~160, men økta ble 320:
		const budget = computeEffortBudget(
			[okt('2026-07-07', 200), okt('2026-07-14', 320)],
			CONFIG,
			PLAN_START,
			'2026-07-15'
		);
		expect(budget.spentThisWeek).toBe(320);
		expect(budget.remainingMin).toBe(0);
		expect(budget.remainingMax).toBe(0); // uken er «brukt opp» → forslagene blir hvile
	});

	it('faller tilbake til 4-ukers snitt når forrige uke var tom', () => {
		// Aktivitet 3 uker tilbake (uke som starter 2026-06-22), ingenting forrige uke
		const budget = computeEffortBudget([okt('2026-06-24', 400)], CONFIG, PLAN_START, '2026-07-15');
		expect(budget.anchor).toBe('p4w_snitt');
		expect(budget.bandMin).toBe(100); // 400 / 4
	});

	it('bruker gulv ved helt tom historikk', () => {
		const budget = computeEffortBudget([], CONFIG, PLAN_START, '2026-07-15');
		expect(budget.anchor).toBe('gulv');
		expect(budget.bandMin).toBe(100);
		expect(budget.bandMax).toBe(120);
	});

	it('deload hver 4. uke skalerer intervallet med 0.8', () => {
		// Uke 4 av planen starter 2026-07-27. Forrige uke: 200 effort.
		const budget = computeEffortBudget([okt('2026-07-22', 200)], CONFIG, PLAN_START, '2026-07-29');
		expect(budget.deload).toBe(true);
		expect(budget.bandMin).toBe(160);
		expect(budget.bandMax).toBe(192);
	});

	it('anbefaler hvile når akutt belastning er høy mot kronisk', () => {
		// 30 dager med jevn trening (~20/dag), så 3 voldsomme dager
		const workouts: EnduranceWorkout[] = [];
		for (let i = 29; i >= 3; i--) {
			const d = new Date('2026-07-15T00:00:00Z');
			d.setUTCDate(d.getUTCDate() - i);
			workouts.push(okt(d.toISOString().slice(0, 10), 20));
		}
		workouts.push(okt('2026-07-13', 150), okt('2026-07-14', 150), okt('2026-07-15', 150));
		const budget = computeEffortBudget(workouts, CONFIG, PLAN_START, '2026-07-15');
		expect(budget.acuteChronicRatio).toBeGreaterThan(1.5);
		expect(budget.restRecommended).toBe(true);
	});

	it('gir ingen ratio (og ingen hvileanbefaling) ved under 14 dagers historikk', () => {
		const budget = computeEffortBudget(
			[okt('2026-07-13', 150), okt('2026-07-14', 150), okt('2026-07-15', 150)],
			CONFIG,
			PLAN_START,
			'2026-07-15'
		);
		expect(budget.acuteChronicRatio).toBeNull();
		expect(budget.restRecommended).toBe(false);
	});
});

describe('composeEffortSuggestion', () => {
	it('lite gjenstående → kun løp', () => {
		// midt i intervallet 60–80 = 70 → ~4 km @ 6:40
		const text = composeEffortSuggestion(60, 80, 400)!;
		expect(text).toContain('km løp');
		expect(text).not.toContain('sykkel');
	});

	it('mye gjenstående → løp + sykkel som til sammen treffer intervallet', () => {
		const text = composeEffortSuggestion(200, 240, 400)!;
		expect(text).toContain('km løp');
		expect(text).toContain('min sykkel');
		// Summen av effort-tallene i teksten skal ligge nær midten (220 ± 15 %)
		const efforts = [...text.matchAll(/~(\d+)/g)].map((m) => Number(m[1]));
		const total = efforts.reduce((a, b) => a + b, 0);
		expect(total).toBeGreaterThan(220 * 0.85);
		expect(total).toBeLessThan(220 * 1.15);
	});

	it('returnerer null når uken i praksis er i mål', () => {
		expect(composeEffortSuggestion(0, 10, 400)).toBeNull();
	});
});

describe('summarizeWeekSessions', () => {
	it('tar med denne ukas løp/sykkel-økter som segmenter, ikke forrige uke eller styrke', () => {
		// I dag onsdag 2026-07-15 (uke fra mandag 13.)
		const sessions = summarizeWeekSessions(
			[
				okt('2026-07-10', 100), // forrige uke
				okt('2026-07-13', 130),
				okt('2026-07-14', 60, 'cycling'),
				okt('2026-07-14', 500, 'strength'),
				okt('2026-07-15', 40, 'ebike')
			],
			'2026-07-15'
		);
		expect(sessions).toEqual([
			{ date: '2026-07-13', family: 'running', effort: 130 },
			{ date: '2026-07-14', family: 'cycling', effort: 60 },
			{ date: '2026-07-15', family: 'ebike', effort: 40 }
		]);
	});
});

describe('buildWeekPlanExamples', () => {
	it('regner økter om til effort og andel av ukas mål', () => {
		// Pace 400 sek/km, band 200–240 → mid 220
		const examples = buildWeekPlanExamples(400, 200, 240);
		const lop8 = examples.find((e) => e.label === 'Løp 8 km')!;
		// 8 × (400/60) × 2.5 ≈ 133 → 61 % av 220
		expect(lop8.effort).toBe(133);
		expect(lop8.pctOfBand).toBe(61);

		const elsykkel = examples.find((e) => e.label === 'El-sykkel 40 min')!;
		expect(elsykkel.effort).toBe(40);
		expect(elsykkel.pctOfBand).toBe(18);

		const sykkel = examples.find((e) => e.label === 'Sykkeltur 40 min')!;
		expect(sykkel.effort).toBe(85);
	});

	it('tåler tomt band uten å dele på null', () => {
		const examples = buildWeekPlanExamples(400, 0, 0);
		expect(examples.every((e) => Number.isFinite(e.pctOfBand))).toBe(true);
	});
});
