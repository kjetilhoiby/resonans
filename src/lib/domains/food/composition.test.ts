import { describe, it, expect } from 'vitest';
import {
	normalizeComponent,
	componentLabel,
	isComposed,
	composedTitle,
	generateVariants
} from './composition';

describe('normalizeComponent', () => {
	it('mapper kjent nøkkel til seg selv', () => {
		expect(normalizeComponent('protein', 'kylling')).toBe('kylling');
	});

	it('mapper synonym til kanonisk nøkkel', () => {
		expect(normalizeComponent('protein', 'Laks')).toBe('fisk');
		expect(normalizeComponent('carb', 'spaghetti')).toBe('pasta');
		expect(normalizeComponent('greens', 'brokkoli')).toBe('kokte-gronnsaker');
	});

	it('matcher synonym som delstreng i lengre fritekst', () => {
		expect(normalizeComponent('protein', 'grillet kyllingfilet')).toBe('kylling');
	});

	it('beholder ukjent verdi som trimmet lowercase', () => {
		expect(normalizeComponent('protein', '  Reinsdyr ')).toBe('reinsdyr');
	});

	it('returnerer null for tom input', () => {
		expect(normalizeComponent('carb', '')).toBeNull();
		expect(normalizeComponent('carb', null)).toBeNull();
	});
});

describe('componentLabel', () => {
	it('gir visningsetikett for kjent nøkkel', () => {
		expect(componentLabel('protein', 'torsk')).toBe('Torsk');
	});

	it('tittel-caser ukjente nøkler', () => {
		expect(componentLabel('protein', 'reinsdyr')).toBe('Reinsdyr');
	});

	it('returnerer null for tom nøkkel', () => {
		expect(componentLabel('greens', null)).toBeNull();
	});
});

describe('isComposed', () => {
	it('er komponert med både protein og karbo', () => {
		expect(isComposed({ mainProtein: 'kylling', mainCarb: 'ris' })).toBe(true);
	});

	it('er ikke komponert uten karbo (f.eks. suppe)', () => {
		expect(isComposed({ mainProtein: 'kylling' })).toBe(false);
		expect(isComposed({})).toBe(false);
	});
});

describe('composedTitle', () => {
	it('bygger tittel med grønt', () => {
		expect(composedTitle({ mainProtein: 'kylling', mainCarb: 'ris', greens: 'kokte-gronnsaker' })).toBe(
			'Kylling med ris og kokte grønnsaker'
		);
	});

	it('bygger tittel uten grønt', () => {
		expect(composedTitle({ mainProtein: 'torsk', mainCarb: 'potet' })).toBe('Torsk med potet');
	});
});

describe('generateVariants', () => {
	const repertoar = [
		{ mainProtein: 'kylling', mainCarb: 'ris', greens: 'kokte-gronnsaker' },
		{ mainProtein: 'torsk', mainCarb: 'potet', greens: 'kokte-gronnsaker' },
		{ mainProtein: 'kjott', mainCarb: 'pasta', greens: 'salat' }
	];

	it('lager kombinasjoner som ikke finnes i repertoaret', () => {
		const variants = generateVariants({ meals: repertoar, seed: 'test' });
		expect(variants.length).toBeGreaterThan(0);
		const existing = new Set(['kylling|ris|kokte-gronnsaker', 'torsk|potet|kokte-gronnsaker', 'kjott|pasta|salat']);
		for (const v of variants) {
			expect(existing.has(`${v.mainProtein}|${v.mainCarb}|${v.greens ?? ''}`)).toBe(false);
		}
	});

	it('er deterministisk gitt samme seed', () => {
		const a = generateVariants({ meals: repertoar, seed: 'uke-31' });
		const b = generateVariants({ meals: repertoar, seed: 'uke-31' });
		expect(a).toEqual(b);
	});

	it('varierer med ulik seed', () => {
		const a = generateVariants({ meals: repertoar, seed: 'uke-31' });
		const b = generateVariants({ meals: repertoar, seed: 'uke-32' });
		expect(a).not.toEqual(b);
	});

	it('respekterer limit', () => {
		const variants = generateVariants({ meals: repertoar, seed: 'test', limit: 2 });
		expect(variants.length).toBeLessThanOrEqual(2);
	});

	it('gir tom liste når ingen retter er komponerte', () => {
		expect(generateVariants({ meals: [{ mainProtein: 'kylling' }], seed: 'x' })).toEqual([]);
	});

	it('foreslår også varianter uten grønt når repertoaret har grønt', () => {
		const variants = generateVariants({ meals: repertoar, seed: 'test', limit: 50 });
		expect(variants.some((v) => v.greens === null)).toBe(true);
	});
});
