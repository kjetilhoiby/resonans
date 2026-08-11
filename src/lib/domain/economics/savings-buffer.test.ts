import { describe, it, expect } from 'vitest';
import {
	describeWithdrawalPattern,
	looksLikeSavingsAccount,
	periodsFromPaydays,
	runwayMonths,
	troughTrend,
	troughsByPeriod,
	MIN_TROUGH_SAMPLES,
	TROUGH_NOISE_FLOOR_KR,
	type BalancePoint,
	type Period,
	type PeriodTrough
} from './savings-buffer';

function trough(index: number, value: number): PeriodTrough {
	const month = String(index + 1).padStart(2, '0');
	return {
		periodStart: `2026-${month}-25`,
		periodEnd: `2026-${String(index + 2).padStart(2, '0')}-25`,
		trough: value,
		troughDate: `2026-${month}-28`,
		end: value + 1000
	};
}

describe('looksLikeSavingsAccount', () => {
	it('kjenner igjen sparekontoer', () => {
		expect(looksLikeSavingsAccount({ accountName: 'Sparekonto' })).toBe(true);
		expect(looksLikeSavingsAccount({ accountName: 'Buffer' })).toBe(true);
		expect(looksLikeSavingsAccount({ accountType: 'BSU' })).toBe(true);
	});

	it('holder brukskonto og lønnskonto utenfor', () => {
		// Bunnen på en brukskonto er dagen før lønn, ikke et buffernivå.
		expect(looksLikeSavingsAccount({ accountName: 'Brukskonto' })).toBe(false);
		expect(looksLikeSavingsAccount({ accountName: 'Lønnskonto' })).toBe(false);
	});

	it('regner FELLES sparekonto som buffer', () => {
		// Dette er husholdningens økonomi, ikke brukerens alene: en felles sparekonto er
		// nettopp bufferen. Første utgave ekskluderte «felles» og ville vist «ingen
		// bufferkonto funnet» for den kontoen det faktisk gjaldt.
		expect(looksLikeSavingsAccount({ accountName: 'Felles sparekonto' })).toBe(true);
	});

	it('lar en avvisende term slå en positiv', () => {
		expect(looksLikeSavingsAccount({ accountName: 'Sparegris brukskonto' })).toBe(false);
	});

	it('sier nei når det ikke er noe å gå på', () => {
		expect(looksLikeSavingsAccount({ accountName: null, accountType: null })).toBe(false);
		expect(looksLikeSavingsAccount({ accountName: 'Konto 1234' })).toBe(false);
	});
});

describe('periodsFromPaydays', () => {
	it('bygger perioder mellom lønnsdatoer, siste løper til i dag', () => {
		const periods = periodsFromPaydays(['2026-06-25', '2026-07-25'], '2026-08-11');

		expect(periods).toEqual([
			{ start: '2026-06-25', end: '2026-07-25' },
			{ start: '2026-07-25', end: '2026-08-11' }
		]);
	});

	it('dropper lønnsdatoer i framtiden', () => {
		const periods = periodsFromPaydays(['2026-07-25', '2026-09-25'], '2026-08-11');

		expect(periods).toEqual([{ start: '2026-07-25', end: '2026-08-11' }]);
	});

	it('tåler duplikater og usortert inn', () => {
		const periods = periodsFromPaydays(
			['2026-07-25', '2026-06-25', '2026-07-25'],
			'2026-08-11'
		);

		expect(periods).toHaveLength(2);
		expect(periods[0].start).toBe('2026-06-25');
	});
});

describe('troughsByPeriod', () => {
	const balances: BalancePoint[] = [
		{ date: '2026-06-25', balance: 100_000 },
		{ date: '2026-07-05', balance: 92_000 },
		{ date: '2026-07-20', balance: 96_000 },
		{ date: '2026-07-25', balance: 101_000 },
		{ date: '2026-08-02', balance: 88_000 },
		{ date: '2026-08-10', balance: 90_000 }
	];
	const periods: Period[] = [
		{ start: '2026-06-25', end: '2026-07-25' },
		{ start: '2026-07-25', end: '2026-08-11' }
	];

	it('finner laveste saldo per periode', () => {
		const troughs = troughsByPeriod(balances, periods);

		expect(troughs.map((t) => [t.trough, t.troughDate])).toEqual([
			[92_000, '2026-07-05'],
			[88_000, '2026-08-02']
		]);
	});

	it('bærer saldoen ved periodens slutt, så man ser om den kom tilbake', () => {
		const troughs = troughsByPeriod(balances, periods);

		expect(troughs[0].end).toBe(96_000); // siste måling FØR neste lønn
		expect(troughs[1].end).toBe(90_000);
	});

	it('dropper perioder uten målinger framfor å sette 0', () => {
		// En 0 ville lest som at kontoen var tømt.
		const troughs = troughsByPeriod(balances, [
			{ start: '2025-01-01', end: '2025-02-01' },
			...periods
		]);

		expect(troughs).toHaveLength(2);
	});
});

describe('troughTrend', () => {
	it('holder kjeft under minstekravet', () => {
		const trend = troughTrend([trough(0, 100_000), trough(1, 90_000)]);

		expect(trend.direction).toBe('ukjent');
		expect(trend.perPeriod).toBeNull();
		expect(trend.reason).toContain(String(MIN_TROUGH_SAMPLES));
	});

	it('ser erosjon i synkende bunner', () => {
		const trend = troughTrend([trough(0, 100_000), trough(1, 90_000), trough(2, 80_000)]);

		expect(trend.direction).toBe('eroderer');
		expect(trend.perPeriod).toBeCloseTo(-10_000);
		expect(trend.total).toBeCloseTo(-20_000);
	});

	it('ser vekst i stigende bunner', () => {
		const trend = troughTrend([trough(0, 80_000), trough(1, 90_000), trough(2, 100_000)]);

		expect(trend.direction).toBe('vokser');
	});

	it('kaller små bevegelser stabile', () => {
		const trend = troughTrend([trough(0, 100_000), trough(1, 100_200), trough(2, 99_900)]);

		expect(trend.direction).toBe('stabil');
		expect(Math.abs(trend.total ?? 0)).toBeLessThan(TROUGH_NOISE_FLOOR_KR);
	});

	it('lar ikke ÉN avvikende måned avgjøre retningen', () => {
		// En enkelt stor utbetaling midt i et ellers flatt forløp. «Siste minus første»
		// ville sagt stabil her, og et snitt ville sagt nedgang — regresjonen ser at
		// nivået er uendret.
		const trend = troughTrend([
			trough(0, 100_000),
			trough(1, 60_000),
			trough(2, 100_000),
			trough(3, 100_500)
		]);

		expect(trend.direction).not.toBe('eroderer');
	});

	it('ser erosjon selv når toppene står stille', () => {
		// Dette er hele grunnen til å måle bunnene: lønna kommer inn hver måned, så
		// toppene ser uendret ut mens gulvet synker.
		const eroding = [trough(0, 50_000), trough(1, 44_000), trough(2, 38_000)].map((t) => ({
			...t,
			end: 100_000 // samme topp hver periode
		}));

		expect(troughTrend(eroding).direction).toBe('eroderer');
	});
});

describe('runwayMonths', () => {
	it('regner dekning i måneder', () => {
		expect(runwayMonths(126_000, 42_000)).toBeCloseTo(3);
	});

	it('returnerer null uten forbrukstall framfor å gjette', () => {
		expect(runwayMonths(126_000, null)).toBeNull();
		expect(runwayMonths(126_000, 0)).toBeNull();
	});

	it('viser hvor mye det oppblåste forbrukstallet ville kostet', () => {
		// 1,58 mill./år delt på 12 = 132 000 kr/mnd, mot reelle ~42 000 etter at interne
		// overføringer er ute. Samme buffer, tre ganger dårligere svar.
		const honest = runwayMonths(126_000, 42_000);
		const inflated = runwayMonths(126_000, 132_000);

		expect(honest).toBeCloseTo(3);
		expect(inflated).toBeLessThan(1);
	});

	it('gir 0 på tom konto', () => {
		expect(runwayMonths(0, 42_000)).toBe(0);
	});
});

describe('describeWithdrawalPattern', () => {
	const periods: Period[] = [
		{ start: '2026-05-25', end: '2026-06-25' },
		{ start: '2026-06-25', end: '2026-07-25' },
		{ start: '2026-07-25', end: '2026-08-25' }
	];

	it('sier «urørt» når bufferen ikke er brukt', () => {
		const pattern = describeWithdrawalPattern([], periods);

		expect(pattern.verdict).toBe('urørt');
		expect(pattern.medianAmount).toBeNull();
	});

	it('kaller ett stort uttak tidlig for en støtdemper', () => {
		const pattern = describeWithdrawalPattern(
			[{ date: '2026-06-28', amount: 12_000 }],
			periods
		);

		expect(pattern.verdict).toBe('støtdemper');
		expect(pattern.largestAmount).toBe(12_000);
	});

	it('kaller hyppige sene uttak for kassekreditt', () => {
		// Dag 26+ i hver periode: pengene tok slutt før lønn.
		const pattern = describeWithdrawalPattern(
			[
				{ date: '2026-06-22', amount: 3000 },
				{ date: '2026-07-22', amount: 2500 },
				{ date: '2026-08-21', amount: 4000 }
			],
			periods
		);

		expect(pattern.verdict).toBe('kassekreditt');
		expect(pattern.lateShare).toBeGreaterThan(0.5);
	});

	it('skiller tolv små fra ett stort — samme sum, motsatt diagnose', () => {
		const oneBig = describeWithdrawalPattern([{ date: '2026-06-28', amount: 12_000 }], periods);
		const manyLate = describeWithdrawalPattern(
			[
				{ date: '2026-06-20', amount: 4000 },
				{ date: '2026-07-20', amount: 4000 },
				{ date: '2026-08-19', amount: 4000 }
			],
			periods
		);

		expect(oneBig.largestAmount! * 1).toBe(12_000);
		expect(manyLate.count * manyLate.medianAmount!).toBe(12_000);
		expect(oneBig.verdict).toBe('støtdemper');
		expect(manyLate.verdict).toBe('kassekreditt');
	});

	it('sier «blandet» når signalene peker ulikt', () => {
		const pattern = describeWithdrawalPattern(
			[
				{ date: '2026-05-28', amount: 1000 },
				{ date: '2026-06-01', amount: 1000 },
				{ date: '2026-06-28', amount: 1000 },
				{ date: '2026-07-28', amount: 1000 }
			],
			periods
		);

		expect(pattern.verdict).toBe('blandet');
	});

	it('sier «ukjent» uten lønnsperioder framfor å påstå et mønster', () => {
		const pattern = describeWithdrawalPattern([{ date: '2026-06-28', amount: 5000 }], []);

		expect(pattern.verdict).toBe('ukjent');
		expect(pattern.reason).toContain('posisjonen');
	});

	it('teller frekvens per periode, ikke totalt', () => {
		const pattern = describeWithdrawalPattern(
			[
				{ date: '2026-06-01', amount: 1000 },
				{ date: '2026-07-01', amount: 1000 },
				{ date: '2026-08-01', amount: 1000 }
			],
			periods
		);

		expect(pattern.perPeriod).toBeCloseTo(1);
	});
});
