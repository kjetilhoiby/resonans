import { describe, it, expect } from 'vitest';
import { normalizeSuggestion } from './recipe-suggestion';

describe('normalizeSuggestion', () => {
	it('normaliserer et fullt forslag og kanoniserer sammensetning', () => {
		const result = normalizeSuggestion(
			{
				title: '  Kyllingwok  ',
				description: 'Rask og barnevennlig',
				ingredients: [
					{ name: 'Kyllingfilet', quantity: 600, unit: 'g' },
					{ name: 'Ris', quantity: 4, unit: 'dl' },
					{ bad: 'ignoreres' }
				],
				instructions: ['Stek kyllingen', '  ', 'Kok risen'],
				prepTimeMin: 15,
				cookTimeMin: 20,
				servings: 5,
				tags: ['Rask', 'KYLLING'],
				mainProtein: 'kyllingfilet',
				mainCarb: 'jasminris',
				greens: 'wok',
				effortLevel: 'Lav',
				nutritionEstimate: { kcal: 620, proteinG: 38 },
				note: 'Skalert til 5 porsjoner'
			},
			'fallback'
		);
		expect(result.title).toBe('Kyllingwok');
		expect(result.ingredients).toHaveLength(2);
		expect(result.instructions).toEqual(['Stek kyllingen', 'Kok risen']);
		expect(result.tags).toEqual(['rask', 'kylling']);
		expect(result.mainProtein).toBe('kylling');
		expect(result.mainCarb).toBe('ris');
		expect(result.greens).toBe('wok');
		expect(result.effortLevel).toBe('lav');
		expect(result.nutritionEstimate).toEqual({ kcal: 620, proteinG: 38, source: 'recipe-derived' });
	});

	it('faller tilbake til tittel og familieporsjoner ved manglende felt', () => {
		const result = normalizeSuggestion({}, 'Fiskegrateng');
		expect(result.title).toBe('Fiskegrateng');
		expect(result.servings).toBe(5);
		expect(result.ingredients).toEqual([]);
		expect(result.instructions).toEqual([]);
		expect(result.mainProtein).toBeNull();
		expect(result.nutritionEstimate).toBeNull();
		expect(result.effortLevel).toBeNull();
	});

	it('lar sammensetning stå tom for komplette retter', () => {
		const result = normalizeSuggestion(
			{ title: 'Tomatsuppe', mainProtein: null, mainCarb: null, greens: null },
			'x'
		);
		expect(result.mainProtein).toBeNull();
		expect(result.mainCarb).toBeNull();
		expect(result.greens).toBeNull();
	});

	it('ignorerer ugyldig effortLevel og ikke-numeriske tider', () => {
		const result = normalizeSuggestion(
			{ title: 'X', effortLevel: 'ekstrem', prepTimeMin: 'ti', servings: 0 },
			'X'
		);
		expect(result.effortLevel).toBeNull();
		expect(result.prepTimeMin).toBeNull();
		expect(result.servings).toBe(5);
	});

	it('tar med kun kcal når protein mangler', () => {
		const result = normalizeSuggestion({ title: 'X', nutritionEstimate: { kcal: 500 } }, 'X');
		expect(result.nutritionEstimate).toEqual({ kcal: 500, source: 'recipe-derived' });
	});
});
