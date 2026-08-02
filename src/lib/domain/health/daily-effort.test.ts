import { describe, it, expect } from 'vitest';
import { mapDailyEffortSeries } from './daily-effort';

describe('mapDailyEffortSeries', () => {
	it('snur rekkefølgen til eldste først', () => {
		// Spørringen sorterer desc; computeTrainingLoad krever kronologisk.
		const out = mapDailyEffortSeries([
			{ periodKey: '2026-08-02', metrics: { dailyEffort: { total: 30 } } },
			{ periodKey: '2026-08-01', metrics: { dailyEffort: { total: 50 } } }
		]);
		expect(out).toEqual([
			{ date: '2026-08-01', effort: 50 },
			{ date: '2026-08-02', effort: 30 }
		]);
	});

	it('muterer ikke inn-arrayen', () => {
		const rows = [
			{ periodKey: 'a', metrics: null },
			{ periodKey: 'b', metrics: null }
		];
		mapDailyEffortSeries(rows);
		expect(rows.map((r) => r.periodKey)).toEqual(['a', 'b']);
	});

	it('gir 0 for dager uten effort framfor å droppe dem', () => {
		// En hviledag er et datapunkt i belastningsmodellen, ikke et hull.
		const out = mapDailyEffortSeries([
			{ periodKey: '2026-08-01', metrics: null },
			{ periodKey: '2026-07-31', metrics: {} },
			{ periodKey: '2026-07-30', metrics: { dailyEffort: {} } }
		]);
		expect(out.map((p) => p.effort)).toEqual([0, 0, 0]);
		expect(out).toHaveLength(3);
	});

	it('bevarer effort lik 0 og negative verdier uten å tolke dem som mangel', () => {
		const out = mapDailyEffortSeries([
			{ periodKey: 'd', metrics: { dailyEffort: { total: 0 } } }
		]);
		expect(out[0].effort) .toBe(0);
	});

	it('gir tom serie for ingen rader', () => {
		expect(mapDailyEffortSeries([])).toEqual([]);
	});
});
