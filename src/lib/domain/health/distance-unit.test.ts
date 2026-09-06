import { describe, it, expect } from 'vitest';
import { resolveDistanceMeters, MAX_PLAUSIBLE_SPEED_MPS } from './distance-unit';

describe('resolveDistanceMeters', () => {
	/**
	 * REGRESJON, med prod-tallene. 2. april 2026: to kilder var enige om «52.9»,
	 * og km-heuristikken gjorde det til 52,9 km. Kortet viste 52,90 km ved siden
	 * av tempo 62:23/km — tempoet regnet av METERNE.
	 */
	it('52,9 på tre minutter er meter, ikke kilometer', () => {
		expect(resolveDistanceMeters(52.9, 180)).toBe(52.9);
	});

	it('52,9 på 25 minutter er også meter — 127 km/t er ikke en fart', () => {
		expect(resolveDistanceMeters(52.9, 25 * 60)).toBe(52.9);
	});

	it('et ekte ultraløp beholder kilometer', () => {
		// 52,9 km på seks timer er 2,45 m/s. Fullt mulig, og skal ikke røres.
		expect(resolveDistanceMeters(52.9, 6 * 3600)).toBe(52_900);
	});

	it('en vanlig 10-kilometer beholder kilometer', () => {
		expect(resolveDistanceMeters(10, 55 * 60)).toBe(10_000);
	});

	it('uten varighet gjør vi som før — km, og det er en kjent rest', () => {
		expect(resolveDistanceMeters(52.9, null)).toBe(52_900);
		expect(resolveDistanceMeters(52.9, 0)).toBe(52_900);
	});

	it('over taket er verdien meter, og farten er irrelevant', () => {
		// 5000 m på ett sekund er umulig, men tolkningen er ikke vår: kilden
		// sa meter, og vakten avgjør bare ENHET.
		expect(resolveDistanceMeters(5000, 1)).toBe(5000);
	});

	it('grensa ligger på 80, som i heuristikken', () => {
		expect(resolveDistanceMeters(80, 6 * 3600)).toBe(80_000);
		expect(resolveDistanceMeters(81, 6 * 3600)).toBe(81);
	});

	it('nøyaktig på terskelen godtas — vakten avviser det umulige', () => {
		// 30 m/s: 3 km på 100 sekunder.
		const seconds = 3000 / MAX_PLAUSIBLE_SPEED_MPS;
		expect(resolveDistanceMeters(3, seconds)).toBe(3000);
	});

	it('ugyldige verdier gir null', () => {
		expect(resolveDistanceMeters(null, 600)).toBeNull();
		expect(resolveDistanceMeters(0, 600)).toBeNull();
		expect(resolveDistanceMeters(-5, 600)).toBeNull();
		expect(resolveDistanceMeters('5', 600)).toBeNull();
	});
});
