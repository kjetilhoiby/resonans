import { describe, it, expect } from 'vitest';
import { detectActivityType, parseTaskIntent, LONG_RUN_DISTANCE_KM } from './task-intent-parser';

describe('detectActivityType – aliaser', () => {
	it('rulle/elsykkel → ebike', () => {
		expect(detectActivityType('rulle')).toBe('ebike');
		expect(detectActivityType('rulle fire ganger')).toBe('ebike');
		expect(detectActivityType('elsykle til jobb')).toBe('ebike');
		expect(detectActivityType('elsykkel')).toBe('ebike');
	});

	it('tråkke/sykle → cycling', () => {
		expect(detectActivityType('tråkke')).toBe('cycling');
		expect(detectActivityType('tråkke fire ganger')).toBe('cycling');
		expect(detectActivityType('sykle til jobb')).toBe('cycling');
	});

	it('elsykkel og sykkel er adskilt', () => {
		expect(detectActivityType('elsykkel')).not.toBe('cycling');
		expect(detectActivityType('rulle')).not.toBe('cycling');
		expect(detectActivityType('tråkke')).not.toBe('ebike');
	});

	it('andre aktiviteter', () => {
		expect(detectActivityType('yoga')).toBe('yoga');
		expect(detectActivityType('styrke')).toBe('strength');
		expect(detectActivityType('løpe')).toBe('running');
		expect(detectActivityType('jogge')).toBe('running');
	});

	it('ukjent → undefined', () => {
		expect(detectActivityType('ring mamma')).toBeUndefined();
	});
});

describe('parseTaskIntent – «langt» løp', () => {
	it('«jogge langt» får distanceKm = LONG_RUN_DISTANCE_KM', () => {
		const r = parseTaskIntent('jogge langt');
		expect(r.matched).toBe(true);
		expect(r.intent?.activityType).toBe('running');
		expect(r.intent?.distanceKm).toBe(LONG_RUN_DISTANCE_KM);
	});

	it('eksplisitt distanse vinner over «langt»', () => {
		const r = parseTaskIntent('løpe 8 km');
		expect(r.intent?.distanceKm).toBe(8);
	});

	it('«langt» gir ikke distanse for ikke-løp', () => {
		// "sykle langt" → cycling uten kvantifiserbart mål → ingen intent
		const r = parseTaskIntent('sykle langt');
		expect(r.intent?.distanceKm).toBeUndefined();
	});
});
