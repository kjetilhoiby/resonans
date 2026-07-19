import { describe, it, expect } from 'vitest';
import { shouldAdoptItem, mealItemFieldsFor, dayDateFromContext } from './meal-plan-sync';

describe('shouldAdoptItem', () => {
	it('adopterer uavkrysset middagspunkt med samme tittel', () => {
		expect(
			shouldAdoptItem({ checked: false, text: 'middag: Taco', metadata: {} }, 'dinner', 'Taco')
		).toBe(true);
	});

	it('adopterer med case-insensitiv tittelmatch', () => {
		expect(
			shouldAdoptItem({ checked: false, text: 'middag: taco', metadata: {} }, 'dinner', 'TACO')
		).toBe(true);
	});

	it('adopterer ikke punkter med annen tittel — brukertekst skal aldri omskrives', () => {
		expect(
			shouldAdoptItem(
				{ checked: false, text: 'middag: Fiskegrateng', metadata: {} },
				'dinner',
				'Taco'
			)
		).toBe(false);
	});

	it('adopterer ikke avkryssede punkter', () => {
		expect(
			shouldAdoptItem({ checked: true, text: 'middag: Taco', metadata: {} }, 'dinner', 'Taco')
		).toBe(false);
	});

	it('adopterer ikke punkter som allerede er koblet', () => {
		expect(
			shouldAdoptItem(
				{ checked: false, text: 'middag: Taco', metadata: { linkedMealPlanId: 'abc' } },
				'dinner',
				'Taco'
			)
		).toBe(false);
	});

	it('adopterer ikke punkter med annen måltidstype', () => {
		expect(
			shouldAdoptItem({ checked: false, text: 'frokost: Grøt', metadata: {} }, 'dinner', 'Grøt')
		).toBe(false);
	});

	it('adopterer ikke punkter uten måltidsprefiks', () => {
		expect(
			shouldAdoptItem({ checked: false, text: 'Handle mat', metadata: {} }, 'dinner', 'Taco')
		).toBe(false);
	});
});

describe('mealItemFieldsFor', () => {
	const plan = { id: 'plan-1', mealType: 'dinner', mealId: 'meal-1' };

	it('bygger prefiks-tekst og kobling', () => {
		const fields = mealItemFieldsFor(plan, 'Fiskegrateng');
		expect(fields.text).toBe('middag: Fiskegrateng');
		expect(fields.metadata.linkedMealPlanId).toBe('plan-1');
		expect(fields.metadata.linkedMealId).toBe('meal-1');
		expect(fields.metadata.mealType).toBe('dinner');
	});

	it('bevarer eksisterende metadata (f.eks. timeHour)', () => {
		const fields = mealItemFieldsFor(plan, 'Taco', { timeHour: 17, chore: true });
		expect(fields.metadata.timeHour).toBe(17);
		expect(fields.metadata.chore).toBe(true);
	});

	it('utelater linkedMealId når planen mangler meal', () => {
		const fields = mealItemFieldsFor({ ...plan, mealId: null }, 'Restemat');
		expect(fields.metadata.linkedMealId).toBeUndefined();
	});
});

describe('dayDateFromContext', () => {
	it('trekker ut dato fra dag-kontekst', () => {
		expect(dayDateFromContext('week:2026-W31:day:2026-07-27')).toBe('2026-07-27');
	});

	it('gir null for uke-kontekst og andre kontekster', () => {
		expect(dayDateFromContext('week:2026-W31')).toBeNull();
		expect(dayDateFromContext('tur')).toBeNull();
		expect(dayDateFromContext(null)).toBeNull();
	});
});
