import { describe, it, expect } from 'vitest';
import {
	bestStrengthMetrics,
	computeStrengthState,
	distributeReps,
	nextStrengthSession,
	summarizeStrengthSession
} from './strength-engine';
import type { StrengthGoal, StrengthSessionActual, TrackWindow } from './types';

const GOAL: StrengthGoal = {
	armhevinger: { fra: 10, til: 100 },
	planke: { fraSek: 30, tilSek: 60 }
};

// 26 uker: 2026-07-06 → 2027-01-04
const WINDOW: TrackWindow = { startDate: '2026-07-06', targetDate: '2027-01-04' };

function okt(
	date: string,
	armReps: number[],
	plankeSek: number[] = [],
	negativSek: number[] = [],
	pullupReps: number[] = []
): StrengthSessionActual {
	return {
		date,
		exercises: [
			{ name: 'Armhevinger', sets: armReps.map((reps) => ({ reps })) },
			{ name: 'Planke', sets: plankeSek.map((durationSeconds) => ({ durationSeconds })) },
			{ name: 'Sakte senking fra pullup-stang', sets: negativSek.map((durationSeconds) => ({ durationSeconds })) },
			{ name: 'Pull-ups', sets: pullupReps.map((reps) => ({ reps })) }
		]
	};
}

describe('summarizeStrengthSession', () => {
	it('summerer armhevinger totalt og tar beste planke-hold', () => {
		const s = summarizeStrengthSession(okt('2026-07-08', [10, 8, 7], [30, 35, 28]));
		expect(s.armhevingerTotal).toBe(25);
		expect(s.plankeBestSeconds).toBe(35);
	});

	it('gjenkjenner øvelser uavhengig av casing og varianter', () => {
		const s = summarizeStrengthSession({
			date: '2026-07-08',
			exercises: [
				{ name: 'ARMHEVINGER', sets: [{ reps: 12 }] },
				{ name: 'Plank', sets: [{ durationSeconds: 40 }] },
				{ name: 'Negativ pull-up', sets: [{ durationSeconds: 12 }] }
			]
		});
		expect(s.armhevingerTotal).toBe(12);
		expect(s.plankeBestSeconds).toBe(40);
		expect(s.pullupNegativBestSeconds).toBe(12);
	});

	it('skiller strikte pull-ups fra negativer', () => {
		const s = summarizeStrengthSession(okt('2026-07-08', [], [], [10, 10, 10], [1]));
		expect(s.pullupNegativBestSeconds).toBe(10);
		expect(s.pullupNegativSets).toBe(3);
		expect(s.pullupReps).toBe(1);
	});
});

describe('computeStrengthState', () => {
	it('setter target fra kurven når ingen økter finnes', () => {
		const state = computeStrengthState([], GOAL, WINDOW, '2026-07-06');
		expect(state.armhevinger.nesteTarget).toBe(10);
		expect(state.planke.nesteTargetSek).toBe(30);
		expect(state.pullup.fase).toBe('negativer');
		expect(state.pullup.nesteTarget.negativSek).toBe(10);
	});

	it('progresjon: neste target er beste av siste 2 + 3 når det slår kurven', () => {
		const sessions = [okt('2026-07-08', [10, 9, 8], [30]), okt('2026-07-11', [12, 10, 8], [32])];
		const state = computeStrengthState(sessions, GOAL, WINDOW, '2026-07-13');
		// besteAvSiste2 = 30 → 33, kurven er ~13 etter én uke
		expect(state.armhevinger.nesteTarget).toBe(33);
		expect(state.planke.nesteTargetSek).toBe(37);
	});

	it('kurven vinner når faktiske økter ligger bak forventet', () => {
		// Halvveis i løpet (uke 13, ~2026-10-05) er forventet ~55 reps
		const sessions = [okt('2026-09-28', [15, 12, 10]), okt('2026-10-01', [16, 13, 11])];
		const state = computeStrengthState(sessions, GOAL, WINDOW, '2026-10-05');
		expect(state.armhevinger.forventet).toBeGreaterThan(50);
		// Men to økter på rad godt under 90 % av kurven → stall-rebase
		expect(state.armhevinger.stall).toBe(true);
		expect(state.armhevinger.nesteTarget).toBe(Math.round(0.9 * 40));
	});

	it('capper target på målet (100 reps / 60 s)', () => {
		const sessions = [okt('2026-12-28', [40, 35, 30], [58]), okt('2026-12-30', [40, 35, 33], [60])];
		const state = computeStrengthState(sessions, GOAL, WINDOW, '2027-01-02');
		expect(state.armhevinger.nesteTarget).toBeLessThanOrEqual(100);
		expect(state.planke.nesteTargetSek).toBe(60);
	});

	it('pull-up: negativer +2 s per økt, capped på 20 s', () => {
		const sessions = [okt('2026-07-08', [], [], [10, 10, 10]), okt('2026-07-11', [], [], [12, 12, 11])];
		const state = computeStrengthState(sessions, GOAL, WINDOW, '2026-07-13');
		expect(state.pullup.fase).toBe('negativer');
		expect(state.pullup.nesteTarget.negativSek).toBe(14);
	});

	it('pull-up: bytter til strikte-fasen etter 3×20 s negativer', () => {
		const sessions = [okt('2026-09-01', [], [], [20, 20, 20])];
		const state = computeStrengthState(sessions, GOAL, WINDOW, '2026-09-03');
		expect(state.pullup.fase).toBe('strikte');
		expect(state.pullup.nesteTarget.reps).toBe(1);
	});

	it('pull-up: strikte reps progresjon mot 3', () => {
		const sessions = [okt('2026-10-01', [], [], [], [1]), okt('2026-10-05', [], [], [], [2])];
		const state = computeStrengthState(sessions, GOAL, WINDOW, '2026-10-07');
		expect(state.pullup.fase).toBe('strikte');
		expect(state.pullup.nesteTarget.reps).toBe(3);
	});
});

describe('nextStrengthSession', () => {
	it('bygger DTO-kompatibel økt med de tre øvelsene', () => {
		const state = computeStrengthState([okt('2026-07-08', [10, 8, 7], [30], [10, 10, 10])], GOAL, WINDOW, '2026-07-10');
		const session = nextStrengthSession(state);
		expect(session.kind).toBe('strength');
		expect(session.plannedExercises).toHaveLength(3);
		const [arm, pullup, planke] = session.plannedExercises!;
		expect(arm.exerciseName).toBe('Armhevinger');
		expect(arm.sets * (arm.repsTarget ?? 0)).toBeGreaterThanOrEqual(state.armhevinger.nesteTarget);
		expect(pullup.exerciseName).toBe('Sakte senking fra pullup-stang');
		expect(planke.exerciseName).toBe('Planke');
		expect(planke.durationSecondsTarget).toBe(state.planke.nesteTargetSek);
	});
});

describe('distributeReps', () => {
	it('fordeler totalen på 3–8 sett med maks ~25 per sett', () => {
		expect(distributeReps(10)).toEqual({ sets: 3, repsPerSet: 4 });
		expect(distributeReps(60)).toEqual({ sets: 3, repsPerSet: 20 });
		expect(distributeReps(100)).toEqual({ sets: 4, repsPerSet: 25 });
	});
});

describe('bestStrengthMetrics', () => {
	it('finner beste verdi per metric, med 3-sett-krav for negativer', () => {
		const sessions = [
			okt('2026-07-08', [10, 8], [35], [15, 14]), // bare 2 negativ-sett → teller ikke
			okt('2026-07-11', [12, 10, 9], [40], [12, 12, 12])
		];
		const best = bestStrengthMetrics(sessions);
		expect(best.armhevinger_total).toBe(31);
		expect(best.planke_sekunder).toBe(40);
		expect(best.pullup_negativ_sek).toBe(12);
	});
});
