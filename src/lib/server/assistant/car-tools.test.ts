import { describe, it, expect } from 'vitest';
import { pickGeo, summarizeOsrmRoute } from './car-tools';

/**
 * Ren parse-/utvelgelseslogikk for bil-verktøyene (ingen nettverk). Holder OSRM-/Nominatim-
 * tolkningen testbar isolert fra fetch.
 */
describe('summarizeOsrmRoute', () => {
	it('regner om meter→km (1 desimal) og sekunder→minutter', () => {
		const payload = { routes: [{ distance: 14230, duration: 1140 }] };
		expect(summarizeOsrmRoute(payload)).toEqual({ distanceKm: 14.2, durationMin: 19 });
	});

	it('returnerer null når ruten mangler eller er ugyldig', () => {
		expect(summarizeOsrmRoute({ routes: [] })).toBeNull();
		expect(summarizeOsrmRoute({})).toBeNull();
		expect(summarizeOsrmRoute({ routes: [{ distance: 'x', duration: 1 }] })).toBeNull();
	});
});

describe('pickGeo', () => {
	const oslo = { lat: 59.91, lon: 10.75 };
	const items = [
		{ lat: '63.0', lon: '7.7', display_name: 'Volda, Møre og Romsdal, Norge' },
		{ lat: '59.92', lon: '10.76', display_name: 'Voldsløkka, Oslo, Norge' }
	];

	it('velger topptreffet når ingen posisjon er kjent', () => {
		expect(pickGeo(items)?.label).toBe('Volda, Møre og Romsdal');
	});

	it('velger nærmeste treff når posisjon er kjent', () => {
		expect(pickGeo(items, oslo)?.label).toBe('Voldsløkka, Oslo');
	});

	it('hopper over ugyldige koordinater og returnerer null ved tom liste', () => {
		expect(pickGeo([{ lat: 'nan', lon: 'x', display_name: 'X' }])).toBeNull();
		expect(pickGeo([])).toBeNull();
	});
});
