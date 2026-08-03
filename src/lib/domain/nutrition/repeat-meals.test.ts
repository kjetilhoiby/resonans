import { describe, it, expect } from 'vitest';
import { MIN_OCCURRENCES, repeatableMeals, repeatKey } from './repeat-meals';
import type { LoggedEntry } from './day-summary';

/** Kortform for en loggført rad. */
function entry(
	label: string,
	timestamp: string,
	kcal = 242,
	extra: Partial<LoggedEntry> = {}
): LoggedEntry {
	return {
		id: `${label}-${timestamp}`,
		timestamp,
		label,
		macros: { kcal, proteinG: 16, carbsG: 20, fatG: 10 },
		confidence: 0.8,
		imageUrl: null,
		mealSlot: null,
		mealSlotSource: null,
		...extra
	};
}

describe('repeatKey', () => {
	it('gjør små forskjeller i skrivemåte til samme måltid', () => {
		expect(repeatKey('Knekkebrød med egg')).toBe(repeatKey('knekkebrød  med egg '));
	});

	it('slår ikke sammen ulike måltider', () => {
		// «kaffe» og «kaffe med melk» er ikke det samme.
		expect(repeatKey('kaffe')).not.toBe(repeatKey('kaffe med melk'));
	});
});

describe('repeatableMeals', () => {
	it('finner kontorlunsjen som gjentas', () => {
		const meals = repeatableMeals([
			entry('Knekkebrød med egg og agurk', '2026-08-03T10:01:00Z'),
			entry('Knekkebrød med egg og agurk', '2026-07-31T10:05:00Z'),
			entry('Knekkebrød med egg og agurk', '2026-07-29T10:11:00Z'),
			entry('Pølse i brød', '2026-08-03T13:23:00Z', 330)
		]);
		expect(meals).toHaveLength(1);
		expect(meals[0].label).toBe('Knekkebrød med egg og agurk');
		expect(meals[0].occurrences).toBe(3);
	});

	it('krever et mønster, ikke bare et måltid', () => {
		expect(MIN_OCCURRENCES).toBe(2);
		expect(repeatableMeals([entry('Grøt', '2026-08-03T06:00:00Z')])).toHaveLength(0);
	});

	it('bruker makroene fra siste forekomst, ikke snittet', () => {
		// Har brukeren rettet tallene én gang, er det de rettede som gjelder videre.
		const meals = repeatableMeals([
			entry('Grøt', '2026-08-03T06:00:00Z', 400),
			entry('Grøt', '2026-08-01T06:00:00Z', 250)
		]);
		expect(meals[0].macros.kcal).toBe(400);
		expect(meals[0].lastAt).toBe('2026-08-03T06:00:00Z');
	});

	it('rangerer på antall, deretter ferskhet', () => {
		const meals = repeatableMeals([
			entry('Sjelden', '2026-08-03T12:00:00Z'),
			entry('Sjelden', '2026-08-02T12:00:00Z'),
			entry('Vanlig', '2026-07-20T12:00:00Z'),
			entry('Vanlig', '2026-07-21T12:00:00Z'),
			entry('Vanlig', '2026-07-22T12:00:00Z')
		]);
		expect(meals.map((m) => m.label)).toEqual(['Vanlig', 'Sjelden']);
	});

	it('finner sloten måltidet vanligvis hører til', () => {
		const meals = repeatableMeals([
			entry('Knekkebrød', '2026-08-03T10:00:00Z', 242, { mealSlot: 'lunsj' }),
			entry('Knekkebrød', '2026-08-02T10:00:00Z', 242, { mealSlot: 'lunsj' }),
			entry('Knekkebrød', '2026-08-01T19:00:00Z', 242, { mealSlot: 'kvelds' })
		]);
		expect(meals[0].usualSlot).toBe('lunsj');
	});

	it('gir null slot ved uavgjort, så klokka får bestemme', () => {
		const meals = repeatableMeals([
			entry('Yoghurt', '2026-08-03T10:00:00Z', 200, { mealSlot: 'lunsj' }),
			entry('Yoghurt', '2026-08-02T19:00:00Z', 200, { mealSlot: 'kvelds' })
		]);
		expect(meals[0].usualSlot).toBeNull();
	});

	it('tar med bildet fra siste forekomst', () => {
		const meals = repeatableMeals([
			entry('Salat', '2026-08-03T10:00:00Z', 300, { imageUrl: 'https://x/ny.jpg' }),
			entry('Salat', '2026-08-01T10:00:00Z', 300, { imageUrl: 'https://x/gammel.jpg' })
		]);
		expect(meals[0].imageUrl).toBe('https://x/ny.jpg');
	});

	it('hopper over rader uten tittel eller uten energi', () => {
		const meals = repeatableMeals([
			entry('Måltid', '2026-08-03T10:00:00Z'),
			entry('Måltid', '2026-08-02T10:00:00Z'),
			entry('Vann', '2026-08-03T11:00:00Z', 0),
			entry('Vann', '2026-08-02T11:00:00Z', 0)
		]);
		expect(meals).toHaveLength(0);
	});

	it('kutter lista, siden en liste på tretti ikke er raskere enn å skrive', () => {
		const entries = Array.from({ length: 20 }, (_, i) => [
			entry(`Måltid ${i}`, `2026-08-0${(i % 3) + 1}T10:00:00Z`, 200 + i),
			entry(`Måltid ${i}`, `2026-07-2${(i % 9) + 1}T10:00:00Z`, 200 + i)
		]).flat();
		expect(repeatableMeals(entries).length).toBeLessThanOrEqual(6);
		expect(repeatableMeals(entries, { limit: 3 })).toHaveLength(3);
	});

	it('tåler en tom logg', () => {
		expect(repeatableMeals([])).toEqual([]);
	});
});
