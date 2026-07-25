import { describe, it, expect } from 'vitest';
import {
	bestWeekRunKm,
	computeEnduranceState,
	curveWeekKm,
	describeEnduranceDay,
	effortPerRunKm,
	nextEnduranceSession
} from './endurance-engine';
import { fmtMinutter } from '$lib/util/duration';
import type { EnduranceConfig, EnduranceGoal, EnduranceWorkout, TrackWindow } from './types';

const GOAL: EnduranceGoal = {
	ukesKm: { fra: 14, til: 22 },
	paceSekPerKm: { fra: 400, til: 330 }
};

const CONFIG: EnduranceConfig = { deloadHverNteUke: 4 };

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
	return { date, family, effortScore, distanceMeters: 20000, durationSeconds: 3600 };
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
	it('summerer rene løpe-km denne uken og beregner gjenstående', () => {
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

	it('sykkel teller IKKE i km-regnskapet', () => {
		const state = computeEnduranceState(
			[run('2026-07-07', 5), sykkel('2026-07-08', 200)],
			GOAL,
			CONFIG,
			WINDOW,
			'2026-07-09'
		);
		expect(state.week.runKm).toBe(5);
		expect(state.week.remainingKm).toBe(9);
	});

	it('stall: forrige uke < 70 % av target rebaser uketarget (rene løpe-km)', () => {
		// Uke 2 (start 13.07): forrige uke hadde bare 4 løpe-km (< 70 % av 14)
		const state = computeEnduranceState([run('2026-07-08', 4)], GOAL, CONFIG, WINDOW, '2026-07-15');
		expect(state.week.stallRebased).toBe(true);
		expect(state.week.weekTargetKm).toBeCloseTo(4.4, 1);
	});

	it('sykkel forrige uke redder ikke km-stallen, men utløser den heller ikke alene', () => {
		// Forrige uke: kun sykkel → 0 løpe-km, men det VAR aktivitet → stall-rebase på løp
		const state = computeEnduranceState([sykkel('2026-07-08', 200)], GOAL, CONFIG, WINDOW, '2026-07-15');
		expect(state.week.stallRebased).toBe(true);
		// Gulv på 3 km så målet ikke kollapser til 0
		expect(state.week.weekTargetKm).toBe(3);
	});

	it('ingen stall-rebase uten data forrige uke (ferie/oppstart)', () => {
		const state = computeEnduranceState([], GOAL, CONFIG, WINDOW, '2026-07-15');
		expect(state.week.stallRebased).toBe(false);
	});

	it('gjenopptrapping: opphold > 14 dager siden siste løp → mål tilbake til baseline', () => {
		// Siste løp 25.07, i dag 15.08 → 21 dagers opphold. Kurven har klatret forbi 14.
		const state = computeEnduranceState([run('2026-07-25', 6)], GOAL, CONFIG, WINDOW, '2026-08-15');
		expect(state.week.comebackRebased).toBe(true);
		expect(state.week.stallRebased).toBe(false);
		expect(state.week.weekTargetKm).toBe(14); // min(kurve, goal.fra)
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

describe('isCountableRun / pace-filter', () => {
	it('gangfart-registrering klassifisert som løp teller IKKE i løpe-km', () => {
		// «Løp» 4,7 km @ 10:34/km (634 sek/km) er gåtur — skal ikke telle
		const state = computeEnduranceState(
			[run('2026-07-07', 4.7, 634), run('2026-07-08', 5, 480)],
			GOAL,
			CONFIG,
			WINDOW,
			'2026-07-09'
		);
		expect(state.week.runKm).toBe(5);
	});

	it('gangfart-løp forurenser heller ikke pace-snittet', () => {
		const state = computeEnduranceState(
			[run('2026-07-07', 4.7, 634), run('2026-07-08', 8, 479)],
			GOAL,
			CONFIG,
			WINDOW,
			'2026-07-09'
		);
		expect(state.sistePaceSekPerKm).toBe(479);
	});

	it('bestWeekRunKm ignorerer gangfart-løp', () => {
		expect(bestWeekRunKm([run('2026-07-07', 10, 634), run('2026-07-08', 6, 400)])).toBe(6);
	});

	it('løp uten varighet teller på distanse (kan ikke pace-sjekkes)', () => {
		const noDuration: EnduranceWorkout = {
			date: '2026-07-07',
			family: 'running',
			effortScore: 50,
			distanceMeters: 5000,
			durationSeconds: null
		};
		expect(bestWeekRunKm([noDuration])).toBe(5);
	});
});

describe('describeEnduranceDay', () => {
	const beskriv = (workouts: EnduranceWorkout[]) => describeEnduranceDay(workouts, fmtMinutter);

	it('ekte løp navngis med distanse', () => {
		expect(beskriv([run('2026-07-08', 2.5, 496)])).toBe('Løp 2,5 km');
	});

	it('ren pendlerdag (el-sykkel) navngis med aktivitet — uten «Registrert:»-prefiks', () => {
		const dag = [sykkel('2026-07-07', 25, 'ebike'), sykkel('2026-07-07', 26, 'ebike')];
		expect(beskriv(dag)).toBe('El-sykkel 2 t');
	});

	it('løp + pendling samme dag: løpet leder, pendlinga henges på', () => {
		const dag = [run('2026-07-08', 2.5, 496), sykkel('2026-07-08', 25, 'ebike')];
		expect(beskriv(dag)).toBe('Løp 2,5 km + El-sykkel 1 t');
	});

	it('sykkel og el-sykkel navngis hver for seg', () => {
		const dag = [sykkel('2026-07-07', 40, 'cycling'), sykkel('2026-07-07', 20, 'ebike')];
		expect(beskriv(dag)).toBe('Sykkel 1 t + El-sykkel 1 t');
	});

	it('gangfart-autologg («løp» i 10:34/km) blir nøytral aktivitet, ikke «Løp»', () => {
		expect(beskriv([run('2026-07-07', 4.7, 634)])).toBe('Aktivitet 50 min');
	});

	it('løp uten distanse ennå (midt i synk) blir nøytral aktivitet — selvhelbredes senere', () => {
		const midtISynk: EnduranceWorkout = {
			date: '2026-07-08',
			family: 'running',
			effortScore: null,
			distanceMeters: null,
			durationSeconds: 1240
		};
		expect(beskriv([midtISynk])).toBe('Aktivitet 21 min');
	});

	it('tom dag faller tilbake til «Utholdenhet»', () => {
		expect(beskriv([])).toBe('Utholdenhet');
	});
});

describe('bestWeekRunKm', () => {
	it('finner beste ukes-total i rene løpe-km — sykkel ignoreres', () => {
		const workouts = [
			run('2026-07-07', 5),
			run('2026-07-09', 6),
			sykkel('2026-07-10', 300),
			run('2026-07-14', 8),
			run('2026-07-16', 9)
		];
		expect(bestWeekRunKm(workouts)).toBe(17);
	});
});
