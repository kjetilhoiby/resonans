import { describe, it, expect } from 'vitest';
import { normalizeSportType } from './sport';

describe('normalizeSportType', () => {
	it('mapper e-sykkel-varianter til e_bike', () => {
		for (const v of ['eBiking', 'Ebiking', 'ebike', 'e-bike', 'E_Bike', 'elsykkel', 'EL-SYKKEL']) {
			expect(normalizeSportType(v)).toBe('e_bike');
		}
	});

	it('mapper mølle til indoor_running, som er i løpefamilien', () => {
		for (const v of ['treadmill', 'Treadmill', 'tredemølle', 'mølle']) {
			expect(normalizeSportType(v)).toBe('indoor_running');
		}
	});

	it('lavbokstaverer andre verdier uendret', () => {
		expect(normalizeSportType('Running')).toBe('running');
		expect(normalizeSportType('Cycling')).toBe('cycling');
		expect(normalizeSportType('lift_weights')).toBe('lift_weights');
	});

	it('tåler tomt/null/undefined', () => {
		expect(normalizeSportType('')).toBe('');
		expect(normalizeSportType(null)).toBe('');
		expect(normalizeSportType(undefined)).toBe('');
	});
});
