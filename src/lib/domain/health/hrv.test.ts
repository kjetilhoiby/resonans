import { describe, it, expect } from 'vitest';
import {
	formatHrv,
	HRV_DEVIATION_PCT,
	isPlausibleHrv,
	MIN_BASELINE_NIGHTS,
	parseSleepHrvSeries,
	pickHrvMetric,
	type HrvNight
} from './hrv';

/** Netter med jevn HRV, eldste først. */
function nights(from: string, values: number[]): HrvNight[] {
	const start = new Date(`${from}T00:00:00Z`).getTime();
	return values.map((sdnnMs, i) => ({
		date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
		sdnnMs,
		samples: 300
	}));
}

describe('parseSleepHrvSeries', () => {
	it('tolker segmentserien, som er et OBJEKT nøklet på unix-tid', () => {
		const parsed = parseSleepHrvSeries([
			{ sdnn_1: { '1785700800': 40, '1785700860': 44, '1785700920': 42 } }
		]);
		expect(parsed).toEqual({ sdnnMs: 42, samples: 3 });
	});

	it('slår sammen segmenter, siden Withings deler natta', () => {
		// Ute av senga midt på natta gir to segmenter for samme natt.
		const parsed = parseSleepHrvSeries([
			{ sdnn_1: { '1785700800': 40, '1785700860': 42 } },
			{ sdnn_1: { '1785712000': 44, '1785712060': 46 } }
		]);
		expect(parsed!.samples).toBe(4);
		expect(parsed!.sdnnMs).toBe(43);
	});

	it('tar medianen, ikke snittet', () => {
		// Ett minutt med dårlig sensorfeste skal ikke flytte natta.
		const parsed = parseSleepHrvSeries([
			{ sdnn_1: { a: 40, b: 41, c: 42, d: 43, e: 250 } }
		]);
		// Snittet ville vært 83,2. Medianen er 42.
		expect(parsed!.sdnnMs).toBe(42);
	});

	it('forkaster verdier utenfor millisekundområdet', () => {
		const parsed = parseSleepHrvSeries([{ sdnn_1: { a: 0, b: 40, c: 9999, d: 44 } }]);
		expect(parsed!.samples).toBe(2);
	});

	it('tåler manglende eller rar inndata', () => {
		expect(parseSleepHrvSeries(null)).toBeNull();
		expect(parseSleepHrvSeries([])).toBeNull();
		expect(parseSleepHrvSeries([{ hr: { a: 55 } }])).toBeNull();
		expect(parseSleepHrvSeries([{ sdnn_1: null }])).toBeNull();
		expect(parseSleepHrvSeries('nei')).toBeNull();
		// Serien som array framfor objekt — den formen vi IKKE får, men som ville
		// gitt tomt svar stille om vi antok den.
		expect(parseSleepHrvSeries([{ sdnn_1: [40, 42] }])!.samples).toBe(2);
	});
});

describe('pickHrvMetric', () => {
	it('bruker siste natt, ikke beste', () => {
		// Dette er hele forskjellen fra VO2max og pulsfall: en rekordnatt for tre
		// uker siden sier ingenting om i natt.
		const metric = pickHrvMetric(nights('2026-07-25', [40, 41, 42, 90, 41, 40, 42, 39]));
		expect(metric!.latest).toBe(39);
		expect(metric!.latestDate).toBe('2026-08-01');
	});

	it('regner avvik mot medianen av tidligere netter', () => {
		const metric = pickHrvMetric(nights('2026-07-25', [40, 40, 40, 40, 40, 40, 40, 30]));
		expect(metric!.baseline).toBe(40);
		expect(metric!.baselineNights).toBe(7);
		expect(metric!.deviationPct).toBe(-25);
		expect(metric!.band).toBe('under');
	});

	it('sier «ukjent» før baselinen er lang nok', () => {
		const metric = pickHrvMetric(nights('2026-07-28', [40, 41, 42]));
		expect(metric!.baseline).toBeNull();
		expect(metric!.deviationPct).toBeNull();
		expect(metric!.band).toBe('ukjent');
		// Tallet vises likevel — det er baselinen som mangler, ikke målingen.
		expect(metric!.latest).toBe(42);
		expect(metric!.baselineNights).toBe(2);
	});

	it('treffer grensen for nok netter presist', () => {
		const justEnough = pickHrvMetric(nights('2026-07-01', Array(MIN_BASELINE_NIGHTS + 1).fill(40)));
		expect(justEnough!.baseline).toBe(40);
		const oneShort = pickHrvMetric(nights('2026-07-01', Array(MIN_BASELINE_NIGHTS).fill(40)));
		expect(oneShort!.band).toBe('ukjent');
	});

	it('treffer avviksgrensene presist', () => {
		const base = Array(7).fill(100);
		expect(pickHrvMetric(nights('2026-07-01', [...base, 100 - HRV_DEVIATION_PCT]))!.band).toBe('under');
		expect(pickHrvMetric(nights('2026-07-01', [...base, 100 - HRV_DEVIATION_PCT + 1]))!.band).toBe('normal');
		expect(pickHrvMetric(nights('2026-07-01', [...base, 100 + HRV_DEVIATION_PCT]))!.band).toBe('over');
		expect(pickHrvMetric(nights('2026-07-01', [...base, 100 + HRV_DEVIATION_PCT - 1]))!.band).toBe('normal');
	});

	it('lar en enkelt dårlig natt slippe gjennom som normal støy', () => {
		// 5 % under er innenfor det HRV svinger fra natt til natt.
		const metric = pickHrvMetric(nights('2026-07-01', [...Array(7).fill(40), 38]));
		expect(metric!.band).toBe('normal');
	});

	it('sorterer selv, og lar siste rad vinne per dato', () => {
		const unsorted: HrvNight[] = [
			{ date: '2026-08-01', sdnnMs: 39, samples: 200 },
			{ date: '2026-07-25', sdnnMs: 40, samples: 200 },
			{ date: '2026-08-01', sdnnMs: 45, samples: 400 }
		];
		const metric = pickHrvMetric(unsorted);
		expect(metric!.latestDate).toBe('2026-08-01');
		expect(metric!.latest).toBe(45);
		expect(metric!.nights).toBe(2);
	});

	it('gir null for tom eller ugyldig inndata', () => {
		expect(pickHrvMetric([])).toBeNull();
		expect(pickHrvMetric([{ date: 'i natt', sdnnMs: 40, samples: 10 }])).toBeNull();
		expect(pickHrvMetric([{ date: '2026-08-01', sdnnMs: 0, samples: 10 }])).toBeNull();
	});
});

describe('isPlausibleHrv', () => {
	it('avviser det som ikke er millisekunder', () => {
		expect(isPlausibleHrv(42)).toBe(true);
		expect(isPlausibleHrv(0)).toBe(false);
		expect(isPlausibleHrv(500)).toBe(false);
		expect(isPlausibleHrv('42')).toBe(false);
		expect(isPlausibleHrv(Number.NaN)).toBe(false);
	});
});

describe('formatHrv', () => {
	it('bruker norsk desimaltegn', () => {
		expect(formatHrv(42.5)).toBe('42,5 ms');
	});
});
