import { describe, it, expect } from 'vitest';
import { isSelfParented, resolveParentThemeId } from './theme-hierarchy';

const HELSE = { id: 'helse-id', name: 'Helse' };

describe('resolveParentThemeId', () => {
	it('gir forelderens id for et ekte undertema', () => {
		const trening = { id: 'trening-id', name: 'Trening', parentTheme: 'Helse' };
		expect(resolveParentThemeId(trening, HELSE)).toBe('helse-id');
	});

	it('avviser selvløkka som gjorde tittelklikket dødt', () => {
		// Prod-tilstanden: Helse med parentTheme='Helse'. Tittelen er
		// tilbakeknappen, så den pekte til samme side og gjorde ingenting.
		const selfParented = { id: 'helse-id', name: 'Helse', parentTheme: 'Helse' };
		expect(resolveParentThemeId(selfParented, HELSE)).toBeNull();
	});

	it('avviser også når id-ene er ulike men navnet er sitt eget', () => {
		// Hierarkiet bæres av navnet, så en «forelder» med samme navn er like
		// sirkulær selv om raden er en annen.
		const duplicate = { id: 'helse-id', name: 'Helse', parentTheme: 'Helse' };
		expect(resolveParentThemeId(duplicate, { id: 'annen-rad', name: 'Helse' })).toBeNull();
	});

	it('gir null for toppnivå', () => {
		expect(resolveParentThemeId({ id: 'a', name: 'Helse' }, null)).toBeNull();
		expect(resolveParentThemeId({ id: 'a', name: 'Helse', parentTheme: null }, HELSE)).toBeNull();
		expect(resolveParentThemeId({ id: 'a', name: 'Helse', parentTheme: '' }, HELSE)).toBeNull();
	});

	it('gir null når forelderen ikke finnes som rad', () => {
		// parentTheme er fritekst — «Hjem» uten et Hjem-tema er lovlig.
		const project = { id: 'p', name: 'Bad', parentTheme: 'Hjem' };
		expect(resolveParentThemeId(project, null)).toBeNull();
	});
});

describe('isSelfParented', () => {
	it('kjenner igjen selvløkka', () => {
		expect(isSelfParented({ name: 'Helse', parentTheme: 'Helse' })).toBe(true);
	});

	it('lar ekte forhold og toppnivå passere', () => {
		expect(isSelfParented({ name: 'Trening', parentTheme: 'Helse' })).toBe(false);
		expect(isSelfParented({ name: 'Helse', parentTheme: null })).toBe(false);
		expect(isSelfParented({ name: 'Helse' })).toBe(false);
	});
});
