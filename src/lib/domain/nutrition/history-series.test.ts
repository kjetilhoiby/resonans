import { describe, it, expect } from 'vitest';
import { buildHistorySeries, weightPointsForChart, weightSegments } from './history-series';

describe('buildHistorySeries', () => {
	it('fyller ut datoer selv der data mangler', () => {
		// Et hull midt i serien skal være synlig som et hull, og det krever at
		// dagen finnes i lista.
		const series = buildHistorySeries({
			endDate: '2026-08-03',
			days: 3,
			intakeByDate: { '2026-08-01': 2000, '2026-08-03': 1439 },
			expenditureByDate: {},
			weightByDate: {}
		});
		expect(series.days.map((d) => d.date)).toEqual(['2026-08-01', '2026-08-02', '2026-08-03']);
		expect(series.days[1].intakeKcal).toBeNull();
		expect(series.loggedDays).toBe(2);
	});

	it('skiller en uloggeet dag fra en dag uten mat', () => {
		// 0 ville sett ut som faste. Null betyr «vet ikke».
		const series = buildHistorySeries({
			endDate: '2026-08-02',
			days: 2,
			intakeByDate: { '2026-08-02': 0 },
			expenditureByDate: {},
			weightByDate: {}
		});
		expect(series.days[1].intakeKcal).toBeNull();
	});

	it('regner balansen bare når begge sider finnes', () => {
		const series = buildHistorySeries({
			endDate: '2026-08-02',
			days: 2,
			intakeByDate: { '2026-08-01': 2000, '2026-08-02': 1439 },
			expenditureByDate: { '2026-08-02': 2786 },
			weightByDate: {}
		});
		expect(series.days[0].balanceKcal).toBeNull();
		expect(series.days[1].balanceKcal).toBe(-1347);
	});

	it('finner maksverdien over begge serier', () => {
		const series = buildHistorySeries({
			endDate: '2026-08-02',
			days: 2,
			intakeByDate: { '2026-08-01': 3200 },
			expenditureByDate: { '2026-08-02': 2786 },
			weightByDate: {}
		});
		expect(series.maxKcal).toBe(3200);
	});

	it('krever to vektmålinger for et spenn', () => {
		const one = buildHistorySeries({
			endDate: '2026-08-02',
			days: 2,
			intakeByDate: {},
			expenditureByDate: {},
			weightByDate: { '2026-08-02': 100 }
		});
		expect(one.weightRange).toBeNull();

		const two = buildHistorySeries({
			endDate: '2026-08-02',
			days: 2,
			intakeByDate: {},
			expenditureByDate: {},
			weightByDate: { '2026-08-01': 100.5, '2026-08-02': 100 }
		});
		expect(two.weightRange).toEqual({ min: 100, max: 100.5 });
	});

	it('merker dagen som ikke er omme', () => {
		// Inntaket er «så langt», forbruket for hele døgnet. Søylene er ikke
		// sammenlignbare, og flaten må få vite hvilken dag det gjelder.
		const series = buildHistorySeries({
			endDate: '2026-08-04',
			days: 2,
			intakeByDate: { '2026-08-03': 1439, '2026-08-04': 304 },
			expenditureByDate: { '2026-08-03': 2591, '2026-08-04': 2591 },
			weightByDate: {},
			partialDate: '2026-08-04'
		});
		expect(series.days.map((d) => d.partial)).toEqual([false, true]);
	});

	it('merker ingen dag uten partialDate', () => {
		const series = buildHistorySeries({
			endDate: '2026-08-04',
			days: 2,
			intakeByDate: {},
			expenditureByDate: {},
			weightByDate: {}
		});
		expect(series.days.every((d) => !d.partial)).toBe(true);
	});

	it('tåler tull inn', () => {
		expect(buildHistorySeries({
			endDate: 'i går',
			days: 7,
			intakeByDate: {},
			expenditureByDate: {},
			weightByDate: {}
		}).days).toEqual([]);
	});

	it('begrenser vinduet', () => {
		expect(buildHistorySeries({ endDate: '2026-08-03', days: 500, intakeByDate: {}, expenditureByDate: {}, weightByDate: {} }).days).toHaveLength(90);
		expect(buildHistorySeries({ endDate: '2026-08-03', days: 0, intakeByDate: {}, expenditureByDate: {}, weightByDate: {} }).days).toHaveLength(1);
	});
});

describe('weightPointsForChart', () => {
	it('plasserer punktene over sin egen dato', () => {
		const series = buildHistorySeries({
			endDate: '2026-08-03',
			days: 3,
			intakeByDate: {},
			expenditureByDate: {},
			weightByDate: { '2026-08-01': 101, '2026-08-03': 100 }
		});
		const points = weightPointsForChart(series);
		expect(points).toHaveLength(2);
		expect(points[0].x).toBe(0);
		expect(points[1].x).toBe(1);
		// Lavest vekt nederst, høyest øverst.
		expect(points[0].y).toBe(1);
		expect(points[1].y).toBe(0);
	});

	it('legger en flat serie midt i feltet framfor å dele på null', () => {
		const series = buildHistorySeries({
			endDate: '2026-08-02',
			days: 2,
			intakeByDate: {},
			expenditureByDate: {},
			weightByDate: { '2026-08-01': 100, '2026-08-02': 100 }
		});
		expect(weightPointsForChart(series).every((p) => p.y === 0.5)).toBe(true);
	});

	it('gir tom liste når det ikke er en kurve', () => {
		const series = buildHistorySeries({
			endDate: '2026-08-02',
			days: 2,
			intakeByDate: {},
			expenditureByDate: {},
			weightByDate: { '2026-08-02': 100 }
		});
		expect(weightPointsForChart(series)).toEqual([]);
	});
});

describe('weightSegments', () => {
	function series(weightByDate: Record<string, number>) {
		return buildHistorySeries({
			endDate: '2026-08-14',
			days: 14,
			intakeByDate: {},
			expenditureByDate: {},
			weightByDate
		});
	}

	it('holder sammen målinger som ligger tett', () => {
		const segments = weightSegments(
			series({ '2026-08-10': 101, '2026-08-12': 100.4, '2026-08-14': 100 })
		);
		expect(segments).toHaveLength(1);
		expect(segments[0].map((p) => p.kg)).toEqual([101, 100.4, 100]);
	});

	it('bryter linja over et for langt hull', () => {
		// Åtte dager uten måling: en rett strek der ville påstått en jevn utvikling
		// ingen har målt.
		const segments = weightSegments(series({ '2026-08-04': 102, '2026-08-13': 100, '2026-08-14': 100.2 }));
		expect(segments).toHaveLength(2);
		expect(segments[0].map((p) => p.kg)).toEqual([102]);
		expect(segments[1].map((p) => p.kg)).toEqual([100, 100.2]);
	});

	it('godtar hull opp til grensa', () => {
		expect(weightSegments(series({ '2026-08-11': 101, '2026-08-14': 100 }))).toHaveLength(1);
		expect(weightSegments(series({ '2026-08-10': 101, '2026-08-14': 100 }))).toHaveLength(2);
	});

	it('gir tom liste uten kurve', () => {
		expect(weightSegments(series({ '2026-08-14': 100 }))).toEqual([]);
	});
});
