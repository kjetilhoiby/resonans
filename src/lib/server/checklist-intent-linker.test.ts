import { describe, it, expect } from 'vitest';
import { parseChecklistItemIntent } from './checklist-intent-linker';

describe('parseChecklistItemIntent – dayLevel', () => {
	it('bare «yoga» på dag-nivå gir activityType', () => {
		const r = parseChecklistItemIntent('yoga', { dayLevel: true });
		expect(r.activityType).toBe('yoga');
		expect(r.matched).toBe(true);
	});

	it('bare «yoga» uten dayLevel gir ingen activityType', () => {
		expect(parseChecklistItemIntent('yoga').activityType).toBeUndefined();
	});

	it('rulle/tråkke-aliaser på dag-nivå', () => {
		expect(parseChecklistItemIntent('rulle', { dayLevel: true }).activityType).toBe('ebike');
		expect(parseChecklistItemIntent('tråkke', { dayLevel: true }).activityType).toBe('cycling');
	});

	it('«jogge langt» gir distanse 6 km', () => {
		const r = parseChecklistItemIntent('jogge langt', { dayLevel: true });
		expect(r.activityType).toBe('running');
		expect(r.distanceKm).toBe(6);
	});
});
