import { describe, it, expect } from 'vitest';
import {
	looksMislabelled,
	planRemoval,
	SUSPICIOUS_RUN_SPEED_MPS,
	type RemovalCandidate
} from './workout-removal';

function candidate(over: Partial<RemovalCandidate> = {}): RemovalCandidate {
	return {
		eventId: 'e1',
		startTime: new Date('2026-08-17T06:26:00Z'),
		sportType: 'running',
		distanceMeters: 8300,
		durationSeconds: 1400,
		provider: 'ekko',
		...over
	};
}

describe('planRemoval', () => {
	it('tom liste rører ingenting', () => {
		const plan = planRemoval([]);
		expect(plan.reaggregateFrom).toBeNull();
		expect(plan.notCleaned).toEqual([]);
	});

	it('reaggregerer fra DØGNETS start, ikke fra øktas tidspunkt', () => {
		// Aggregatene er dags-, uke-, måned- og årsrader. En reaggregering som
		// starter kl. 06:26 ville etterlatt dagsraden som den var.
		const plan = planRemoval([candidate()]);
		expect(plan.reaggregateFrom?.toISOString()).toBe('2026-08-17T00:00:00.000Z');
	});

	it('velger den tidligste dagen når flere økter slettes', () => {
		const plan = planRemoval([
			candidate({ eventId: 'sen', startTime: new Date('2026-08-17T15:00:00Z') }),
			candidate({ eventId: 'tidlig', startTime: new Date('2026-08-16T05:00:00Z') })
		]);
		expect(plan.reaggregateFrom?.toISOString()).toBe('2026-08-16T00:00:00.000Z');
	});

	it('sier med ord hva den IKKE rydder', () => {
		// Å la brukeren oppdage at haker og Strava står igjen er verre enn å si det.
		const plan = planRemoval([candidate()]);
		expect(plan.notCleaned.join(' ')).toMatch(/haker aldri av/);
		expect(plan.notCleaned.join(' ')).toMatch(/Strava/);
	});
});

describe('looksMislabelled', () => {
	it('kjenner igjen elsykkelturen som ble lagret som løping', () => {
		// Felttest 17. august: 8,3 km på 1400 s = 5,9 m/s … som er UNDER terskelen.
		// Den ekte turen var raskere; her er tallet fra rekorden som ble satt.
		expect(looksMislabelled(candidate({ distanceMeters: 5000, durationSeconds: 745 }))).toBe(true);
	});

	it('lar en rask, men menneskelig løpetur være', () => {
		// 5 km på 20 minutter = 4,2 m/s. Ingenting mistenkelig.
		expect(looksMislabelled(candidate({ distanceMeters: 5000, durationSeconds: 1200 }))).toBe(false);
	});

	it('rører ikke andre idretter — sykkel SKAL være rask', () => {
		expect(
			looksMislabelled(
				candidate({ sportType: 'eBiking', distanceMeters: 5000, durationSeconds: 745 })
			)
		).toBe(false);
	});

	it('mangler tall → ingen påstand', () => {
		expect(looksMislabelled(candidate({ distanceMeters: null }))).toBe(false);
		expect(looksMislabelled(candidate({ durationSeconds: 0 }))).toBe(false);
	});

	it('terskelen ligger mellom løping og elsykkel', () => {
		// Under: en løpetur ingen mistenker. Over: motor.
		expect(SUSPICIOUS_RUN_SPEED_MPS).toBeGreaterThan(5.5);
		expect(SUSPICIOUS_RUN_SPEED_MPS).toBeLessThan(7);
	});
});
