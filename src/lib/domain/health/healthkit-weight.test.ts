import { describe, it, expect } from 'vitest';
import {
	dayRange,
	existingDayLookupWindow,
	importWarnings,
	MAX_FAT_RATIO,
	MAX_WEIGHT_KG,
	MIN_FAT_RATIO,
	MIN_WEIGHT_KG,
	parseHealthKitWeightSamples,
	partitionByBlockedDays
} from './healthkit-weight';
import { toWeightMeasurements } from './weight-measurements';

const NOW = new Date('2026-08-09T12:00:00.000Z');

function parse(samples: unknown[]) {
	return parseHealthKitWeightSamples(samples, { now: NOW });
}

describe('parseHealthKitWeightSamples', () => {
	it('leser en full måling', () => {
		const parsed = parse([
			{
				timestamp: '2014-07-01T06:42:00Z',
				weight: 107.5,
				fatRatio: 28.4,
				fatFreeMass: 76.9,
				sourceName: 'Health Mate',
				sourceBundleId: 'com.withings.wiScaleNG',
				uuid: '9C4D2A61'
			}
		]);

		expect(parsed.invalid).toBe(0);
		expect(parsed.samples).toHaveLength(1);
		expect(parsed.samples[0].data).toEqual({ weight: 107.5, fatRatio: 28.4, fatFreeMass: 76.9 });
		expect(parsed.samples[0].metadata).toEqual({
			sourceName: 'Health Mate',
			sourceBundleId: 'com.withings.wiScaleNG',
			healthKitUuid: '9C4D2A61'
		});
	});

	it('bare vekt er nok — muskel, bein og hydrering finnes ikke i HealthKit', () => {
		const parsed = parse([{ timestamp: '2015-03-02T07:00:00Z', weight: 98 }]);

		expect(parsed.samples).toHaveLength(1);
		expect(parsed.samples[0].data).toEqual({ weight: 98 });
	});

	it('bøtter på Oslo-døgn, ikke UTC-døgn', () => {
		// 23:30 UTC om sommeren er 01:30 neste dag i Oslo — den dagen brukeren
		// opplevde, ikke UTC-dagen før.
		const parsed = parse([{ timestamp: '2015-06-14T23:30:00Z', weight: 95 }]);

		expect(parsed.samples[0].day).toBe('2015-06-15');
	});

	describe('fettprosent', () => {
		it('forkaster 0–1-brøken fra HKUnit.percent(), men beholder vekta', () => {
			const parsed = parse([{ timestamp: '2014-07-01T06:42:00Z', weight: 107.5, fatRatio: 0.284 }]);

			expect(parsed.samples).toHaveLength(1);
			expect(parsed.samples[0].data.fatRatio).toBeUndefined();
			expect(parsed.samples[0].data.weight).toBe(107.5);
			expect(parsed.droppedFatRatio).toBe(1);
			expect(parsed.fatRatioLooksLikeFraction).toBe(1);
		});

		it('teller 0 og verdier over taket som droppet, men ikke som brøk', () => {
			const parsed = parse([
				{ timestamp: '2014-07-01T06:00:00Z', weight: 100, fatRatio: 0 },
				{ timestamp: '2014-07-02T06:00:00Z', weight: 100, fatRatio: MAX_FAT_RATIO + 1 }
			]);

			expect(parsed.droppedFatRatio).toBe(2);
			expect(parsed.fatRatioLooksLikeFraction).toBe(0);
		});

		it('godtar grenseverdiene', () => {
			const parsed = parse([
				{ timestamp: '2014-07-01T06:00:00Z', weight: 100, fatRatio: MIN_FAT_RATIO },
				{ timestamp: '2014-07-02T06:00:00Z', weight: 100, fatRatio: MAX_FAT_RATIO }
			]);

			expect(parsed.droppedFatRatio).toBe(0);
			expect(parsed.samples.map((s) => s.data.fatRatio)).toEqual([MIN_FAT_RATIO, MAX_FAT_RATIO]);
		});
	});

	describe('vekt', () => {
		it('forkaster raden utenfor menneskelige grenser', () => {
			const parsed = parse([
				{ timestamp: '2014-07-01T06:00:00Z', weight: MIN_WEIGHT_KG - 1 },
				{ timestamp: '2014-07-02T06:00:00Z', weight: MAX_WEIGHT_KG + 1 },
				// Gram sendt som kilo
				{ timestamp: '2014-07-03T06:00:00Z', weight: 107500 }
			]);

			expect(parsed.samples).toHaveLength(0);
			expect(parsed.invalid).toBe(3);
		});

		it('forkaster rader uten vekt', () => {
			const parsed = parse([
				{ timestamp: '2014-07-01T06:00:00Z' },
				{ timestamp: '2014-07-02T06:00:00Z', weight: null },
				{ timestamp: '2014-07-03T06:00:00Z', weight: '82' }
			]);

			expect(parsed.samples).toHaveLength(0);
			expect(parsed.invalid).toBe(3);
		});
	});

	describe('fettfri masse', () => {
		it('forkaster verdier som overstiger vekta', () => {
			const parsed = parse([
				{ timestamp: '2014-07-01T06:00:00Z', weight: 82, fatFreeMass: 90 }
			]);

			expect(parsed.samples[0].data.fatFreeMass).toBeUndefined();
			expect(parsed.droppedFatFreeMass).toBe(1);
		});

		it('forkaster gram sendt som kilo', () => {
			const parsed = parse([
				{ timestamp: '2014-07-01T06:00:00Z', weight: 82, fatFreeMass: 76900 }
			]);

			expect(parsed.droppedFatFreeMass).toBe(1);
			expect(parsed.samples).toHaveLength(1);
		});
	});

	describe('tidsstempel', () => {
		it('forkaster ugyldige og manglende', () => {
			const parsed = parse([
				{ weight: 82 },
				{ timestamp: 'i går', weight: 82 },
				{ timestamp: null, weight: 82 }
			]);

			expect(parsed.invalid).toBe(3);
		});

		it('forkaster framtida — en telefonklokke kan gå feil', () => {
			const parsed = parse([{ timestamp: '2027-01-01T06:00:00Z', weight: 82 }]);

			expect(parsed.invalid).toBe(1);
		});

		it('tåler et døgns klokkeslark', () => {
			const parsed = parse([{ timestamp: '2026-08-09T20:00:00Z', weight: 82 }]);

			expect(parsed.samples).toHaveLength(1);
		});

		it('forkaster årstall før 1990 — én rad i 1904 strekker hele x-aksen', () => {
			const parsed = parse([{ timestamp: '1904-01-01T00:00:00Z', weight: 82 }]);

			expect(parsed.invalid).toBe(1);
		});
	});

	it('kollapser duplikate tidsstempler og teller dem', () => {
		const parsed = parse([
			{ timestamp: '2014-07-01T06:42:00Z', weight: 107.5 },
			{ timestamp: '2014-07-01T06:42:00Z', weight: 107.6 }
		]);

		expect(parsed.samples).toHaveLength(1);
		expect(parsed.samples[0].data.weight).toBe(107.6);
		expect(parsed.duplicateTimestamps).toBe(1);
	});

	it('sorterer stigende uansett rekkefølge inn', () => {
		const parsed = parse([
			{ timestamp: '2016-01-01T06:00:00Z', weight: 90 },
			{ timestamp: '2014-01-01T06:00:00Z', weight: 100 },
			{ timestamp: '2015-01-01T06:00:00Z', weight: 95 }
		]);

		expect(parsed.samples.map((s) => s.day)).toEqual(['2014-01-01', '2015-01-01', '2016-01-01']);
	});

	it('tåler søppel uten å kaste', () => {
		expect(parse([null, 'nei', 42, []]).invalid).toBe(4);
		expect(parseHealthKitWeightSamples(null).samples).toEqual([]);
		expect(parseHealthKitWeightSamples({ samples: [] }).samples).toEqual([]);
	});

	it('radene leses av den delte vektleseren uten oversetting', () => {
		const parsed = parse([
			{ timestamp: '2014-07-01T06:42:00Z', weight: 107.5, fatRatio: 28.4 }
		]);

		const measurements = toWeightMeasurements(
			parsed.samples.map((s) => ({ timestamp: s.timestamp, data: s.data }))
		);

		expect(measurements).toEqual([
			{
				date: '2014-07-01',
				weightKg: 107.5,
				// Fettmassen utledes av prosenten — feltnavnene er de samme som
				// Withings-radene bruker, så ingen leser må endres.
				fatMassKg: 30.5,
				fatRatio: 28.4,
				muscleMassKg: null,
				fatFreeMassKg: 77
			}
		]);
	});
});

describe('partitionByBlockedDays', () => {
	const samples = parse([
		{ timestamp: '2017-10-12T06:00:00Z', weight: 100 },
		{ timestamp: '2017-10-13T06:00:00Z', weight: 100.2 },
		{ timestamp: '2017-10-13T18:00:00Z', weight: 100.4 }
	]).samples;

	it('hopper over hele dagen når en annen sensor har målt der', () => {
		const partition = partitionByBlockedDays(samples, new Set(['2017-10-13']));

		expect(partition.write.map((s) => s.day)).toEqual(['2017-10-12']);
		expect(partition.skippedExistingDay).toBe(2);
	});

	it('skriver alt når ingen dager er tatt', () => {
		const partition = partitionByBlockedDays(samples, new Set());

		expect(partition.write).toHaveLength(3);
		expect(partition.skippedExistingDay).toBe(0);
	});
});

describe('existingDayLookupWindow', () => {
	it('padder et døgn i hver ende — Oslo-døgnet krysser UTC-midnatt', () => {
		const samples = parse([
			{ timestamp: '2015-06-10T12:00:00Z', weight: 95 },
			{ timestamp: '2015-06-20T12:00:00Z', weight: 96 }
		]).samples;

		const window = existingDayLookupWindow(samples)!;

		expect(window.from.toISOString()).toBe('2015-06-09T12:00:00.000Z');
		expect(window.to.toISOString()).toBe('2015-06-21T12:00:00.000Z');
	});

	it('er null for en tom bolk', () => {
		expect(existingDayLookupWindow([])).toBeNull();
	});
});

describe('dayRange', () => {
	it('rapporterer spennet i Oslo-døgn', () => {
		const samples = parse([
			{ timestamp: '2013-12-08T09:00:00Z', weight: 110 },
			{ timestamp: '2017-10-12T09:00:00Z', weight: 100 }
		]).samples;

		expect(dayRange(samples)).toEqual({ oldest: '2013-12-08', newest: '2017-10-12' });
	});

	it('er null når ingenting ble skrevet', () => {
		expect(dayRange([])).toBeNull();
	});
});

describe('importWarnings', () => {
	it('sier hva brøkfella er, ikke bare at noe manglet', () => {
		const parsed = parse([{ timestamp: '2014-07-01T06:00:00Z', weight: 100, fatRatio: 0.284 }]);

		expect(importWarnings(parsed)).toMatchInlineSnapshot(`
			[
			  "1 målinger hadde fettprosent under 1 — HKUnit.percent() gir 0,223 for 22,3 %, så verdien må ganges med 100. Vekta ble lagret, fettprosenten ikke.",
			]
		`);
	});

	it('tier når alt gikk bra', () => {
		const parsed = parse([{ timestamp: '2014-07-01T06:00:00Z', weight: 100 }]);

		expect(importWarnings(parsed)).toEqual([]);
	});

	it('skiller brøken fra andre forkastede fettprosenter', () => {
		const parsed = parse([
			{ timestamp: '2014-07-01T06:00:00Z', weight: 100, fatRatio: 0.284 },
			{ timestamp: '2014-07-02T06:00:00Z', weight: 100, fatRatio: 99 }
		]);

		const warnings = importWarnings(parsed);

		expect(warnings).toHaveLength(2);
		expect(warnings[0]).toContain('HKUnit.percent()');
		expect(warnings[1]).toContain('utenfor 1–75');
	});
});
