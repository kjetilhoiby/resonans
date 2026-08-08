import { describe, it, expect } from 'vitest';
import { workoutSportFamily, matchesWorkoutSportFilter } from './workout-sport';

describe('workoutSportFamily', () => {
	it('samler løpevarianter under running', () => {
		expect(workoutSportFamily('running')).toBe('running');
		expect(workoutSportFamily('trail_running')).toBe('running');
		expect(workoutSportFamily('indoor_running')).toBe('running');
		expect(workoutSportFamily('løp')).toBe('running');
		expect(workoutSportFamily('run')).toBe('running');
	});

	it('samler sykkelvarianter under cycling', () => {
		expect(workoutSportFamily('cycling')).toBe('cycling');
		expect(workoutSportFamily('indoor_cycling')).toBe('cycling');
		expect(workoutSportFamily('e_bike')).toBe('cycling');
		expect(workoutSportFamily('eBiking')).toBe('cycling');
	});

	it('samler gåvarianter under walking', () => {
		expect(workoutSportFamily('walking')).toBe('walking');
		expect(workoutSportFamily('hiking')).toBe('walking');
	});

	it('lar ukjente typer være sin egen familie', () => {
		expect(workoutSportFamily('tennis')).toBe('tennis');
		expect(workoutSportFamily('hill')).toBe('hill');
	});

	it('gir workout for tom verdi', () => {
		expect(workoutSportFamily('')).toBe('workout');
		expect(workoutSportFamily(null)).toBe('workout');
		expect(workoutSportFamily(undefined)).toBe('workout');
	});
});

describe('matchesWorkoutSportFilter', () => {
	it('tomt filter tar alle økter', () => {
		expect(matchesWorkoutSportFilter('cycling', null)).toBe(true);
		expect(matchesWorkoutSportFilter('cycling', '')).toBe(true);
		expect(matchesWorkoutSportFilter('cycling', '   ')).toBe(true);
	});

	it('familiefilter tar hele familien', () => {
		expect(matchesWorkoutSportFilter('running', 'running')).toBe(true);
		expect(matchesWorkoutSportFilter('trail_running', 'running')).toBe(true);
		expect(matchesWorkoutSportFilter('indoor_running', 'running')).toBe(true);
		expect(matchesWorkoutSportFilter('løp', 'running')).toBe(true);
	});

	it('holder andre familier utenfor', () => {
		expect(matchesWorkoutSportFilter('cycling', 'running')).toBe(false);
		expect(matchesWorkoutSportFilter('walking', 'running')).toBe(false);
		expect(matchesWorkoutSportFilter('hiking', 'running')).toBe(false);
	});

	it('eksakt filter utvides ikke til familien', () => {
		// e_bike hører til cycling, men et e_bike-filter skal ikke dra inn all sykling
		expect(matchesWorkoutSportFilter('e_bike', 'e_bike')).toBe(true);
		expect(matchesWorkoutSportFilter('cycling', 'e_bike')).toBe(false);
	});

	it('ignorerer store bokstaver og mellomrom', () => {
		expect(matchesWorkoutSportFilter('Running', ' running ')).toBe(true);
	});
});
