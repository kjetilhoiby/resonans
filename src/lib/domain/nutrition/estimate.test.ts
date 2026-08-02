import { describe, it, expect } from 'vitest';
import {
	confidenceLabel,
	describeItem,
	describeMacros,
	parseEstimateResponse,
	roundMacros,
	sumItemMacros,
	type NutritionItem
} from './estimate';

function item(overrides: Partial<NutritionItem> = {}): NutritionItem {
	return {
		name: 'Knekkebrød',
		quantity: 2,
		unit: 'stykk',
		macros: { kcal: 80, proteinG: 2.4, carbsG: 13, fatG: 1.2 },
		referenceKey: 'knekkebrod',
		...overrides
	};
}

describe('roundMacros', () => {
	it('runder kalorier til hele og gram til én desimal', () => {
		expect(roundMacros({ kcal: 240.6, proteinG: 14.27, carbsG: 3.04, fatG: 9.55 })).toEqual({
			kcal: 241,
			proteinG: 14.3,
			carbsG: 3,
			fatG: 9.6
		});
	});
});

describe('sumItemMacros', () => {
	it('summerer delene', () => {
		const totals = sumItemMacros([
			item(),
			item({ name: 'Egg', macros: { kcal: 78, proteinG: 6.5, carbsG: 0.6, fatG: 5.3 } })
		]);
		expect(totals).toEqual({ kcal: 158, proteinG: 8.9, carbsG: 13.6, fatG: 6.5 });
	});

	it('gir nuller for tom liste', () => {
		expect(sumItemMacros([])).toEqual({ kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 });
	});

	it('unngår flyttallsstøv i summen', () => {
		const totals = sumItemMacros([
			item({ macros: { kcal: 1, proteinG: 0.1, carbsG: 0.2, fatG: 0.1 } }),
			item({ macros: { kcal: 1, proteinG: 0.2, carbsG: 0.1, fatG: 0.1 } })
		]);
		expect(totals.proteinG).toBe(0.3);
	});
});

describe('parseEstimateResponse', () => {
	it('tolker et velformet modellsvar', () => {
		const estimate = parseEstimateResponse(
			{
				label: 'To knekkebrød med egg',
				items: [
					{ name: 'Knekkebrød', quantity: 2, unit: 'stykk', referenceKey: 'knekkebrod', macros: { kcal: 80, proteinG: 2.4, carbsG: 13, fatG: 1.2 } },
					{ name: 'Egg', quantity: 1, unit: 'stykk', referenceKey: 'egg', macros: { kcal: 78, proteinG: 6.5, carbsG: 0.6, fatG: 5.3 } }
				],
				confidence: 0.8,
				needsQuantity: false,
				notes: 'Uten smør'
			},
			'text'
		);
		expect(estimate.label).toBe('To knekkebrød med egg');
		expect(estimate.items).toHaveLength(2);
		expect(estimate.totals).toEqual({ kcal: 158, proteinG: 8.9, carbsG: 13.6, fatG: 6.5 });
		expect(estimate.confidence).toBe(0.8);
		expect(estimate.needsQuantity).toBe(false);
		expect(estimate.source).toBe('text');
	});

	it('regner totalen fra delene, ikke fra modellens egen sum', () => {
		// Modellen lister to varer og oppgir en total som ikke stemmer. Delene er
		// det brukeren kan korrigere, så de vinner.
		const estimate = parseEstimateResponse(
			{
				items: [
					{ name: 'A', macros: { kcal: 100, proteinG: 5, carbsG: 0, fatG: 0 } },
					{ name: 'B', macros: { kcal: 100, proteinG: 5, carbsG: 0, fatG: 0 } }
				],
				totals: { kcal: 900, proteinG: 90, carbsG: 90, fatG: 90 }
			},
			'text'
		);
		expect(estimate.totals.kcal).toBe(200);
		expect(estimate.totals.proteinG).toBe(10);
	});

	it('tolker tall som kommer som streng med komma', () => {
		const estimate = parseEstimateResponse(
			{ items: [{ name: 'Skyr', quantity: '1,5', macros: { kcal: '95', proteinG: '16,5' } }] },
			'text'
		);
		expect(estimate.items[0].quantity).toBe(1.5);
		expect(estimate.items[0].macros.kcal).toBe(95);
		expect(estimate.items[0].macros.proteinG).toBe(16.5);
	});

	it('nuller ut negative makroer', () => {
		const estimate = parseEstimateResponse(
			{ items: [{ name: 'Rart', macros: { kcal: -50, proteinG: -5, carbsG: 3, fatG: 1 } }] },
			'text'
		);
		expect(estimate.items[0].macros.kcal).toBe(0);
		expect(estimate.items[0].macros.proteinG).toBe(0);
		expect(estimate.items[0].macros.carbsG).toBe(3);
	});

	it('dropper varer uten navn', () => {
		const estimate = parseEstimateResponse(
			{ items: [{ name: '  ', macros: { kcal: 100 } }, { name: 'Egg', macros: { kcal: 78 } }] },
			'text'
		);
		expect(estimate.items).toHaveLength(1);
		expect(estimate.items[0].name).toBe('Egg');
	});

	it('krever mengde når modellen ikke fant noen varer', () => {
		// Uten varer har vi ingenting å lagre, uansett hva modellen hevder.
		const estimate = parseEstimateResponse({ items: [], needsQuantity: false }, 'vision');
		expect(estimate.needsQuantity).toBe(true);
		expect(estimate.totals.kcal).toBe(0);
	});

	it('bevarer oppfølgingsspørsmålet når mengden mangler', () => {
		const estimate = parseEstimateResponse(
			{
				items: [{ name: 'Grøt', macros: { kcal: 250 } }],
				needsQuantity: true,
				question: 'Hvor stor var porsjonen?'
			},
			'vision'
		);
		expect(estimate.needsQuantity).toBe(true);
		expect(estimate.question).toBe('Hvor stor var porsjonen?');
	});

	it('lager en label fra varene når modellen ikke ga noen', () => {
		const estimate = parseEstimateResponse(
			{ items: [{ name: 'Knekkebrød', macros: {} }, { name: 'Egg', macros: {} }] },
			'text'
		);
		expect(estimate.label).toBe('Knekkebrød, Egg');
	});

	it('faller tilbake til «Måltid» for helt tomt svar', () => {
		const estimate = parseEstimateResponse({}, 'text');
		expect(estimate.label).toBe('Måltid');
		expect(estimate.items).toEqual([]);
		expect(estimate.confidence).toBe(0.3);
	});

	it('tåler null, streng og tall der objekt var ventet', () => {
		for (const raw of [null, undefined, 'nope', 42, []]) {
			expect(() => parseEstimateResponse(raw, 'text')).not.toThrow();
		}
	});

	it('klemmer konfidens inn i 0–1', () => {
		expect(parseEstimateResponse({ confidence: 4 }, 'text').confidence).toBe(1);
		expect(parseEstimateResponse({ confidence: -1 }, 'text').confidence).toBe(0);
	});
});

describe('describeMacros', () => {
	it('gir én linje med norsk desimaltegn', () => {
		expect(describeMacros({ kcal: 1840, proteinG: 96.4, carbsG: 200, fatG: 60 })).toBe(
			'1840 kcal · 96 g protein'
		);
	});
});

describe('describeItem', () => {
	it('setter sammen mengde, enhet og navn', () => {
		expect(describeItem(item())).toBe('2 stykk knekkebrød');
	});

	it('viser halve enheter med komma', () => {
		expect(describeItem(item({ quantity: 1.5, unit: 'dl', name: 'Skyr' }))).toBe('1,5 dl skyr');
	});

	it('utelater mengden når den mangler', () => {
		expect(describeItem(item({ quantity: null }))).toBe('Knekkebrød');
	});

	it('klarer seg uten enhet', () => {
		expect(describeItem(item({ unit: null, quantity: 3, name: 'Egg' }))).toBe('3 egg');
	});
});

describe('confidenceLabel', () => {
	it('deler i lav, middels og god', () => {
		expect(confidenceLabel(0.2)).toBe('lav');
		expect(confidenceLabel(0.5)).toBe('middels');
		expect(confidenceLabel(0.85)).toBe('god');
	});

	it('har god på 0,7 og middels på 0,45 — grensene selv', () => {
		expect(confidenceLabel(0.7)).toBe('god');
		expect(confidenceLabel(0.45)).toBe('middels');
		expect(confidenceLabel(0.44)).toBe('lav');
	});
});
