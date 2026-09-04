import { describe, it, expect } from 'vitest';
import { dailyWeights, type WeightDay, type WeightMeasurement } from './weight-series';
import {
	buildWeightPush,
	monthChangeNugget,
	weightNuggets,
	MIN_MONTH_WEIGH_INS,
	MONTH_SUMMARY_WINDOW_DAYS
} from './weight-nugget-rules';

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
