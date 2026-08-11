import { describe, it, expect } from 'vitest';
import {
	parseHealthKitWaistSamples,
	waistImportWarnings,
	waistDayRange,
	MIN_WAIST_TIMESTAMP
} from './healthkit-waist';

const NOW = new Date('2026-08-11T12:00:00.000Z');

function sample(overrides: Record<string, unknown> = {}) {
	return {
		timestamp: '2014-07-01T06:42:00.000Z',
		waistCm: 104,
		sourceName: 'Weight Guru',
		sourceBundleId: 'com.example.wg',
		uuid: '9C4D2A61',
		...overrides
	};
}

function parse(raw: unknown) {
	return parseHealthKitWaistSamples(raw, { now: NOW });
}

describe('parseHealthKitWaistSamples', () => {
	it('tar imot en gyldig måling med kilde og uuid', () => {
		const parsed = parse([sample()]);
		expect(parsed.samples).toHaveLength(1);
		expect(parsed.samples[0].data.waistCm).toBe(104);
		expect(parsed.samples[0].metadata.sourceName).toBe('Weight Guru');
		expect(parsed.samples[0].metadata.healthKitUuid).toBe('9C4D2A61');
	});

	it('setter Oslo-døgnet, ikke UTC-døgnet', () => {
		// 00:30 norsk tid er 22:30 UTC dagen før. Trenden grupperer på Oslo.
		const parsed = parse([sample({ timestamp: '2014-06-30T22:30:00.000Z' })]);
		expect(parsed.samples[0].day).toBe('2014-07-01');
	});

	it('runder til én desimal', () => {
		expect(parse([sample({ waistCm: 103.94 })]).samples[0].data.waistCm).toBe(103.9);
	});

	it('sorterer stigende uansett rekkefølge inn', () => {
		const parsed = parse([
			sample({ timestamp: '2016-01-01T08:00:00.000Z' }),
			sample({ timestamp: '2014-01-01T08:00:00.000Z' }),
			sample({ timestamp: '2015-01-01T08:00:00.000Z' })
		]);
		expect(parsed.samples.map((s) => s.day)).toEqual([
			'2014-01-01',
			'2015-01-01',
			'2016-01-01'
		]);
	});

	it('tar imot en ti år gammel måling — det er hele poenget', () => {
		const parsed = parse([sample({ timestamp: '2013-12-08T07:00:00.000Z' })]);
		expect(parsed.samples).toHaveLength(1);
	});

	it('forkaster meter framfor å konvertere', () => {
		// HKUnit.meter() gir 0,94. Å gange med 100 ville gjort en gjetning til en
		// måling, og feilen på appsiden ville aldri blitt rettet.
		const parsed = parse([sample({ waistCm: 0.94 })]);
		expect(parsed.samples).toHaveLength(0);
		expect(parsed.looksLikeMeters).toBe(1);
		expect(parsed.invalid).toBe(1);
	});

	it('forkaster tommer under cm-gulvet og flagger dem', () => {
		const parsed = parse([sample({ waistCm: 37 })]);
		expect(parsed.samples).toHaveLength(0);
		expect(parsed.looksLikeInches).toBe(1);
	});

	it('kan ikke skille tommer over 40 fra centimeter — og det skal stå i kontrakten', () => {
		// 41 tommer er 104 cm, men 41 er også et gyldig cm-tall. Tvetydigheten er
		// uunngåelig; testen finnes for at ingen skal tro vakten dekker alt.
		const parsed = parse([sample({ waistCm: 41 })]);
		expect(parsed.samples).toHaveLength(1);
		expect(parsed.looksLikeInches).toBe(0);
	});

	it('forkaster en livvidde over menneskelig spenn', () => {
		const parsed = parse([sample({ waistCm: 400 })]);
		expect(parsed.samples).toHaveLength(0);
		expect(parsed.looksLikeMeters).toBe(0);
		expect(parsed.looksLikeInches).toBe(0);
	});

	it('forkaster tidsstempler før gulvet og langt fram i tid', () => {
		const parsed = parse([
			sample({ timestamp: '1970-01-01T00:00:00.000Z' }),
			sample({ timestamp: '2027-01-01T00:00:00.000Z' }),
			sample({ timestamp: 'i går' })
		]);
		expect(parsed.samples).toHaveLength(0);
		expect(parsed.invalidTimestamp).toBe(3);
	});

	it('godtar et døgn klokkeslag foran oss', () => {
		// Telefonens klokke kan ligge foran. Et døgn er ikke en feil.
		const parsed = parse([sample({ timestamp: '2026-08-11T20:00:00.000Z' })]);
		expect(parsed.samples).toHaveLength(1);
	});

	it('fjerner duplikater med samme tidsstempel i bolken', () => {
		const parsed = parse([sample(), sample({ waistCm: 104.2 })]);
		expect(parsed.samples).toHaveLength(1);
		expect(parsed.duplicateTimestamps).toBe(1);
	});

	it('tåler tull i lista uten å velte', () => {
		const parsed = parse([null, 'nei', 42, sample()]);
		expect(parsed.samples).toHaveLength(1);
		expect(parsed.invalid).toBe(3);
	});

	it('gir et tomt resultat for noe som ikke er en liste', () => {
		expect(parse({ samples: [] }).samples).toHaveLength(0);
		expect(parse(null).samples).toHaveLength(0);
	});

	it('har et gulv på 1990', () => {
		expect(MIN_WAIST_TIMESTAMP.getUTCFullYear()).toBe(1990);
	});
});

describe('waistImportWarnings', () => {
	it('navngir rettelsen for meter', () => {
		const warnings = waistImportWarnings(parse([sample({ waistCm: 0.94 })]));
		expect(warnings.join(' ')).toContain('meterUnit(with: .centi)');
		expect(warnings.join(' ')).toContain('METER');
	});

	it('sier at tommer-vakten ikke dekker alt', () => {
		const warnings = waistImportWarnings(parse([sample({ waistCm: 37 })]));
		expect(warnings.join(' ')).toContain('kan ikke skilles fra centimeter');
	});

	it('teller ikke en enhetsfeil to ganger', () => {
		// «utenfor spennet» skal ikke gjenta det meter-advarselen alt har sagt.
		const warnings = waistImportWarnings(parse([sample({ waistCm: 0.94 })]));
		expect(warnings.filter((w) => w.includes('ble forkastet')).length).toBe(1);
	});

	it('holder kjeft når alt gikk gjennom', () => {
		expect(waistImportWarnings(parse([sample()]))).toEqual([]);
	});

	it('sier fra om duplikater', () => {
		const warnings = waistImportWarnings(parse([sample(), sample()]));
		expect(warnings.join(' ')).toContain('delte tidsstempel');
	});
});

describe('waistDayRange', () => {
	it('gir eldste og nyeste dag', () => {
		const parsed = parse([
			sample({ timestamp: '2014-01-01T08:00:00.000Z' }),
			sample({ timestamp: '2016-06-15T08:00:00.000Z' })
		]);
		expect(waistDayRange(parsed.samples)).toEqual({
			oldest: '2014-01-01',
			newest: '2016-06-15'
		});
	});

	it('gir null for en tom bolk', () => {
		expect(waistDayRange([])).toEqual({ oldest: null, newest: null });
	});
});
