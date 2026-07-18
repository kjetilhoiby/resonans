import { describe, it, expect } from 'vitest';
import {
	normalizeIngredientName,
	cleanIngredientNameForSearch,
	odaSearchUrl,
	shoppingListToPlainText
} from './oda';

describe('normalizeIngredientName', () => {
	it('lowercaser og trimmer', () => {
		expect(normalizeIngredientName('  Kjøttdeig ')).toBe('kjøttdeig');
	});

	it('fjerner mengde-parenteser', () => {
		expect(normalizeIngredientName('kjøttdeig (400 g)')).toBe('kjøttdeig');
	});

	it('beholder variant-parenteser uten sifre', () => {
		expect(normalizeIngredientName('melk (laktosefri)')).toBe('melk (laktosefri)');
		expect(normalizeIngredientName('paprika (rød)')).toBe('paprika (rød)');
	});

	it('kollapser mellomrom', () => {
		expect(normalizeIngredientName('rød   paprika')).toBe('rød paprika');
	});
});

describe('cleanIngredientNameForSearch', () => {
	it('fjerner mengdesuffiks', () => {
		expect(cleanIngredientNameForSearch('kjøttdeig 400 g')).toBe('kjøttdeig');
		expect(cleanIngredientNameForSearch('melk 1,75 l')).toBe('melk');
	});

	it('beholder rene navn uendret', () => {
		expect(cleanIngredientNameForSearch('Taco-lefser')).toBe('taco-lefser');
	});
});

describe('odaSearchUrl', () => {
	it('bygger URL-enkodet søkelenke', () => {
		expect(odaSearchUrl('rød paprika')).toBe('https://oda.com/no/search/?q=r%C3%B8d%20paprika');
	});

	it('renser mengder før søk', () => {
		expect(odaSearchUrl('kjøttdeig (400 g)')).toBe('https://oda.com/no/search/?q=kj%C3%B8ttdeig');
	});
});

describe('shoppingListToPlainText', () => {
	it('lister varer med mengde og enhet', () => {
		const text = shoppingListToPlainText([
			{ name: 'kjøttdeig', quantity: 400, unit: 'g' },
			{ name: 'melk', quantity: 2, unit: null },
			{ name: 'taco-lefser' }
		]);
		expect(text).toBe('- 400 g kjøttdeig\n- 2 melk\n- taco-lefser');
	});

	it('hopper over avhukede varer', () => {
		const text = shoppingListToPlainText([
			{ name: 'melk', checked: true },
			{ name: 'brød' }
		]);
		expect(text).toBe('- brød');
	});

	it('formaterer desimalmengder med komma', () => {
		expect(shoppingListToPlainText([{ name: 'fløte', quantity: 0.5, unit: 'l' }])).toBe('- 0,5 l fløte');
	});
});
