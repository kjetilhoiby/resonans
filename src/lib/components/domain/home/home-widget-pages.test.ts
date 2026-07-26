import { describe, it, expect } from 'vitest';
import { buildWidgetPages, chunkWidgets, WIDGETS_PER_PAGE, STREAKS_PER_PAGE } from './home-data';

/** Kortnavn så forventningene blir lesbare: 'w1' = widget, 's1' = streak. */
const w = (n: number) => `w${n}`;
const s = (n: number) => `s${n}`;
const widgets = (count: number) => Array.from({ length: count }, (_, i) => w(i + 1));
const streaks = (count: number) => Array.from({ length: count }, (_, i) => s(i + 1));

describe('chunkWidgets', () => {
	it('gir én tom side for tom input', () => {
		expect(chunkWidgets([], 6)).toEqual([[]]);
	});

	it('deler i sider av oppgitt størrelse', () => {
		expect(chunkWidgets(widgets(8), 6)).toEqual([
			['w1', 'w2', 'w3', 'w4', 'w5', 'w6'],
			['w7', 'w8']
		]);
	});
});

describe('buildWidgetPages', () => {
	it('gir streaks sin egen side i stedet for å blande dem inn på en halvfull widget-side', () => {
		const pages = buildWidgetPages(widgets(4), streaks(2), 6, 3);
		expect(pages).toEqual([
			['w1', 'w2', 'w3', 'w4'],
			['s1', 's2']
		]);
	});

	it('legger streak-sidene til slutt', () => {
		const pages = buildWidgetPages(widgets(7), streaks(1), 6, 3);
		expect(pages).toEqual([['w1', 'w2', 'w3', 'w4', 'w5', 'w6'], ['w7'], ['s1']]);
	});

	it('chunker mange streaks over flere sider', () => {
		const pages = buildWidgetPages(widgets(6), streaks(8), 6, 6);
		expect(pages).toHaveLength(3);
		expect(pages[1]).toEqual(['s1', 's2', 's3', 's4', 's5', 's6']);
		expect(pages[2]).toEqual(['s7', 's8']);
	});

	it('bruker en egen, lavere sidestørrelse for streaks', () => {
		// Streak-kortene er brede rader, så det er plass til færre per side.
		const pages = buildWidgetPages(widgets(6), streaks(4), 6, 3);
		expect(pages).toEqual([
			['w1', 'w2', 'w3', 'w4', 'w5', 'w6'],
			['s1', 's2', 's3'],
			['s4']
		]);
	});

	it('faller tilbake på STREAKS_PER_PAGE som standard', () => {
		const pages = buildWidgetPages([], streaks(STREAKS_PER_PAGE + 1));
		expect(pages).toHaveLength(2);
		expect(pages[0]).toHaveLength(STREAKS_PER_PAGE);
	});

	it('er uendret fra dagens oppførsel uten streaks', () => {
		expect(buildWidgetPages(widgets(8), [], 6)).toEqual(chunkWidgets(widgets(8), 6));
	});

	it('gir én tom side når alt er tomt', () => {
		expect(buildWidgetPages([], [], 6)).toEqual([[]]);
	});

	it('dropper den tomme widget-siden når det bare finnes streaks', () => {
		expect(buildWidgetPages([], streaks(2), 6, 3)).toEqual([['s1', 's2']]);
	});

	it('bruker WIDGETS_PER_PAGE som standard', () => {
		const pages = buildWidgetPages(widgets(WIDGETS_PER_PAGE + 1), []);
		expect(pages).toHaveLength(2);
	});
});
