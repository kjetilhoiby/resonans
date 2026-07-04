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

	it('samler inntil seks standard-temaer på én side', () => {
		const pages = buildThemePages(makeThemes(6));
		expect(pages).toHaveLength(1);
		expect(pages[0].kind).toBe('standard');
		expect(pages[0].label).toBe('Temaer');
		expect(pages[0].themes).toHaveLength(6);
	});

	it('chunker standard-temaer seks og seks med sortering bevart', () => {
		const pages = buildThemePages(makeThemes(8));
		expect(pages).toHaveLength(2);
		expect(pages[0].themes.map((t) => t.id)).toEqual(['t1', 't2', 't3', 't4', 't5', 't6']);
		expect(pages[1].themes.map((t) => t.id)).toEqual(['t7', 't8']);
		expect(pages[1].label).toBe('Flere temaer');
	});

	it('behandler temaer uten kind som standard', () => {
		const pages = buildThemePages([makeTheme('a'), makeTheme('b', 'standard')]);
		expect(pages).toHaveLength(1);
		expect(pages[0].themes).toHaveLength(2);
	});

	it('gir egne sider for ferier/reiser og prosjekter etter standard-sidene', () => {
		const themes = [
			makeTheme('f1', 'ferie'),
			...makeThemes(3),
			makeTheme('p1', 'prosjekt'),
			makeTheme('f2', 'ferie')
		];
		const pages = buildThemePages(themes);
		expect(pages.map((p) => p.kind)).toEqual(['standard', 'ferie', 'prosjekt']);
		expect(pages[1].label).toBe('Ferier & reiser');
		expect(pages[1].themes.map((t) => t.id)).toEqual(['f1', 'f2']);
		expect(pages[2].label).toBe('Prosjekter');
		expect(pages[2].themes.map((t) => t.id)).toEqual(['p1']);
	});

	it('holder ferie- og prosjekt-temaer unna de prioriterte plassene', () => {
		const themes = [makeTheme('p1', 'prosjekt'), ...makeThemes(6)];
		const pages = buildThemePages(themes);
		expect(pages[0].kind).toBe('standard');
		expect(pages[0].themes.map((t) => t.id)).toEqual(['t1', 't2', 't3', 't4', 't5', 't6']);
	});

	it('chunker ferie-sider også seks og seks', () => {
		const pages = buildThemePages(makeThemes(7, 'ferie', 'f'));
		expect(pages).toHaveLength(2);
		expect(pages[0].themes).toHaveLength(THEMES_PER_PAGE);
		expect(pages.every((p) => p.label === 'Ferier & reiser')).toBe(true);
	});

	it('gir unike nøkler per side', () => {
		const pages = buildThemePages([...makeThemes(8), ...makeThemes(2, 'ferie', 'f')]);
		const keys = pages.map((p) => p.key);
		expect(new Set(keys).size).toBe(keys.length);
	});
});

describe('findPriorityBoundaryId', () => {
	it('gir null når alle standard-temaer får plass på side 1', () => {
		expect(findPriorityBoundaryId(makeThemes(6))).toBeNull();
		expect(findPriorityBoundaryId([])).toBeNull();
	});

	it('gir id-en til sjette standard-tema når det finnes flere', () => {
		expect(findPriorityBoundaryId(makeThemes(7))).toBe('t6');
	});

	it('hopper over ferie- og prosjekt-temaer i tellingen', () => {
		const themes = [
			makeTheme('f1', 'ferie'),
			...makeThemes(5),
			makeTheme('p1', 'prosjekt'),
			...makeThemes(3, undefined, 'u')
		];
		// standard-rekkefølge: t1–t5, u1–u3 → sjette er u1
		expect(findPriorityBoundaryId(themes)).toBe('u1');
	});
});
