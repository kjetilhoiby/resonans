import { describe, it, expect } from 'vitest';
import {
	formatVo2max,
	isPlausibleVo2max,
	pickVo2maxMetric,
	rollingBestVo2max,
	vo2maxBand,
	type Vo2maxSample
} from './vo2max';

function sample(overrides: Partial<Vo2maxSample> = {}): Vo2maxSample {
	return {
		value: 50,
		at: '2026-08-01T10:00:00.000Z',
		source: 'best_efforts',
		sourceDistance: '10k',
		...overrides
	};
}

describe('isPlausibleVo2max', () => {
	it('godtar menneskelige verdier', () => {
		expect(isPlausibleVo2max(35)).toBe(true);
		expect(isPlausibleVo2max(15)).toBe(true);
		expect(isPlausibleVo2max(90)).toBe(true);
	});

	it('avviser det som må være noe annet enn VO2max', () => {
		// Vakten finnes fordi vi ikke er sikre på at Withings' meastype 123 ER
		// VO2max — kommer det blodtrykk eller millisekunder, skal det ikke lagres.
		expect(isPlausibleVo2max(0)).toBe(false);
		expect(isPlausibleVo2max(14.9)).toBe(false);
		expect(isPlausibleVo2max(120)).toBe(false);
		expect(isPlausibleVo2max('50')).toBe(false);
		expect(isPlausibleVo2max(null)).toBe(false);
		expect(isPlausibleVo2max(NaN)).toBe(false);
		expect(isPlausibleVo2max(Infinity)).toBe(false);
	});
});

describe('pickVo2maxMetric', () => {
	it('tar beste, ikke snittet', () => {
		// En hard 5k og fire rolige turer: snittet er meningsløst, maksimum er
		// et gulv — «formen din er minst dette».
		const metric = pickVo2maxMetric([
			sample({ value: 52, at: '2026-08-01T10:00:00.000Z' }),
			sample({ value: 38, at: '2026-08-02T10:00:00.000Z' }),
			sample({ value: 36, at: '2026-08-03T10:00:00.000Z' })
		]);
		expect(metric!.best).toBe(52);
		expect(metric!.samples).toBe(3);
	});

	it('skiller «beste» fra «siste»', () => {
		const metric = pickVo2maxMetric([
			sample({ value: 52, at: '2026-08-01T10:00:00.000Z' }),
			sample({ value: 38, at: '2026-08-05T10:00:00.000Z' })
		]);
		expect(metric!.best).toBe(52);
		expect(metric!.latest).toBe(38);
		expect(metric!.bestAt).toBe('2026-08-01T10:00:00.000Z');
	});

	it('lar Withings-målinger vinne over estimater, uten å blande dem', () => {
		// Et snitt av en måling og et estimat er ingen av dem.
		const metric = pickVo2maxMetric([
			sample({ value: 60, source: 'best_efforts' }),
			sample({ value: 48, source: 'withings', sourceDistance: undefined })
		]);
		expect(metric!.source).toBe('withings');
		expect(metric!.best).toBe(48);
		expect(metric!.samples).toBe(1);
		expect(metric!.confidence).toBe(0.85);
	});

	it('straffer korte distanser i konfidensen', () => {
		// 3k lener seg mer på anaerob kapasitet enn på VO2max.
		expect(pickVo2maxMetric([sample({ sourceDistance: '10k' })])!.confidence).toBe(0.7);
		expect(pickVo2maxMetric([sample({ sourceDistance: '5k' })])!.confidence).toBe(0.65);
		expect(pickVo2maxMetric([sample({ sourceDistance: '3k' })])!.confidence).toBe(0.55);
	});

	it('tar med sourceDistance fra den beste observasjonen', () => {
		const metric = pickVo2maxMetric([
			sample({ value: 45, sourceDistance: '3k' }),
			sample({ value: 52, sourceDistance: '10k', at: '2026-08-02T10:00:00.000Z' })
		]);
		expect(metric!.sourceDistance).toBe('10k');
		expect(metric!.confidence).toBe(0.7);
	});

	it('filtrerer bort uplausible verdier før valget', () => {
		const metric = pickVo2maxMetric([sample({ value: 250 }), sample({ value: 48, at: '2026-08-02T10:00:00.000Z' })]);
		expect(metric!.best).toBe(48);
		expect(metric!.samples).toBe(1);
	});

	it('gir null når ingenting er brukbart', () => {
		// Kallstedet skal da la feltet stå tomt, som metrics.weight.
		expect(pickVo2maxMetric([])).toBeNull();
		expect(pickVo2maxMetric([sample({ value: 0 }), sample({ value: 500 })])).toBeNull();
	});

	it('runder til én desimal', () => {
		expect(pickVo2maxMetric([sample({ value: 52.4567 })])!.best).toBe(52.5);
	});
});

describe('rollingBestVo2max', () => {
	function period(periodKey: string, best: number | null) {
		return {
			periodKey,
			metric:
				best === null
					? null
					: {
							best,
							latest: best,
							source: 'best_efforts' as const,
							confidence: 0.7,
							samples: 1,
							bestAt: `${periodKey}-01T10:00:00.000Z`
						}
		};
	}

	it('finner beste innenfor vinduet', () => {
		// En uke uten hard løping skal ikke se ut som et formfall.
		const result = rollingBestVo2max([
			period('2026W28', 50),
			period('2026W29', null),
			period('2026W30', 38),
			period('2026W31', null)
		]);
		expect(result!.value).toBe(50);
		expect(result!.periodKey).toBe('2026W28');
	});

	it('ser bare på de siste periodene', () => {
		// Et estimat fra i fjor er ikke formen din nå.
		const periods = [period('2026W01', 60), ...Array.from({ length: 10 }, (_, i) => period(`2026W${10 + i}`, 45))];
		const result = rollingBestVo2max(periods, 8);
		expect(result!.value).toBe(45);
	});

	it('respekterer vindusstørrelsen', () => {
		const periods = [period('2026W20', 55), period('2026W21', 40), period('2026W22', 41)];
		expect(rollingBestVo2max(periods, 2)!.value).toBe(41);
		expect(rollingBestVo2max(periods, 3)!.value).toBe(55);
	});

	it('gir null når ingen periode i vinduet har data', () => {
		expect(rollingBestVo2max([])).toBeNull();
		expect(rollingBestVo2max([period('2026W30', null)])).toBeNull();
	});

	it('beholder hele metrikken, ikke bare tallet', () => {
		const result = rollingBestVo2max([period('2026W30', 52)]);
		expect(result!.metric.source).toBe('best_efforts');
		expect(result!.metric.confidence).toBe(0.7);
	});
});

describe('formatVo2max', () => {
	it('bruker norsk desimaltegn og enhet', () => {
		expect(formatVo2max(52.44)).toBe('52,4 ml/kg/min');
	});
});

describe('vo2maxBand', () => {
	it('deler i fire vide kategorier', () => {
		expect(vo2maxBand(30)).toBe('lav');
		expect(vo2maxBand(40)).toBe('moderat');
		expect(vo2maxBand(50)).toBe('god');
		expect(vo2maxBand(60)).toBe('svært god');
	});

	it('treffer grensene', () => {
		expect(vo2maxBand(34.9)).toBe('lav');
		expect(vo2maxBand(35)).toBe('moderat');
		expect(vo2maxBand(45)).toBe('god');
		expect(vo2maxBand(55)).toBe('svært god');
	});
});
