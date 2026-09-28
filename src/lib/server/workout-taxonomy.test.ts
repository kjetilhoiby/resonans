import { describe, it, expect } from 'vitest';
import { describeWorkoutSportType } from './workout-taxonomy';

describe('describeWorkoutSportType', () => {
	it('kaller mølla Tredemølle, ikke Løpetur', () => {
		// Tittelen går også til Strava som aktivitetsnavn (27. september 2026).
		expect(describeWorkoutSportType('indoor_running')).toBe('Tredemølle');
	});

	it('lar løping og terrengløping hete Løpetur', () => {
		expect(describeWorkoutSportType('running')).toBe('Løpetur');
		expect(describeWorkoutSportType('trail_running')).toBe('Løpetur');
	});

	it('faller tilbake på Treningsøkt', () => {
		expect(describeWorkoutSportType('noe_ukjent')).toBe('Treningsøkt');
	});
});
