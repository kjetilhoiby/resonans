import { describe, it, expect } from 'vitest';
import {
	compareWeeklyEffort,
	DEFAULT_REPROJECT_WEEKS,
	MAX_REPROJECT_WEEKS,
	MIN_REPROJECT_WEEKS,
	resolveReprojectWindow
} from './reproject-window';

const NOW = new Date('2026-08-10T12:00:00Z');

function windowOf(weeks: unknown) {
	const result = resolveReprojectWindow(weeks, NOW);
	if ('error' in result) throw new Error(result.error);
	return result.window;
}

describe('resolveReprojectWindow', () => {
	it('defaulter til dobbelt ankervindu', () => {
		expect(windowOf(undefined).weeks).toBe(DEFAULT_REPROJECT_WEEKS);
	});

	it('avviser et vindu som er kortere enn ankeret — da er jobben ufullstendig', () => {
		// Poenget: et vindu på 3 uker ser ut som en reberegning, men lar minst én av
		// ankerets fire uker stå på gammel skala. Da sammenlignes to måleenheter.
		const result = resolveReprojectWindow(MIN_REPROJECT_WEEKS - 1, NOW);
		expect('error' in result).toBe(true);
		if ('error' in result) expect(result.error).toContain('siste 4 ukene');
	});

	it('avviser et for stort spenn, og sier hvorfor', () => {
		const result = resolveReprojectWindow(MAX_REPROJECT_WEEKS + 1, NOW);
		expect('error' in result).toBe(true);
		if ('error' in result) expect(result.error).toContain('biter');
	});

	it('avviser tull framfor å tolke det', () => {
		expect('error' in resolveReprojectWindow('åtte', NOW)).toBe(true);
		expect('error' in resolveReprojectWindow(8.5, NOW)).toBe(true);
	});

	it('regner fromDate presist tilbake i uker', () => {
		const w = windowOf(8);
		expect(w.fromDate.toISOString()).toBe('2026-06-15T12:00:00.000Z');
		expect(w.toDate.toISOString()).toBe(NOW.toISOString());
	});
});

describe('compareWeeklyEffort', () => {
	it('viser før, etter og prosentvis endring per uke', () => {
		const rows = compareWeeklyEffort(
			[{ weekStart: '2026-08-03', effort: 513, workouts: 12 }],
			[{ weekStart: '2026-08-03', effort: 435, workouts: 12 }]
		);
		expect(rows).toEqual([
			{ weekStart: '2026-08-03', before: 513, after: 435, deltaPct: -15.2 }
		]);
	});

	it('gir null i deltaPct når det ikke fantes noe å sammenligne med', () => {
		// En uke som gikk fra 0 til 40 har ikke en prosentvis endring, den har et
		// nytt tall. 0 % ville vært en påstand om at ingenting skjedde.
		const rows = compareWeeklyEffort([], [{ weekStart: '2026-08-03', effort: 40, workouts: 1 }]);
		expect(rows[0].deltaPct).toBeNull();
		expect(rows[0].before).toBe(0);
	});

	it('tar med uker som forsvant fra etter-settet', () => {
		const rows = compareWeeklyEffort(
			[{ weekStart: '2026-07-27', effort: 200, workouts: 4 }],
			[]
		);
		expect(rows[0].after).toBe(0);
		expect(rows[0].deltaPct).toBe(-100);
	});

	it('sorterer ukene kronologisk', () => {
		const rows = compareWeeklyEffort(
			[
				{ weekStart: '2026-08-03', effort: 100, workouts: 1 },
				{ weekStart: '2026-07-20', effort: 100, workouts: 1 }
			],
			[]
		);
		expect(rows.map((r) => r.weekStart)).toEqual(['2026-07-20', '2026-08-03']);
	});
});
