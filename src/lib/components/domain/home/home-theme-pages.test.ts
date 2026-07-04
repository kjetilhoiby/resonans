import { describe, it, expect } from 'vitest';
import { buildThemePages, findPriorityBoundaryId, THEMES_PER_PAGE } from './home-theme-pages';
import type { Theme, ThemeKind } from './home-context';

function makeTheme(id: string, kind?: ThemeKind): Theme {
	return { id, name: `Tema ${id}`, emoji: '🔹', kind };
}

function makeThemes(count: number, kind?: ThemeKind, prefix = 't'): Theme[] {
	return Array.from({ length: count }, (_, i) => makeTheme(`${prefix}${i + 1}`, kind));
}

describe('buildThemePages', () => {
	it('gir tom liste uten temaer', () => {
		expect(buildThemePages([])).toEqual([]);
	});

	it('samler inntil seks temaer på én side', () => {
		const pages = buildThemePages(makeThemes(6));
		expect(pages).toHaveLength(1);
		expect(pages[0].kind).toBe('prioritert');
		expect(pages[0].label).toBe('Temaer');
		expect(pages[0].themes).toHaveLength(6);
	});

	it('lar en ferie eller et prosjekt prioriteres inn i topp seks', () => {
		const themes = [
			makeTheme('f1', 'ferie'),
			...makeThemes(4),
			makeTheme('p1', 'prosjekt'),
			...makeThemes(3, undefined, 'u')
		];
		const pages = buildThemePages(themes);
		expect(pages[0].themes.map((t) => t.id)).toEqual(['f1', 't1', 't2', 't3', 't4', 'p1']);
	});

	it('fordeler resten etter side 1 på egne sider per kind', () => {
		const themes = [
			...makeThemes(6),
			makeTheme('u1'),
			makeTheme('f1', 'ferie'),
			makeTheme('p1', 'prosjekt'),
			makeTheme('f2', 'ferie')
		];
		const pages = buildThemePages(themes);
		expect(pages.map((p) => p.kind)).toEqual(['prioritert', 'standard', 'ferie', 'prosjekt']);
		expect(pages[1].label).toBe('Flere temaer');
		expect(pages[1].themes.map((t) => t.id)).toEqual(['u1']);
		expect(pages[2].label).toBe('Ferier & reiser');
		expect(pages[2].themes.map((t) => t.id)).toEqual(['f1', 'f2']);
		expect(pages[3].label).toBe('Prosjekter');
		expect(pages[3].themes.map((t) => t.id)).toEqual(['p1']);
	});

	it('behandler temaer uten kind som standard', () => {
		const pages = buildThemePages([...makeThemes(7), makeTheme('u1', 'standard')]);
		expect(pages).toHaveLength(2);
		expect(pages[1].kind).toBe('standard');
		expect(pages[1].themes.map((t) => t.id)).toEqual(['t7', 'u1']);
	});

	it('chunker ferie-sider også seks og seks', () => {
		const pages = buildThemePages([...makeThemes(6), ...makeThemes(7, 'ferie', 'f')]);
		expect(pages).toHaveLength(3);
		expect(pages[1].themes).toHaveLength(THEMES_PER_PAGE);
		expect(pages[1].label).toBe('Ferier & reiser');
		expect(pages[2].themes.map((t) => t.id)).toEqual(['f7']);
	});

	it('gir unike nøkler per side', () => {
		const pages = buildThemePages([...makeThemes(14), ...makeThemes(2, 'ferie', 'f'), ...makeThemes(2, 'prosjekt', 'p')]);
		const keys = pages.map((p) => p.key);
		expect(new Set(keys).size).toBe(keys.length);
	});
});

describe('findPriorityBoundaryId', () => {
	it('gir null når alle temaer får plass på side 1', () => {
		expect(findPriorityBoundaryId(makeThemes(6))).toBeNull();
		expect(findPriorityBoundaryId([])).toBeNull();
	});

	it('gir id-en til sjette tema når det finnes flere', () => {
		expect(findPriorityBoundaryId(makeThemes(7))).toBe('t6');
	});

	it('teller alle kinds — en ferie i topp seks teller med', () => {
		const themes = [makeTheme('f1', 'ferie'), ...makeThemes(6)];
		expect(findPriorityBoundaryId(themes)).toBe('t5');
	});
});
