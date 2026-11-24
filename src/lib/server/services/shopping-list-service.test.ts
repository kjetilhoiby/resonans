import { describe, it, expect } from 'vitest';
import {
	mergeShoppingListItems,
	toShoppingListItem,
	type ShoppingListItem
} from './shopping-list-service';

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

describe('toShoppingListItem med usikker beholdning', () => {
	it('bærer usikkerheten og forklaringen videre til lista', () => {
		const item = toShoppingListItem({ name: 'Ris', sources: ['Curry'], uncertain: true, note: 'Trolig nok hjemme' });
		expect(item.uncertain).toBe(true);
		expect(item.note).toBe('Trolig nok hjemme');
	});

	it('en sikker vare får ingen usikkerhetsfelt', () => {
		const item = toShoppingListItem({ name: 'Ris', sources: ['Curry'] });
		expect('uncertain' in item).toBe(false);
	});
});
