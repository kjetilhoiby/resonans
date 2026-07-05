import { describe, it, expect } from 'vitest';
import {
	bestWeekEqKm,
	computeEnduranceState,
	curveWeekKm,
	effortPerRunKm,
	nextEnduranceSession
} from './endurance-engine';
import type { EnduranceConfig, EnduranceGoal, EnduranceWorkout, TrackWindow } from './types';

const GOAL: EnduranceGoal = {
	ukesKm: { fra: 14, til: 22 },
	paceSekPerKm: { fra: 400, til: 330 }
};

const CONFIG: EnduranceConfig = { deloadHverNteUke: 4, maksIkkeLopAndel: 0.4 };

// 26 uker: 2026-07-06 (mandag) → 2027-01-04
const WINDOW: TrackWindow = { startDate: '2026-07-06', targetDate: '2027-01-04' };

function run(date: string, km: number, paceSekPerKm = 400): EnduranceWorkout {
	return {
		date,
		family: 'running',
		effortScore: (km * paceSekPerKm * 2.5) / 60,
		distanceMeters: km * 1000,
		durationSeconds: km * paceSekPerKm
	};
}

function sykkel(date: string, effortScore: number, family: 'cycling' | 'ebike' = 'cycling'): EnduranceWorkout {
	return { date, family, effortScore, distanceMeters: null, durationSeconds: null };
}

describe('curveWeekKm', () => {
	it('starter på 14 og ender på 22', () => {
		expect(curveWeekKm(GOAL, CONFIG, WINDOW, '2026-07-06').targetKm).toBe(14);
		expect(curveWeekKm(GOAL, CONFIG, WINDOW, '2027-01-04').targetKm).toBe(22);
	});

	it('hver 4. uke er deload med 80 % volum', () => {
		// Uke 4 starter 2026-07-27
		const { targetKm, deload } = curveWeekKm(GOAL, CONFIG, WINDOW, '2026-07-27');
		expect(deload).toBe(true);
		const base = 14 + (22 - 14) * (21 / 182);
		expect(targetKm).toBeCloseTo(base * 0.8, 1);
	});
});

describe('effortPerRunKm', () => {
	it('1 km i 6:40-pace koster ~16.7 effort', () => {
		expect(effortPerRunKm(400)).toBeCloseTo(16.67, 1);
	});
});

describe('computeEnduranceState', () => {
	it('summerer løpe-km denne uken og beregner gjenstående', () => {
		// Uke 1: mandag 2026-07-06, i dag torsdag 09.
		const state = computeEnduranceState(
			[run('2026-07-07', 5), run('2026-07-08', 4)],
			GOAL,
			CONFIG,
			WINDOW,
			'2026-07-09'
		);
		expect(state.week.runKm).toBe(9);
		expect(state.week.weekTargetKm).toBe(14);
		expect(state.week.remainingKm).toBe(5);
	});

	it('sykkel konverteres via effortScore og teller som eqKm', () => {
		// effort 50 i uke 1 (pace 400 → 16.7 per km) ≈ 3 eqKm
		const state = computeEnduranceState([sykkel('2026-07-07', 50)], GOAL, CONFIG, WINDOW, '2026-07-09');
		expect(state.week.eqKmNonRun).toBeCloseTo(3, 0.5);
		expect(state.week.runKm).toBe(0);
	});

	it('ikke-løp cappes til 40 % av uketarget', () => {
		// Massiv sykkeleffort (500 ≈ 30 eqKm) skal cappes til 0.4 × 14 = 5.6
		const state = computeEnduranceState([sykkel('2026-07-07', 500)], GOAL, CONFIG, WINDOW, '2026-07-09');
		expect(state.week.eqKmNonRun).toBeCloseTo(5.6, 1);
	});

	it('e-sykkel teller mindre enn vanlig sykkel for samme varighet (via effortScore)', () => {
		// Samme økt-varighet gir ebike lavere effortScore fra effort-service —
		// motoren konverterer bare score → eqKm, så lavere score = færre km.
		const cycling = computeEnduranceState([sykkel('2026-07-07', 85)], GOAL, CONFIG, WINDOW, '2026-07-09');
		const ebike = computeEnduranceState([sykkel('2026-07-07', 40, 'ebike')], GOAL, CONFIG, WINDOW, '2026-07-09');
		expect(ebike.week.eqKmNonRun).toBeLessThan(cycling.week.eqKmNonRun);
	});

	it('stall: forrige uke < 70 % av target rebaser uketarget til forrige × 1.1', () => {
		// Uke 2 (start 13.07): forrige uke hadde bare 4 km (< 70 % av 14)
		const state = computeEnduranceState([run('2026-07-08', 4)], GOAL, CONFIG, WINDOW, '2026-07-15');
		expect(state.week.stallRebased).toBe(true);
		expect(state.week.weekTargetKm).toBeCloseTo(4.4, 1);
	});

	it('ingen stall-rebase uten data forrige uke (ferie/oppstart)', () => {
		const state = computeEnduranceState([], GOAL, CONFIG, WINDOW, '2026-07-15');
		expect(state.week.stallRebased).toBe(false);
	});

	it('måler pace kun på løpeøkter siste 14 dager', () => {
		const state = computeEnduranceState(
			[run('2026-07-07', 5, 390), sykkel('2026-07-08', 100)],
			GOAL,
			CONFIG,
			WINDOW,
			'2026-07-09'
		);
		expect(state.sistePaceSekPerKm).toBe(390);
	});
});

describe('nextEnduranceSession', () => {
	it('foreslår hvile når uken er (nesten) i mål', () => {
		const state = computeEnduranceState(
			[run('2026-07-06', 7), run('2026-07-08', 7)],
			GOAL,
			CONFIG,
			WINDOW,
			'2026-07-09'
		);
		expect(state.week.remainingKm).toBe(0);
		expect(nextEnduranceSession(state, 4)).toBeNull();
	});

	it('foreslår easy-løp med gjenstående km, klampet til lengste × 1.15', () => {
		const state = computeEnduranceState([run('2026-07-07', 4)], GOAL, CONFIG, WINDOW, '2026-07-09');
		const session = nextEnduranceSession(state, 4)!;
		expect(session.kind).toBe('run');
		expect(session.plannedRun!.runType).toBe('easy');
		// gjenstående 10, men lengste løp er 4 → 4.6 km
		expect(session.plannedRun!.targetDistanceMeters).toBe(4600);
		expect(session.plannedRun!.paceHintSecPerKm).toBe(state.forventetPaceSekPerKm);
	});

	it('langtur-bias i helgen når det gjenstår nok', () => {
		const state = computeEnduranceState([run('2026-07-07', 6)], GOAL, CONFIG, WINDOW, '2026-07-11');
		const session = nextEnduranceSession(state, 6)!;
		expect(session.plannedRun!.runType).toBe('long');
	});

	it('minst 3 km selv når lite gjenstår', () => {
		const state = computeEnduranceState(
			[run('2026-07-06', 6), run('2026-07-07', 6)],
			GOAL,
			CONFIG,
			WINDOW,
			'2026-07-09'
		);
		expect(state.week.remainingKm).toBe(2);
		const session = nextEnduranceSession(state, 4)!;
		expect(session.plannedRun!.targetDistanceMeters).toBeGreaterThanOrEqual(3000);
	});
});

describe('bestWeekEqKm', () => {
	it('finner beste ukes-total på tvers av uker', () => {
		const workouts = [
			run('2026-07-07', 5),
			run('2026-07-09', 6),
			run('2026-07-14', 8),
			run('2026-07-16', 9)
		];
		expect(bestWeekEqKm(workouts, GOAL, CONFIG, WINDOW)).toBe(17);
	});
});
