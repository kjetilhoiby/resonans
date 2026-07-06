import { describe, it, expect } from 'vitest';
import { classifyEffortFamily, computeWorkoutEffort, type EffortBaseline, type WorkoutEffortInput } from './effort-service';

const baseline: EffortBaseline = { restHr: 55, maxHr: 190, derived: true };

describe('classifyEffortFamily', () => {
	it('gjenkjenner running-varianter', () => {
		expect(classifyEffortFamily('running', null)).toBe('running');
		expect(classifyEffortFamily('indoor_running', null)).toBe('running');
		expect(classifyEffortFamily('løp', null)).toBe('running');
		expect(classifyEffortFamily('løping', null)).toBe('running');
		expect(classifyEffortFamily('run', null)).toBe('running');
	});

	it('gjenkjenner cycling-varianter', () => {
		expect(classifyEffortFamily('cycling', null)).toBe('cycling');
		expect(classifyEffortFamily('sykkel', null)).toBe('cycling');
		expect(classifyEffortFamily('bike', null)).toBe('cycling');
	});

	it('skiller e-bike fra vanlig cycling', () => {
		expect(classifyEffortFamily('e_bike', null)).toBe('ebike');
		expect(classifyEffortFamily('e-bike', null)).toBe('ebike');
		expect(classifyEffortFamily('ebike_ride', null)).toBe('ebike');
	});

	it('gjenkjenner strength', () => {
		expect(classifyEffortFamily('strength_training', null)).toBe('strength');
		expect(classifyEffortFamily('styrke', null)).toBe('strength');
		expect(classifyEffortFamily('gym', null)).toBe('strength');
	});

	it('gjenkjenner yoga/pilates', () => {
		expect(classifyEffortFamily('yoga', null)).toBe('yoga');
		expect(classifyEffortFamily('pilates', null)).toBe('yoga');
		expect(classifyEffortFamily('mikroyoga', null)).toBe('yoga');
	});

	it('gjenkjenner walking og hiking', () => {
		expect(classifyEffortFamily('walking', null)).toBe('walking');
		expect(classifyEffortFamily('gåtur', null)).toBe('walking');
		expect(classifyEffortFamily('hiking', null)).toBe('hiking');
		expect(classifyEffortFamily('fjelltur', null)).toBe('hiking');
	});

	it('gjenkjenner swimming', () => {
		expect(classifyEffortFamily('swimming', null)).toBe('swimming');
		expect(classifyEffortFamily('svømming', null)).toBe('swimming');
	});

	it('bruker sportFamily som fallback', () => {
		expect(classifyEffortFamily('ukjent', 'running')).toBe('running');
		expect(classifyEffortFamily('', 'cycling')).toBe('cycling');
		expect(classifyEffortFamily(null, 'swimming')).toBe('swimming');
	});

	it('returnerer other for ukjente typer', () => {
		expect(classifyEffortFamily('padel', null)).toBe('other');
		expect(classifyEffortFamily(null, null)).toBe('other');
		expect(classifyEffortFamily('', '')).toBe('other');
	});

	it('er case-insensitive', () => {
		expect(classifyEffortFamily('RUNNING', null)).toBe('running');
		expect(classifyEffortFamily('E_Bike', null)).toBe('ebike');
	});

	it('trimmer whitespace', () => {
		expect(classifyEffortFamily('  running  ', null)).toBe('running');
	});
});

describe('computeWorkoutEffort', () => {
	it('returnerer null for for kort varighet (<5 min)', () => {
		const input: WorkoutEffortInput = { sportType: 'running', durationSeconds: 200, avgHeartRate: 150 };
		expect(computeWorkoutEffort(input, baseline)).toBeNull();
	});

	it('returnerer null for manglende varighet', () => {
		expect(computeWorkoutEffort({ sportType: 'running', durationSeconds: null }, baseline)).toBeNull();
		expect(computeWorkoutEffort({ sportType: 'running', durationSeconds: undefined }, baseline)).toBeNull();
	});

	it('bruker TRIMP når HR er tilgjengelig', () => {
		const input: WorkoutEffortInput = { sportType: 'running', durationSeconds: 3600, avgHeartRate: 155 };
		const result = computeWorkoutEffort(input, baseline);
		expect(result).not.toBeNull();
		expect(result!.method).toBe('trimp');
		expect(result!.family).toBe('running');
		expect(result!.score).toBeGreaterThan(0);
	});

	it('bruker MET når HR mangler', () => {
		const input: WorkoutEffortInput = { sportType: 'running', durationSeconds: 3600 };
		const result = computeWorkoutEffort(input, baseline);
		expect(result).not.toBeNull();
		expect(result!.method).toBe('met');
		expect(result!.score).toBeGreaterThan(0);
	});

	it('faller tilbake til MET når TRIMP er < 1 (veldig lav HR)', () => {
		const input: WorkoutEffortInput = { sportType: 'strength_training', durationSeconds: 1800, avgHeartRate: 60 };
		const result = computeWorkoutEffort(input, baseline);
		expect(result).not.toBeNull();
		expect(result!.method).toBe('met');
	});

	it('gir høyere score for løping enn yoga (MET-path)', () => {
		const running = computeWorkoutEffort({ sportType: 'running', durationSeconds: 3600 }, baseline);
		const yoga = computeWorkoutEffort({ sportType: 'yoga', durationSeconds: 3600 }, baseline);
		expect(running!.score).toBeGreaterThan(yoga!.score);
	});

	it('gir lavere score for e-bike enn vanlig sykkel (MET-path)', () => {
		const cycling = computeWorkoutEffort({ sportType: 'cycling', durationSeconds: 3600 }, baseline);
		const ebike = computeWorkoutEffort({ sportType: 'e_bike', durationSeconds: 3600 }, baseline);
		expect(cycling!.score).toBeGreaterThan(ebike!.score);
	});

	it('scorer runder til én desimal', () => {
		const result = computeWorkoutEffort({ sportType: 'running', durationSeconds: 3600, avgHeartRate: 150 }, baseline);
		const decimals = result!.score.toString().split('.')[1];
		expect(!decimals || decimals.length <= 1).toBe(true);
	});

	it('TRIMP-score øker med høyere HR', () => {
		const low = computeWorkoutEffort({ sportType: 'running', durationSeconds: 3600, avgHeartRate: 120 }, baseline);
		const high = computeWorkoutEffort({ sportType: 'running', durationSeconds: 3600, avgHeartRate: 170 }, baseline);
		expect(high!.score).toBeGreaterThan(low!.score);
	});

	it('TRIMP-score øker med lengre varighet', () => {
		const short = computeWorkoutEffort({ sportType: 'running', durationSeconds: 1800, avgHeartRate: 150 }, baseline);
		const long = computeWorkoutEffort({ sportType: 'running', durationSeconds: 7200, avgHeartRate: 150 }, baseline);
		expect(long!.score).toBeGreaterThan(short!.score);
	});

	it('inkluderer riktig family i resultatet', () => {
		expect(computeWorkoutEffort({ sportType: 'yoga', durationSeconds: 3600 }, baseline)!.family).toBe('yoga');
		expect(computeWorkoutEffort({ sportType: 'hiking', durationSeconds: 3600 }, baseline)!.family).toBe('hiking');
	});
});

describe('intensitets-justert MET for løp (met_pace)', () => {
	const paceBaseline: EffortBaseline = { ...baseline, easyPaceSecPerKm: 400 };

	it('terskeløkt koster mer enn rolig økt med samme varighet', () => {
		// 35 min rolig (400 s/km) vs 35 min hardt (330 s/km — 4×1000-terskeløkt)
		const rolig = computeWorkoutEffort(
			{ sportType: 'running', durationSeconds: 2100, paceSecPerKm: 400 },
			paceBaseline
		)!;
		const terskel = computeWorkoutEffort(
			{ sportType: 'running', durationSeconds: 2100, paceSecPerKm: 330 },
			paceBaseline
		)!;
		expect(rolig.method).toBe('met_pace');
		expect(rolig.score).toBeCloseTo(87.5, 0); // faktor 1.0 i egen easy-pace
		expect(terskel.method).toBe('met_pace');
		expect(terskel.score / rolig.score).toBeCloseTo((400 / 330) ** 2, 1); // ~1.47
	});

	it('gangfart-aktig løp vektes NED, klampet på 0.75', () => {
		const treg = computeWorkoutEffort(
			{ sportType: 'running', durationSeconds: 2100, paceSecPerKm: 634 },
			paceBaseline
		)!;
		expect(treg.score).toBeCloseTo(87.5 * 0.75, 0);
	});

	it('faktoren klampes oppad på 1.5', () => {
		const sprint = computeWorkoutEffort(
			{ sportType: 'running', durationSeconds: 2100, paceSecPerKm: 250 },
			paceBaseline
		)!;
		expect(sprint.score).toBeCloseTo(87.5 * 1.5, 0);
	});

	it('uten easy-pace-referanse: vanlig flat MET som før', () => {
		const result = computeWorkoutEffort(
			{ sportType: 'running', durationSeconds: 2100, paceSecPerKm: 330 },
			baseline
		)!;
		expect(result.method).toBe('met');
		expect(result.score).toBeCloseTo(87.5, 0);
	});

	it('sykkel påvirkes ikke av pace-justeringen', () => {
		const result = computeWorkoutEffort(
			{ sportType: 'cycling', durationSeconds: 2100, paceSecPerKm: 150 },
			paceBaseline
		)!;
		expect(result.method).toBe('met');
	});

	it('puls trumfer fortsatt pace (TRIMP når HR finnes)', () => {
		const result = computeWorkoutEffort(
			{ sportType: 'running', durationSeconds: 2100, avgHeartRate: 155, paceSecPerKm: 330 },
			paceBaseline
		)!;
		expect(result.method).toBe('trimp');
	});
});
