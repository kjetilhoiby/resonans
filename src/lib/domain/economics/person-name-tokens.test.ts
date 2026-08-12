import { describe, it, expect } from 'vitest';
import {
	MIN_NAME_TOKEN_LENGTH,
	nameTokensFor,
	nameTokensForAll,
	textMentionsPerson
} from './person-name-tokens';

describe('nameTokensFor', () => {
	it('tar med navn, ordene i fullt navn og aliaser', () => {
		expect(
			nameTokensFor({ name: 'Nils', fullName: 'Nils Grønningsæter Høiby', aliases: ['Nilso'] })
		).toEqual(['nils', 'grønningsæter', 'høiby', 'nilso']);
	});

	// Grunnen konstanten finnes: «Ole» treffer «Olerud», og et fornavn på tre bokstaver
	// treffer halve kontoutskriften.
	it('dropper ord kortere enn terskelen', () => {
		expect(nameTokensFor({ name: 'Ole' })).toEqual([]);
		expect(MIN_NAME_TOKEN_LENGTH).toBe(4);
	});

	it('dedupliserer og senker til små bokstaver', () => {
		expect(nameTokensFor({ name: 'Nils', fullName: 'NILS Hansen', aliases: ['nils'] })).toEqual([
			'nils',
			'hansen'
		]);
	});

	it('tåler manglende fullName og aliases', () => {
		expect(nameTokensFor({ name: 'Kjetil' })).toEqual(['kjetil']);
		expect(nameTokensFor({ name: 'Kjetil', fullName: null, aliases: null })).toEqual(['kjetil']);
	});
});

describe('nameTokensForAll', () => {
	it('flater og dedupliserer på tvers av personer', () => {
		expect(
			nameTokensForAll([
				{ name: 'Nils', fullName: 'Nils Høiby' },
				{ name: 'Sofie', fullName: 'Sofie Høiby' }
			])
		).toEqual(['nils', 'høiby', 'sofie']);
	});

	it('gir tom liste uten personer', () => {
		expect(nameTokensForAll([])).toEqual([]);
	});
});

describe('textMentionsPerson', () => {
	it('treffer navnet i et kontonavn', () => {
		expect(textMentionsPerson('Nils Grønningsæter Høiby SPAREKONTO UNG', ['nils'])).toBe(true);
	});

	it('er ufølsom for store bokstaver', () => {
		expect(textMentionsPerson('SPAREKONTO NILS', ['nils'])).toBe(true);
	});

	it('gir false uten tokens — ikke true', () => {
		// En tom tokenliste betyr «ingen personer registrert», og skal ikke matche alt.
		expect(textMentionsPerson('Sparekonto Ekteskapet', [])).toBe(false);
	});

	it('treffer ikke et navn som ikke står der', () => {
		expect(textMentionsPerson('Sparekonto Ekteskapet', ['nils'])).toBe(false);
	});
});
