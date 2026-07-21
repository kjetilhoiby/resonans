import { describe, it, expect } from 'vitest';
import { normalizeComponentSuggestions } from './lunchbox-component-suggestion';

describe('normalizeComponentSuggestions', () => {
	const parsed = {
		suggestions: [
			{ name: 'Cashewnøtter', kind: 'notter', reason: 'variasjon' },
			{ name: 'Hvitost', kind: 'palegg', reason: 'favoritt' }, // finnes allerede
			{ name: 'Peanøtter', kind: 'notter' }, // allergi
			{ name: 'Melon', kind: 'ukjent' }, // ugyldig kind
			{ name: 'Melon', kind: 'frukt' }, // gyldig
			{ name: 'melon', kind: 'frukt' }, // dublett
			{ kind: 'frukt' } // mangler navn
		]
	};

	it('filtrerer bort eksisterende, allergier, ugyldig kind og dubletter', () => {
		const result = normalizeComponentSuggestions(parsed, {
			existingNames: ['Hvitost'],
			avoid: ['peanøtter']
		});
		const names = result.map((r) => r.name);
		expect(names).toEqual(['Cashewnøtter', 'Melon']);
	});

	it('respekterer kind-filter', () => {
		const result = normalizeComponentSuggestions(parsed, {
			existingNames: [],
			avoid: ['peanøtter'],
			kind: 'frukt'
		});
		expect(result.every((r) => r.kind === 'frukt')).toBe(true);
		expect(result.map((r) => r.name)).toEqual(['Melon']);
	});

	it('respekterer limit', () => {
		const result = normalizeComponentSuggestions(parsed, { existingNames: [], limit: 1 });
		expect(result).toHaveLength(1);
	});

	it('takler bar liste (ikke innpakket i suggestions)', () => {
		const result = normalizeComponentSuggestions([{ name: 'Kiwi', kind: 'frukt' }], { existingNames: [] });
		expect(result).toEqual([{ name: 'Kiwi', kind: 'frukt', tags: [], reason: null }]);
	});

	it('returnerer tom liste for søppel-input', () => {
		expect(normalizeComponentSuggestions(null, { existingNames: [] })).toEqual([]);
		expect(normalizeComponentSuggestions({}, { existingNames: [] })).toEqual([]);
	});
});
