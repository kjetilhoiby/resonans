import { describe, it, expect } from 'vitest';
import {
	aggregateIngredients,
	mergeShoppingListItems,
	toShoppingListItem,
	type ShoppingListItem
} from './shopping-list-service';

function meal(id: string, title: string, servings: number, ingredients: Array<{ name: string; quantity?: number | null; unit?: string | null; optional?: boolean }>) {
	return { id, title, servings, ingredients };
}

describe('aggregateIngredients', () => {
	it('skalerer mengder etter porsjoner', () => {
		const mealsById = new Map([
			['m1', meal('m1', 'Taco', 2, [{ name: 'kjøttdeig', quantity: 400, unit: 'g' }])]
		]);
		const result = aggregateIngredients(
			[{ mealId: 'm1', servings: 5 }],
			mealsById,
			new Set()
		);
		expect(result).toHaveLength(1);
		expect(result[0].quantity).toBe(1000);
	});

	it('slår sammen samme vare fra flere retter (samme enhet)', () => {
		const mealsById = new Map([
			['m1', meal('m1', 'Taco', 2, [{ name: 'løk', quantity: 1, unit: 'stk' }])],
			['m2', meal('m2', 'Lasagne', 2, [{ name: 'Løk', quantity: 2, unit: 'stk' }])]
		]);
		const result = aggregateIngredients(
			[
				{ mealId: 'm1', servings: 2 },
				{ mealId: 'm2', servings: 2 }
			],
			mealsById,
			new Set()
		);
		expect(result).toHaveLength(1);
		expect(result[0].quantity).toBe(3);
		expect(result[0].sources).toEqual(['Taco', 'Lasagne']);
	});

	it('hopper over pantry-treff', () => {
		const mealsById = new Map([
			['m1', meal('m1', 'Taco', 2, [{ name: 'Kjøttdeig' }, { name: 'taco-krydder' }])]
		]);
		const result = aggregateIngredients(
			[{ mealId: 'm1', servings: 2 }],
			mealsById,
			new Set(['taco-krydder'])
		);
		expect(result.map((r) => r.name)).toEqual(['Kjøttdeig']);
	});

	it('utelater valgfrie ingredienser uten includeOptional', () => {
		const mealsById = new Map([
			['m1', meal('m1', 'Taco', 2, [{ name: 'rømme', optional: true }, { name: 'kjøttdeig' }])]
		]);
		const without = aggregateIngredients([{ mealId: 'm1', servings: 2 }], mealsById, new Set());
		const withOpt = aggregateIngredients([{ mealId: 'm1', servings: 2 }], mealsById, new Set(), {
			includeOptional: true
		});
		expect(without.map((r) => r.name)).toEqual(['kjøttdeig']);
		expect(withOpt.map((r) => r.name)).toEqual(['rømme', 'kjøttdeig']);
	});
});

describe('mergeShoppingListItems', () => {
	const item = (overrides: Partial<ShoppingListItem> & { name: string }): ShoppingListItem => ({
		id: overrides.name,
		normalizedName: overrides.name.toLowerCase(),
		quantity: null,
		unit: null,
		sources: [],
		checked: false,
		manual: false,
		...overrides
	});

	it('bevarer avhukinger ved regenerering', () => {
		const existing = [item({ name: 'melk', checked: true })];
		const regenerated = [item({ name: 'melk' }), item({ name: 'brød' })];
		const merged = mergeShoppingListItems(existing, regenerated);
		expect(merged.find((i) => i.name === 'melk')?.checked).toBe(true);
		expect(merged.find((i) => i.name === 'brød')?.checked).toBe(false);
	});

	it('beholder manuelle varer som ikke er i den regenererte lista', () => {
		const existing = [item({ name: 'tannkrem', manual: true }), item({ name: 'gjær' })];
		const regenerated = [item({ name: 'melk' })];
		const merged = mergeShoppingListItems(existing, regenerated);
		expect(merged.map((i) => i.name)).toEqual(['melk', 'tannkrem']);
	});
});

describe('toShoppingListItem', () => {
	it('normaliserer navn for kvitteringsmatching', () => {
		const result = toShoppingListItem({ name: 'Kjøttdeig (400 g)', sources: ['Taco'] });
		expect(result.normalizedName).toBe('kjøttdeig');
		expect(result.manual).toBe(false);
		expect(result.id).toBeTruthy();
	});
});
