import { describe, it, expect } from 'vitest';
import { dailyWeights, type WeightDay, type WeightMeasurement } from './weight-series';
import { buildMetricSeries } from './weight-series';
import { findWeightSwings } from './weight-swings';
import {
	buildWeightPush,
	goalProgressNugget,
	monthChangeNugget,
	thresholdCrossedNugget,
	weightNuggets,
	yearOverYearNugget,
	MIN_MONTH_WEIGH_INS,
	MONTH_SUMMARY_WINDOW_DAYS,
	YEAR_OVER_YEAR_FLOOR_KG
} from './weight-nugget-rules';

/** Trendserien reglene tar. */
function pointsOf(days: WeightDay[]) {
	return buildMetricSeries(days, 'weight').points;
}

function iso(day: number): string {
	return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

function dayOf(date: string): number {
	return Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

/** Én veiing per dag, `values` eldst først, siste dag = `endDate`. */
function series(values: number[], endDate: string): WeightDay[] {
	const last = dayOf(endDate);
	const rows: WeightMeasurement[] = values.map((weightKg, i) => ({
		date: iso(last - (values.length - 1) + i),
		weightKg
	}));
	return dailyWeights(rows);
}

function ramp(from: number, to: number, length: number): number[] {
	return Array.from({ length }, (_, i) =>
		Math.round((from + ((to - from) * i) / (length - 1)) * 10) / 10
	);
}

function flat(value: number, length: number): number[] {
	return Array.from({ length }, () => value);
}

describe('monthChangeNugget', () => {
	// 120 dager fram til 2. september: dekker juli og august med daglige veiinger.
	const jevnNedgang = series(ramp(98, 92, 120), '2026-09-02');

	it('oppsummerer måneden som nettopp tok slutt', () => {
		const nugget = monthChangeNugget(jevnNedgang, '2026-09-02');
		expect(nugget?.kind).toBe('month-change');
		expect(nugget?.headline).toMatch(/^August ble ned \d,\d kg$/);
	});

	it('tier utenfor vinduet — august er gammelt nytt den tiende', () => {
		const days = series(ramp(98, 92, 130), '2026-09-10');
		expect(monthChangeNugget(days, '2026-09-10')).toBeNull();
		// Grensen selv er inklusiv.
		expect(monthChangeNugget(series(ramp(98, 92, 125), '2026-09-05'), '2026-09-05')).not.toBeNull();
		expect(MONTH_SUMMARY_WINDOW_DAYS).toBe(5);
	});

	it('tier når måneden har for få veiinger', () => {
		// Hver fjerde dag i august gir under MIN_MONTH_WEIGH_INS.
		const rows: WeightMeasurement[] = [];
		const last = dayOf('2026-09-02');
		for (let i = 0; i < 120; i++) {
			const date = iso(last - 119 + i);
			if (date.slice(0, 7) === '2026-08' && i % 4 !== 0) continue;
			rows.push({ date, weightKg: 98 - i * 0.05 });
		}
		const days = dailyWeights(rows);
		expect(days.filter((d) => d.date.slice(0, 7) === '2026-08').length).toBeLessThan(
			MIN_MONTH_WEIGH_INS
		);
		expect(monthChangeNugget(days, '2026-09-02')).toBeNull();
	});

	it('sier «uendret» framfor å påstå et tall under støygulvet', () => {
		const nugget = monthChangeNugget(series(flat(94, 120), '2026-09-02'), '2026-09-02');
		expect(nugget?.headline).toBe('August endte uendret');
	});

	it('sier fra begge veier', () => {
		const nugget = monthChangeNugget(series(ramp(92, 98, 120), '2026-09-02'), '2026-09-02');
		expect(nugget?.headline).toMatch(/^August ble opp \d,\d kg$/);
	});

	it('måler gjennom måneden, ikke mellom to månedssnitt', () => {
		// 0,05 kg per dag = ~1,5 kg gjennom august. Snittet av august mot snittet
		// av juli ville gitt omtrent det samme her, men ankrene skal stå på
		// månedsskiftene: endringen er ~1,5, ikke ~0,75.
		const days = series(ramp(98, 92, 120), '2026-09-02');
		const nugget = monthChangeNugget(days, '2026-09-02');
		const value = Number(nugget!.headline.match(/(\d,\d)/)![1].replace(',', '.'));
		expect(value).toBeGreaterThan(1.2);
		expect(value).toBeLessThan(1.9);
	});
});

describe('weightNuggets', () => {
	it('setter månedsoppgjøret først når det fyrer', () => {
		const nuggets = weightNuggets({
			days: series(ramp(98, 92, 120), '2026-09-02'),
			today: '2026-09-02',
			goalKg: 90
		});
		expect(nuggets[0].kind).toBe('month-change');
		// Rekorden faller ikke bort — den blir andrelinja.
		expect(nuggets.map((n) => n.kind)).toContain('lowest-trend');
	});

	it('har alltid noe å si når det finnes et mål, også uten rekorder', () => {
		const nuggets = weightNuggets({
			days: series(flat(94, 40), '2026-09-12'),
			today: '2026-09-12',
			goalKg: 90
		});
		expect(nuggets.map((n) => n.kind)).toContain('goal-distance');
	});

	it('er tom når det verken finnes historikk, streak eller mål', () => {
		expect(weightNuggets({ days: series([94, 94], '2026-09-12'), today: '2026-09-12' })).toEqual(
			[]
		);
	});
});

describe('buildWeightPush', () => {
	it('gir krydderet som tittel og vekta først i body-en', () => {
		const push = buildWeightPush({
			days: series(ramp(98, 92, 120), '2026-09-02'),
			today: '2026-09-02',
			goalKg: 90,
			latestKg: 92
		});
		expect(push.title).toMatch(/^August ble ned/);
		expect(push.body.startsWith('92,0 kg · ')).toBe(true);
		expect(push.nugget?.kind).toBe('month-change');
	});

	it('faller tilbake på den nøytrale beskjeden uten krydder', () => {
		const push = buildWeightPush({
			days: series([94, 94], '2026-09-12'),
			today: '2026-09-12',
			latestKg: 94.2
		});
		expect(push).toMatchObject({
			title: 'Veiing registrert',
			body: '94,2 kg',
			nugget: null,
			secondary: null
		});
	});

	it('lar ikke andrelinja gjenta tittelen med andre ord', () => {
		const push = buildWeightPush({
			days: series(ramp(98, 92, 200), '2026-09-12'),
			today: '2026-09-12',
			goalKg: 90,
			latestKg: 92
		});
		expect(push.secondary?.kind).not.toBe(push.nugget?.kind);
		if (push.nugget?.kind === 'lowest-trend') {
			expect(push.secondary?.kind).not.toBe('lowest-raw');
			expect(push.secondary?.kind).not.toBe('above-nadir');
		}
	});

	it('sier avstanden til målet når det er det eneste vi vet', () => {
		// Hver tredje dag: for kort historikk til rekorder, for glissent til
		// veiestreak og dekning. Da står målet igjen som det eneste sanne.
		const last = dayOf('2026-09-12');
		const days = dailyWeights(
			Array.from({ length: 14 }, (_, i) => ({ date: iso(last - (13 - i) * 3), weightKg: 94 }))
		);
		const push = buildWeightPush({ days, today: '2026-09-12', goalKg: 90, latestKg: 94 });
		expect(push.title).toBe('4,0 kg til målet på 90,0 kg');
		expect(push.body).toBe('94,0 kg');
	});

	it('tåler en veiing uten tall', () => {
		const push = buildWeightPush({
			days: series([94, 94], '2026-09-12'),
			today: '2026-09-12',
			latestKg: null
		});
		expect(push.body).toBe('Ny veiing registrert');
	});
});

describe('thresholdCrossedNugget', () => {
	// Nok historikk til at rekorder gjelder (60 dager, 20 veiinger).
	function crossing(from: number, to: number): WeightDay[] {
		return series([...ramp(102, from, 200), to], '2026-09-12');
	}

	it('sier fra når trenden går under et helt kilo', () => {
		const days = crossing(95.2, 90);
		const nugget = thresholdCrossedNugget(pointsOf(days), true);
		expect(nugget?.kind).toBe('threshold-crossed');
		expect(nugget?.headline).toMatch(/^Under 9\d kg for første gang/);
	});

	it('tier når trenden stiger', () => {
		const days = series([...ramp(90, 95, 200), 99], '2026-09-12');
		expect(thresholdCrossedNugget(pointsOf(days), true)).toBeNull();
	});

	it('tier uten nok historikk — en rekord trenger noe å være rekord i', () => {
		expect(thresholdCrossedNugget(pointsOf(crossing(95.2, 90)), false)).toBeNull();
	});

	it('tier når trenden bare ligger stille under terskelen', () => {
		// Ingen passering i siste steg: den skjedde for lenge siden.
		const days = series(flat(94, 200), '2026-09-12');
		expect(thresholdCrossedNugget(pointsOf(days), true)).toBeNull();
	});

	it('velger den LAVESTE terskelen når flere krysses i ett steg', () => {
		const days = crossing(95.4, 80);
		const nugget = thresholdCrossedNugget(pointsOf(days), true);
		const value = Number(nugget!.headline.match(/Under (\d+) kg/)![1]);
		// Trenden faller flere kilo på det siste steget; det laveste passerte
		// heltallet er nyheten, ikke det første.
		expect(value).toBeLessThan(95);
	});

	it('gjentar seg ikke når trenden vipper rundt samme terskel', () => {
		// Under 95, opp igjen, og under på nytt noen dager senere.
		const days = series([...ramp(102, 95.3, 200), 94.5, 96, 96, 94.4], '2026-09-12');
		expect(thresholdCrossedNugget(pointsOf(days), true)).toBeNull();
	});
});

describe('goalProgressNugget', () => {
	function withGoal(values: number[], goal: number | null) {
		const days = series(values, '2026-09-12');
		const points = pointsOf(days);
		return goalProgressNugget(points, findWeightSwings(points), goal);
	}

	it('sier «halvveis» når trenden krysser midtpunktet', () => {
		// Fra 100 mot målet 90: halvveis er 95.
		const nugget = withGoal([...ramp(100, 95.4, 120), 88], 90);
		expect(nugget?.kind).toBe('goal-progress');
		expect(nugget?.headline).toMatch(/til 90,0 kg$/);
	});

	it('navngir baselinen i setningen', () => {
		const nugget = withGoal([...ramp(100, 95.4, 120), 88], 90);
		// «fra NN,N kg (måned år) til målet på …» — startpunktet skal kunne
		// etterprøves, ikke bare påstås.
		expect(nugget?.sentence).toMatch(/fra \d+,\d kg \(\w+ \d{4}\) til målet på 90,0 kg\./);
	});

	it('tier uten målvekt', () => {
		expect(withGoal([...ramp(100, 95.4, 120), 88], null)).toBeNull();
	});

	it('tier når perioden startet under målet', () => {
		expect(withGoal([...ramp(88, 85, 120), 80], 90)).toBeNull();
	});

	it('tier når ingen merker krysses i dette steget', () => {
		expect(withGoal(ramp(100, 97, 120), 90)).toBeNull();
	});
});

describe('yearOverYearNugget', () => {
	// To år med daglige veiinger: i fjor rundt 97, i år rundt 93.
	const toAr = series([...flat(97, 365), ...flat(93, 250)], '2026-09-12');

	it('sammenligner mot samme dato i fjor, med posisjonsord', () => {
		const nugget = yearOverYearNugget(pointsOf(toAr), '2026-09-12');
		expect(nugget?.kind).toBe('year-over-year');
		expect(nugget?.headline).toBe('4,0 kg under i fjor');
		expect(nugget?.sentence).toBe('4,0 kg under i fjor på samme dato.');
	});

	it('sier «over» når vekta har gått opp', () => {
		const days = series([...flat(93, 365), ...flat(97, 250)], '2026-09-12');
		expect(yearOverYearNugget(pointsOf(days), '2026-09-12')?.headline).toBe('4,0 kg over i fjor');
	});

	it('tier under støygulvet — et halvkilo på et år er ikke en nyhet', () => {
		const days = series([...flat(93.5, 365), ...flat(93, 250)], '2026-09-12');
		expect(YEAR_OVER_YEAR_FLOOR_KG).toBe(1);
		expect(yearOverYearNugget(pointsOf(days), '2026-09-12')).toBeNull();
	});

	it('tier uten et fjorår å sammenligne med', () => {
		expect(yearOverYearNugget(pointsOf(series(flat(93, 200), '2026-09-12')), '2026-09-12')).toBeNull();
	});
});

describe('rangering og gjenklang', () => {
	it('lar et andelsmerke slå rekordene', () => {
		const nuggets = weightNuggets({
			days: series([...ramp(100, 95.4, 200), 88], '2026-09-12'),
			today: '2026-09-12',
			goalKg: 90
		});
		expect(['goal-progress', 'threshold-crossed', 'below-goal']).toContain(nuggets[0].kind);
	});

	it('lar ikke andrelinja gjenta en måltittel med andre ord', () => {
		// Trenden må faktisk ligge under målet — den er etterslepende, så én
		// måling under 90 er ikke det samme som å ha nådd 90.
		const push = buildWeightPush({
			days: series([...ramp(100, 88, 200), ...flat(88, 14)], '2026-09-12'),
			today: '2026-09-12',
			goalKg: 90,
			latestKg: 88
		});
		// Måloppnåelse er øverst i rangeringen, og de to andre målsetningene
		// snakker om den samme avstanden.
		expect(push.nugget?.kind).toBe('below-goal');
		expect(push.secondary?.kind).not.toBe('goal-distance');
		expect(push.secondary?.kind).not.toBe('goal-progress');
	});

	it('lar ikke en passert terskel stå ved siden av den samme trendrekorden', () => {
		const push = buildWeightPush({
			days: series([...ramp(102, 95.2, 200), 90], '2026-09-12'),
			today: '2026-09-12',
			latestKg: 94,
			goalKg: null
		});
		expect(push.nugget?.kind).toBe('threshold-crossed');
		expect(push.secondary?.kind).not.toBe('lowest-trend');
		expect(push.secondary?.kind).not.toBe('lowest-raw');
	});
});
