import { describe, it, expect } from 'vitest';
import {
	basalMetabolicRate,
	DESK_JOB_FACTOR,
	estimateDailyExpenditure,
	estimateWorkoutKcal,
	MET_VALUES,
	runningMet,
	UNKNOWN_MET
} from './energy-expenditure';

/** «Mann 42 med kontorjobb», med en antatt høyde til testformål. */
const PROFILE = { weightKg: 88, heightCm: 183, ageYears: 42, sex: 'male' as const };

describe('basalMetabolicRate', () => {
	it('regner Mifflin-St Jeor for en mann', () => {
		// 10·88 + 6,25·183 − 5·42 + 5 = 880 + 1143,75 − 210 + 5 = 1 818,75
		expect(basalMetabolicRate(PROFILE)).toBe(1819);
	});

	it('bruker kvinnekonstanten når kjønn er kvinne', () => {
		// Samme kropp, 166 kcal lavere: +5 mot −161.
		expect(basalMetabolicRate({ ...PROFILE, sex: 'female' })).toBe(1653);
	});

	it('gir null framfor å gjette på manglende profil', () => {
		// Et forbrukstall bygget på antatt kroppshøyde ser like troverdig ut som et
		// ekte, og det er nettopp problemet.
		expect(basalMetabolicRate({ weightKg: 88, ageYears: 42, sex: 'male' })).toBeNull();
		expect(basalMetabolicRate({ weightKg: 88, heightCm: 183, sex: 'male' })).toBeNull();
		expect(basalMetabolicRate({ weightKg: 88, heightCm: 183, ageYears: 42 })).toBeNull();
		expect(basalMetabolicRate({})).toBeNull();
	});

	it('avviser urimelige verdier', () => {
		expect(basalMetabolicRate({ ...PROFILE, weightKg: 12 })).toBeNull();
		expect(basalMetabolicRate({ ...PROFILE, heightCm: 40 })).toBeNull();
		expect(basalMetabolicRate({ ...PROFILE, ageYears: 3 })).toBeNull();
		expect(basalMetabolicRate({ ...PROFILE, sex: 'annet' as never })).toBeNull();
	});
});

describe('runningMet', () => {
	it('skalerer med farten', () => {
		// 10 km/h ≈ 10,5 MET, 14 km/h ≈ 14,3. En fast verdi ville bommet på begge.
		expect(runningMet(10)).toBeCloseTo(10.5, 1);
		expect(runningMet(14)).toBeCloseTo(14.3, 1);
		expect(runningMet(14) - runningMet(10)).toBeGreaterThan(3);
	});

	it('faller tilbake på ukjent for tull', () => {
		expect(runningMet(0)).toBe(UNKNOWN_MET);
		expect(runningMet(-5)).toBe(UNKNOWN_MET);
		expect(runningMet(Number.NaN)).toBe(UNKNOWN_MET);
	});
});

describe('estimateWorkoutKcal', () => {
	it('gir el-sykkelturen et rimelig tall der Withings ga 1 460', () => {
		// De to turene 3. august: 1 617 s og 1 477 s, altså 52 minutter til sammen.
		const first = estimateWorkoutKcal({ sportType: 'e_bike', durationSeconds: 1617 }, 88)!;
		const second = estimateWorkoutKcal({ sportType: 'e_bike', durationSeconds: 1477 }, 88)!;
		const total = first.kcal + second.kcal;
		// 3,5 netto MET · 3,5 · 88 / 200 = 5,39 kcal/min · 52 min ≈ 280.
		expect(total).toBeGreaterThan(230);
		expect(total).toBeLessThan(330);
		// Withings' dagsfelt sa 1 460 for de samme minuttene.
		expect(total).toBeLessThan(1460 / 4);
	});

	it('trekker fra hvilestoffskiftet i de samme minuttene', () => {
		// Brutto ville vært MET · 3,5 · kg / 200. Netto bruker (MET − 1), som på en
		// time er ~92 kcal mindre for 88 kg — hvilen som alt er dekket av døgnforbruket.
		const hour = estimateWorkoutKcal({ sportType: 'cycling', durationSeconds: 3600 }, 88)!;
		const gross = ((MET_VALUES.cycling * 3.5 * 88) / 200) * 60;
		// Differansen er nøyaktig én MET i en time: 1 · 3,5 · 88 / 200 · 60 = 92,4.
		const oneMetHour = ((1 * 3.5 * 88) / 200) * 60;
		expect(gross - hour.kcal).toBeCloseTo(oneMetHour, 0);
	});

	it('utleder løpe-MET fra distanse og tid', () => {
		// 5 km på 25 minutter er 12 km/h.
		const run = estimateWorkoutKcal(
			{ sportType: 'running', durationSeconds: 1500, distanceMeters: 5000 },
			88
		)!;
		expect(run.met).toBeCloseTo(12.4, 1);
		expect(run.kcal).toBeGreaterThan(400);
	});

	it('faller tilbake på ukjent MET uten distanse på et løp', () => {
		const run = estimateWorkoutKcal({ sportType: 'running', durationSeconds: 1800 }, 88)!;
		expect(run.met).toBe(UNKNOWN_MET);
	});

	it('kjenner igjen idretten uansett skrivemåte', () => {
		expect(estimateWorkoutKcal({ sportType: 'E_BIKE', durationSeconds: 600 }, 88)!.met).toBe(4.5);
		expect(estimateWorkoutKcal({ sportType: 'trail_running', durationSeconds: 600 }, 88)!.met).toBe(
			UNKNOWN_MET
		);
	});

	it('gir null uten varighet', () => {
		expect(estimateWorkoutKcal({ sportType: 'yoga', durationSeconds: null }, 88)).toBeNull();
		expect(estimateWorkoutKcal({ sportType: 'yoga', durationSeconds: 0 }, 88)).toBeNull();
		expect(estimateWorkoutKcal({ sportType: 'yoga', durationSeconds: 600 }, 0)).toBeNull();
	});
});

describe('estimateDailyExpenditure', () => {
	it('regner 3. august fra bunnen av', () => {
		// Dagen som startet hele spørsmålet: to el-sykkelturer og fem minutter yoga.
		const estimate = estimateDailyExpenditure({
			profile: PROFILE,
			workouts: [
				{ sportType: 'e_bike', durationSeconds: 1617 },
				{ sportType: 'e_bike', durationSeconds: 1477 },
				{ sportType: 'yoga', durationSeconds: 324 }
			]
		})!;
		expect(estimate.basalKcal).toBe(1819);
		expect(estimate.baselineKcal).toBe(Math.round(1819 * DESK_JOB_FACTOR));
		expect(estimate.workoutKcal).toBeGreaterThan(230);
		expect(estimate.workoutKcal).toBeLessThan(330);
		// Withings oppga 2 763, og senere 3 168, for samme dag.
		expect(estimate.totalKcal).toBeGreaterThan(2400);
		expect(estimate.totalKcal).toBeLessThan(2600);
	});

	it('bruker en lav faktor, så øktene ikke telles to ganger', () => {
		// 1,25 og ikke 1,55: standardfaktorene dekker trening, og vi legger den på
		// toppen selv.
		expect(DESK_JOB_FACTOR).toBeLessThan(1.4);
		const noWorkouts = estimateDailyExpenditure({ profile: PROFILE, workouts: [] })!;
		expect(noWorkouts.workoutKcal).toBe(0);
		expect(noWorkouts.totalKcal).toBe(noWorkouts.baselineKcal);
	});

	it('lister øktene, så tallet kan etterprøves', () => {
		const estimate = estimateDailyExpenditure({
			profile: PROFILE,
			workouts: [{ sportType: 'hiking', durationSeconds: 7200 }]
		})!;
		expect(estimate.workouts).toHaveLength(1);
		expect(estimate.workouts[0]).toMatchObject({ sportType: 'hiking', minutes: 120, met: 6 });
	});

	it('hopper over økter uten varighet framfor å forkaste dagen', () => {
		const estimate = estimateDailyExpenditure({
			profile: PROFILE,
			workouts: [
				{ sportType: 'e_bike', durationSeconds: 1800 },
				{ sportType: 'yoga', durationSeconds: null }
			]
		})!;
		expect(estimate.workouts).toHaveLength(1);
	});

	it('gir null når profilen mangler', () => {
		expect(estimateDailyExpenditure({ profile: { weightKg: 88 }, workouts: [] })).toBeNull();
	});
});

describe('bevegelsestid i forbruksanslaget', () => {
	it('priser den glemte sporingen som de minuttene som faktisk var i bevegelse', () => {
		const glemt = estimateWorkoutKcal(
			{ sportType: 'e_bike', durationSeconds: 8400, movingSeconds: 1620 },
			88
		)!;
		const ren = estimateWorkoutKcal({ sportType: 'e_bike', durationSeconds: 1620 }, 88)!;

		expect(glemt.kcal).toBe(ren.kcal);
		expect(glemt.minutes).toBe(ren.minutes);
	});

	it('bruker elapsed når bevegelsestid mangler', () => {
		const uten = estimateWorkoutKcal({ sportType: 'e_bike', durationSeconds: 8400 }, 88)!;
		const nullet = estimateWorkoutKcal(
			{ sportType: 'e_bike', durationSeconds: 8400, movingSeconds: null },
			88
		)!;

		expect(nullet.kcal).toBe(uten.kcal);
	});

	it('utleder løpefarten av bevegelsestiden, ikke av opptaket', () => {
		// 5 km på 25 minutter er 12 km/t. Ble farten regnet på elapsed, ville
		// den blitt 2,1 km/t — og MET-en falt til en spasertur.
		const medStopp = estimateWorkoutKcal(
			{ sportType: 'running', durationSeconds: 8400, movingSeconds: 1500, distanceMeters: 5000 },
			88
		)!;
		const utenStopp = estimateWorkoutKcal(
			{ sportType: 'running', durationSeconds: 1500, distanceMeters: 5000 },
			88
		)!;

		expect(medStopp.met).toBe(utenStopp.met);
		expect(medStopp.kcal).toBe(utenStopp.kcal);
	});
});
