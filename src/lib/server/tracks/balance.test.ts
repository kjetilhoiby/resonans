import { describe, it, expect } from 'vitest';
import { classifyIntensity, computeBalanceState } from './balance';
import type { EnduranceWorkout } from './types';

/** Bygger en økt med defaults — kun det testen bryr seg om settes. */
function w(partial: Partial<EnduranceWorkout> & { date: string; family: string }): EnduranceWorkout {
	return {
		effortScore: 100,
		distanceMeters: null,
		durationSeconds: null,
		...partial
	};
}

const TODAY = '2026-07-07'; // tirsdag → uka starter mandag 2026-07-06

describe('classifyIntensity', () => {
	it('klassifiserer pace mot easy-pace i soner', () => {
		expect(classifyIntensity(400, 400)).toBe('rolig'); // lik easy
		expect(classifyIntensity(360, 400)).toBe('moderat'); // 0.9 × easy
		expect(classifyIntensity(330, 400)).toBe('hard'); // 0.825 × easy
	});

	it('faller tilbake til moderat ved ugyldig pace', () => {
		expect(classifyIntensity(0, 400)).toBe('moderat');
		expect(classifyIntensity(400, 0)).toBe('moderat');
	});
});

describe('computeBalanceState — disiplin-miks', () => {
	it('summerer effort per family og regner andel', () => {
		const workouts = [
			w({ date: '2026-07-06', family: 'running', effortScore: 150 }),
			w({ date: '2026-07-04', family: 'cycling', effortScore: 50 }),
			w({ date: '2026-07-02', family: 'running', effortScore: 100 })
		];
		const state = computeBalanceState(workouts, [], 400, TODAY);
		expect(state.totalEffort).toBe(300);
		expect(state.disciplines[0]).toMatchObject({ family: 'running', effort: 250, sessions: 2, pct: 83 });
		expect(state.disciplines[1]).toMatchObject({ family: 'cycling', effort: 50, pct: 17 });
	});

	it('ser bort fra økter utenfor 4-ukersvinduet', () => {
		const workouts = [
			w({ date: '2026-07-06', family: 'running', effortScore: 100 }),
			w({ date: '2026-05-01', family: 'cycling', effortScore: 500 }) // > 4 uker siden
		];
		const state = computeBalanceState(workouts, [], 400, TODAY);
		expect(state.totalEffort).toBe(100);
		expect(state.disciplines).toHaveLength(1);
	});
});

describe('computeBalanceState — styrke-dekning', () => {
	it('nudger til styrke når uka har løp men ingen styrke', () => {
		const workouts = [
			w({ date: '2026-07-06', family: 'running', effortScore: 120 }),
			w({ date: '2026-07-07', family: 'running', effortScore: 120 })
		];
		const state = computeBalanceState(workouts, [], 400, TODAY);
		expect(state.strengthSessionsThisWeek).toBe(0);
		expect(state.runSessionsThisWeek).toBe(2);
		expect(state.nudge?.kind).toBe('styrke');
	});

	it('teller styrke fra både sensor_events-datoer og canonical strength-family', () => {
		const workouts = [
			w({ date: '2026-07-06', family: 'running', effortScore: 120 }),
			w({ date: '2026-07-07', family: 'strength', effortScore: 60 })
		];
		const state = computeBalanceState(workouts, ['2026-07-06'], 400, TODAY);
		expect(state.strengthSessionsThisWeek).toBe(2); // én fra hver kilde, ulike dager
		expect(state.nudge?.kind).not.toBe('styrke');
	});
});

describe('computeBalanceState — konsentrasjon', () => {
	it('nudger når én disiplin dominerer og det finnes alternativ', () => {
		// Styrke er dekket (så styrke-nudgen ikke vinner), men sykkel dominerer effort.
		const workouts = [
			w({ date: '2026-06-15', family: 'cycling', effortScore: 400 }),
			w({ date: '2026-06-20', family: 'cycling', effortScore: 400 }),
			w({ date: '2026-07-06', family: 'running', effortScore: 60 }),
			w({ date: '2026-07-07', family: 'strength', effortScore: 60 })
		];
		const state = computeBalanceState(workouts, [], 400, TODAY);
		expect(state.disciplines[0].family).toBe('cycling');
		expect(state.nudge?.kind).toBe('konsentrasjon');
		expect(state.nudge?.message).toContain('sykkel');
	});
});

describe('computeBalanceState — intensitet', () => {
	it('nudger når nesten alle løp er i moderat sone', () => {
		// easy-pace 400; moderat ≈ 360. Fire moderate løp + nok sykkel til at løp
		// ikke dominerer effort (konsentrasjon skal ikke vinne), styrke dekket.
		const workouts = [
			w({ date: '2026-06-16', family: 'running', effortScore: 100, distanceMeters: 8000, durationSeconds: 8000 * 360 / 1000 }),
			w({ date: '2026-06-19', family: 'running', effortScore: 100, distanceMeters: 8000, durationSeconds: 8000 * 360 / 1000 }),
			w({ date: '2026-06-23', family: 'running', effortScore: 100, distanceMeters: 8000, durationSeconds: 8000 * 360 / 1000 }),
			w({ date: '2026-07-06', family: 'running', effortScore: 100, distanceMeters: 8000, durationSeconds: 8000 * 360 / 1000 }),
			w({ date: '2026-06-18', family: 'cycling', effortScore: 250 }),
			w({ date: '2026-07-07', family: 'strength', effortScore: 60 })
		];
		const state = computeBalanceState(workouts, ['2026-07-06'], 400, TODAY);
		expect(state.intensity).not.toBeNull();
		expect(state.intensity!.moderat).toBeGreaterThanOrEqual(80);
		expect(state.nudge?.kind).toBe('intensitet');
	});

	it('gir null intensitet ved for få løp eller manglende easy-pace', () => {
		const workouts = [
			w({ date: '2026-07-06', family: 'running', effortScore: 100, distanceMeters: 8000, durationSeconds: 2880 })
		];
		expect(computeBalanceState(workouts, [], 400, TODAY).intensity).toBeNull();
		expect(computeBalanceState(workouts, [], null, TODAY).intensity).toBeNull();
	});
});

describe('computeBalanceState — score og tom tilstand', () => {
	it('gir 0 i score og ingen nudge uten data', () => {
		const state = computeBalanceState([], [], 400, TODAY);
		expect(state.score).toBe(0);
		expect(state.nudge).toBeNull();
		expect(state.disciplines).toHaveLength(0);
	});

	it('gir høy score for en balansert, variert uke', () => {
		const workouts = [
			w({ date: '2026-07-06', family: 'running', effortScore: 120, distanceMeters: 8000, durationSeconds: 8000 * 400 / 1000 }),
			w({ date: '2026-07-04', family: 'running', effortScore: 120, distanceMeters: 6000, durationSeconds: 6000 * 340 / 1000 }),
			w({ date: '2026-07-02', family: 'running', effortScore: 120, distanceMeters: 8000, durationSeconds: 8000 * 360 / 1000 }),
			w({ date: '2026-07-05', family: 'cycling', effortScore: 120 }),
			w({ date: '2026-07-07', family: 'strength', effortScore: 100 }),
			w({ date: '2026-07-01', family: 'strength', effortScore: 100 })
		];
		const state = computeBalanceState(workouts, ['2026-07-07', '2026-07-01'], 400, TODAY);
		expect(state.score).toBeGreaterThan(60);
		expect(state.nudge).toBeNull();
	});
});
