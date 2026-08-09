import { describe, it, expect } from 'vitest';
import {
	APPROXIMATE_TYPES,
	buildCoverage,
	COVERAGE_TYPES,
	isCoverageType,
	parseCoverageTypes
} from './healthkit-coverage';

function rows(...iso: string[]) {
	return iso.map((value) => ({ timestamp: new Date(value) }));
}

describe('buildCoverage', () => {
	it('teller dager, ikke rader', () => {
		const coverage = buildCoverage(
			rows('2018-03-04T06:00:00Z', '2018-03-04T18:00:00Z', '2018-03-05T06:00:00Z')
		);

		expect(coverage.totalDays).toBe(2);
		expect(coverage.days).toEqual(['2018-03-04', '2018-03-05']);
	});

	it('bøtter på Oslo-døgn', () => {
		// 23:30 UTC om sommeren er 01:30 neste dag i Oslo.
		const coverage = buildCoverage(rows('2018-06-14T23:30:00Z'));

		expect(coverage.days).toEqual(['2018-06-15']);
	});

	it('sorterer og finner ytterpunktene uansett rekkefølge inn', () => {
		const coverage = buildCoverage(
			rows('2020-01-01T09:00:00Z', '2017-10-13T09:00:00Z', '2019-05-05T09:00:00Z')
		);

		expect(coverage.earliest).toBe('2017-10-13');
		expect(coverage.latest).toBe('2020-01-01');
		expect(coverage.days).toEqual(['2017-10-13', '2019-05-05', '2020-01-01']);
	});

	it('grupperer per år', () => {
		const coverage = buildCoverage(
			rows('2017-11-01T09:00:00Z', '2017-11-02T09:00:00Z', '2018-01-01T09:00:00Z')
		);

		expect(coverage.byYear).toEqual({ '2017': 2, '2018': 1 });
	});

	it('er tom uten rader', () => {
		const coverage = buildCoverage([]);

		expect(coverage).toEqual({ totalDays: 0, earliest: null, latest: null, byYear: {}, days: [] });
	});

	it('merker typene der dagen bare er en tilnærming', () => {
		expect(buildCoverage(rows('2020-01-01T09:00:00Z'), 'workout').approximation).toBe(
			APPROXIMATE_TYPES.workout
		);
		expect(buildCoverage(rows('2020-01-01T09:00:00Z'), 'sleep').approximation).toBe(
			APPROXIMATE_TYPES.sleep
		);
	});

	it('merker ikke vekt — der ER dagen regelen importen bruker', () => {
		expect(buildCoverage(rows('2020-01-01T09:00:00Z'), 'weight').approximation).toBeUndefined();
	});
});

describe('parseCoverageTypes', () => {
	it('tom betyr alle', () => {
		expect(parseCoverageTypes(null).types).toEqual([...COVERAGE_TYPES]);
		expect(parseCoverageTypes('').types).toEqual([...COVERAGE_TYPES]);
		expect(parseCoverageTypes('  ').types).toEqual([...COVERAGE_TYPES]);
	});

	it('leser en liste og fjerner duplikater', () => {
		expect(parseCoverageTypes('weight, sleep ,weight').types).toEqual(['weight', 'sleep']);
	});

	it('rapporterer ukjente framfor å ignorere dem', () => {
		// En skrivefeil som stille gir tom dekning ville sett ut som «Resonans har
		// ingenting» — nøyaktig den konklusjonen endepunktet skal gjøre etterprøvbar.
		const parsed = parseCoverageTypes('weight,vekt');

		expect(parsed.types).toEqual(['weight']);
		expect(parsed.unknown).toEqual(['vekt']);
	});
});

describe('isCoverageType', () => {
	it('godtar bare data_type-verdier som finnes hos oss', () => {
		expect(isCoverageType('weight')).toBe(true);
		expect(isCoverageType('workout')).toBe(true);
		expect(isCoverageType('sleep')).toBe(true);
		// Livvidde har ingen plass i Resonans ennå, og skal ikke se ut som den har det.
		expect(isCoverageType('waist')).toBe(false);
		expect(isCoverageType('hrv')).toBe(false);
	});
});
