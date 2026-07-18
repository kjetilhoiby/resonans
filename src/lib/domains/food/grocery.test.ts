import { describe, it, expect } from 'vitest';
import {
	normalizeGroceryName,
	guessCategory,
	guessPantryLocation,
	isFoodLine,
	compareShoppingListToOrder,
	weekContextForDate
} from './grocery';

describe('normalizeGroceryName', () => {
	it('fjerner mengder og prosent', () => {
		expect(normalizeGroceryName('Tine Lettmelk 1,0 % 1,75 l')).toBe('tine lettmelk');
		expect(normalizeGroceryName('Kjøttdeig 400 g')).toBe('kjøttdeig');
	});

	it('fjerner mengde-parenteser men beholder variant-parenteser', () => {
		expect(normalizeGroceryName('Kjøttdeig (400 g)')).toBe('kjøttdeig');
		expect(normalizeGroceryName('Gulrot (norsk)')).toBe('gulrot (norsk)');
	});
});

describe('guessCategory', () => {
	it('kjenner igjen norske Oda-varenavn', () => {
		expect(guessCategory('Tine Lettmelk 1,75 l')).toBe('meieri');
		expect(guessCategory('Kjøttdeig av storfe')).toBe('kjott_fisk');
		expect(guessCategory('Gulrot beger')).toBe('frukt_gront');
		expect(guessCategory('Pant flaske')).toBe('pant_gebyr');
		expect(guessCategory('Leveringsgebyr')).toBe('pant_gebyr');
		expect(guessCategory('Zalo oppvaskmiddel')).toBe('husholdning');
		expect(guessCategory('Grandiosa pizza')).toBe('frys');
	});

	it('faller tilbake på annet', () => {
		expect(guessCategory('Noe helt ukjent')).toBe('annet');
	});
});

describe('guessPantryLocation', () => {
	it('plasserer meieri og kjøtt i kjøleskapet', () => {
		expect(guessPantryLocation('meieri', 'Lettmelk')).toBe('fridge');
		expect(guessPantryLocation('kjott_fisk', 'Kyllingfilet')).toBe('fridge');
	});

	it('plasserer frysevarer i fryseren', () => {
		expect(guessPantryLocation('frys', 'Grandiosa')).toBe('freezer');
	});

	it('gir null for pant og husholdning', () => {
		expect(guessPantryLocation('pant_gebyr', 'Pant')).toBeNull();
		expect(guessPantryLocation('husholdning', 'Tørkerull')).toBeNull();
	});
});

describe('isFoodLine', () => {
	it('ekskluderer pant og husholdning', () => {
		expect(isFoodLine({ name: 'Pant flaske', category: 'pant_gebyr' })).toBe(false);
		expect(isFoodLine({ name: 'Tørkerull', category: 'husholdning' })).toBe(false);
		expect(isFoodLine({ name: 'Lettmelk', category: 'meieri' })).toBe(true);
	});

	it('gjetter kategori når den mangler', () => {
		expect(isFoodLine({ name: 'Leveringsgebyr' })).toBe(false);
		expect(isFoodLine({ name: 'Banan' })).toBe(true);
	});
});

describe('compareShoppingListToOrder', () => {
	it('matcher planlagte varer mot kvitteringslinjer med delvis navneoverlapp', () => {
		const result = compareShoppingListToOrder(
			[{ text: 'kjøttdeig (400 g)' }, { text: 'taco-lefser' }, { text: 'gjær' }],
			[
				{ name: 'Kjøttdeig av storfe 14% 400g', category: 'kjott_fisk' },
				{ name: 'Old El Paso Tacolefser 8 stk', category: 'torrvarer' },
				{ name: 'Monster Energy', category: 'drikke' },
				{ name: 'Pant', category: 'pant_gebyr' }
			]
		);
		expect(result.bought.map((b) => b.planned)).toEqual(['kjøttdeig (400 g)', 'taco-lefser']);
		expect(result.missing).toEqual(['gjær']);
		expect(result.impulse).toEqual(['Monster Energy']);
	});

	it('teller ikke pant/gebyr som impulskjøp', () => {
		const result = compareShoppingListToOrder([], [{ name: 'Leveringsgebyr' }, { name: 'Pant' }]);
		expect(result.impulse).toEqual([]);
	});

	it('bruker hver kvitteringslinje maks én gang', () => {
		const result = compareShoppingListToOrder(
			[{ text: 'melk' }, { text: 'melk' }],
			[{ name: 'Tine Lettmelk 1,75 l', category: 'meieri' }]
		);
		expect(result.bought).toHaveLength(1);
		expect(result.missing).toEqual(['melk']);
	});
});

describe('weekContextForDate', () => {
	it('gir ISO-uke for midt i året', () => {
		expect(weekContextForDate('2026-07-18')).toBe('2026-W29');
	});

	it('håndterer årsskifte', () => {
		expect(weekContextForDate('2026-01-01')).toBe('2026-W01');
		expect(weekContextForDate('2027-01-01')).toBe('2026-W53');
	});
});
