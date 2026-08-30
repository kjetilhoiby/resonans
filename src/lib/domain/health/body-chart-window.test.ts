import { describe, it, expect } from 'vitest';
import { sharedChartWindow, clipToWindow, xInWindow } from './body-chart-window';
import { dayNumber } from './trailing-trend';

function d(iso: string) {
	return { date: iso };
}

describe('sharedChartWindow', () => {
	it('ankrer på den seneste målingen på tvers av seriene', () => {
		/**
		 * Regresjonen dette hindrer: vekta måles daglig og livvidda ukentlig, så
		 * hver serie har sin egen siste måling. Regnet hver for seg blir «90 dager»
		 * to ulike 90 dager, panelene forskyves, og sammenligningen blir feil på en
		 * måte som ser riktig ut.
		 */
		const weight = ['2026-05-01', '2026-08-12'];
		const waist = ['2026-02-24', '2026-08-05'];
		const window = sharedChartWindow([weight, waist], 90)!;
		expect(window.lastDay).toBe(dayNumber('2026-08-12'));
		expect(window.firstDay).toBe(dayNumber('2026-08-12') - 90);
	});

	it('dekker hele spennet når perioden er «alt»', () => {
		const window = sharedChartWindow([['2026-05-01'], ['2013-12-08', '2026-08-05']], null)!;
		expect(window.firstDay).toBe(dayNumber('2013-12-08'));
		expect(window.lastDay).toBe(dayNumber('2026-08-05'));
	});

	it('klipper ikke bort data som er nyere enn perioden krever', () => {
		// Historikken er kortere enn perioden: vinduet skal starte på første
		// måling, ikke på en dato uten data.
		const window = sharedChartWindow([['2026-08-01', '2026-08-12']], 365)!;
		expect(window.firstDay).toBe(dayNumber('2026-08-01'));
	});

	it('gir null når ingen av seriene har en måling', () => {
		expect(sharedChartWindow([[], []], 90)).toBeNull();
		expect(sharedChartWindow([], null)).toBeNull();
	});

	it('forkaster datoer som ikke er datoer', () => {
		expect(sharedChartWindow([['i går', 'tja']], 90)).toBeNull();
	});

	it('gir bredde til et enkelt målepunkt framfor å dele på null', () => {
		const window = sharedChartWindow([['2026-08-12']], 90)!;
		expect(window.lastDay).toBeGreaterThan(window.firstDay);
	});
});

describe('clipToWindow', () => {
	const window = sharedChartWindow([['2026-05-14', '2026-08-12']], 90)!;

	it('beholder punktene i vinduet og kaster resten', () => {
		const clipped = clipToWindow(
			[d('2026-01-01'), d('2026-06-01'), d('2026-08-12')],
			window
		);
		expect(clipped.map((p) => p.date)).toEqual(['2026-06-01', '2026-08-12']);
	});

	it('gir tom liste uten vindu', () => {
		expect(clipToWindow([d('2026-06-01')], null)).toEqual([]);
	});
});

describe('xInWindow', () => {
	const window = sharedChartWindow([['2026-01-01', '2026-01-11']], null)!;
	const geometry = { padLeft: 30, innerWidth: 100 };

	it('plasserer kantene på kantene', () => {
		expect(xInWindow('2026-01-01', window, geometry)).toBe(30);
		expect(xInWindow('2026-01-11', window, geometry)).toBe(130);
	});

	it('er tidsproporsjonal, ikke indeksbasert', () => {
		// Halvveis i tid skal være halvveis i bredden, uansett hvor mange
		// målinger som ligger imellom.
		expect(xInWindow('2026-01-06', window, geometry)).toBe(80);
	});

	it('gir samme piksel for samme dato i to ulike serier', () => {
		// Dette er hele poenget med et delt vindu.
		const a = xInWindow('2026-01-06', window, geometry);
		const b = xInWindow('2026-01-06', window, geometry);
		expect(a).toBe(b);
	});
});
