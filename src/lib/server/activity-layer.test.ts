import { describe, it, expect } from 'vitest';
import { canonicalDistanceMeters, normalizeDistanceMeters } from './activity-layer';

/**
 * De to funksjonene ser like ut og gjør ulike ting. Testen finnes for å holde
 * skillet: den ene tolker et felt som kan inneholde kilometer, den andre leser
 * et felt som alltid er meter.
 */
describe('normalizeDistanceMeters — rå sensor-events', () => {
	it('tolker små verdier som kilometer', () => {
		// Noen kilder skriver kilometer i et felt som heter meter.
		expect(normalizeDistanceMeters(8.1)).toBe(8100);
		expect(normalizeDistanceMeters(42)).toBe(42_000);
	});

	it('lar store verdier være meter', () => {
		expect(normalizeDistanceMeters(8100)).toBe(8100);
	});

	it('avviser tull', () => {
		expect(normalizeDistanceMeters(0)).toBeNull();
		expect(normalizeDistanceMeters(-5)).toBeNull();
		expect(normalizeDistanceMeters('8100')).toBeNull();
		expect(normalizeDistanceMeters(null)).toBeNull();
	});
});

describe('canonicalDistanceMeters — canonical_workouts', () => {
	it('leser små verdier som METER, ikke kilometer', () => {
		/**
		 * Regresjonen: canonical er alt skrevet gjennom `normalizeDistanceMeters`,
		 * så en ny runde med km-heuristikken gjorde en søppelrad på 53 meter til
		 * 53 kilometer. Den akkumulerte løpekurven startet da 53 km oppe i lufta
		 * på dag 1, og i streak-kalenderen ble den samme raden dagens raskeste
		 * tempo.
		 */
		expect(canonicalDistanceMeters(53)).toBe(53);
		expect(canonicalDistanceMeters(8100)).toBe(8100);
	});

	it('tar strengen decimal-kolonnen gir', () => {
		expect(canonicalDistanceMeters('8100.5')).toBe(8100.5);
	});

	it('avviser null, tom og ikke-positiv', () => {
		expect(canonicalDistanceMeters(null)).toBeNull();
		expect(canonicalDistanceMeters(undefined)).toBeNull();
		expect(canonicalDistanceMeters('')).toBeNull();
		expect(canonicalDistanceMeters(0)).toBeNull();
		expect(canonicalDistanceMeters(-1)).toBeNull();
		expect(canonicalDistanceMeters('tull')).toBeNull();
	});
});
