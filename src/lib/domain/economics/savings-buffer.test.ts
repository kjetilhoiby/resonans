import { describe, it, expect } from 'vitest';
import {
	describeWithdrawalPattern,
	isSavingsRole,
	looksLikeSavingsAccount,
	periodsFromPaydays,
	resolveSavingsAccounts,
	runwayMonths,
	troughTrend,
	troughsByPeriod,
	MIN_TROUGH_SAMPLES,
	TROUGH_NOISE_FLOOR_KR,
	type BalancePoint,
	type Period,
	type PeriodTrough,
	type SavingsRole
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

	// Regresjon: prod viste «11 uttak over 1 lønnsperioder … Uttak per måned 11,0».
	// Uttakslista leses over et bredere spenn enn de KOMPLETTE periodene dekker, så
	// teller og nevner var målt over ulike vinduer.
	it('holder uttak utenfor periodene ute av raten, og teller dem', () => {
		const pattern = describeWithdrawalPattern(
			[
				{ date: '2026-06-01', amount: 1000 }, // inne i periode 2
				{ date: '2026-09-02', amount: 4000 }, // etter siste periode
				{ date: '2026-09-14', amount: 4000 },
				{ date: '2026-05-01', amount: 4000 } // før første periode
			],
			periods
		);

		expect(pattern.count).toBe(1);
		expect(pattern.outsidePeriods).toBe(3);
		expect(pattern.perPeriod).toBeCloseTo(1 / 3);
		// Beløpsstatistikken kommer fra samme utvalg som raten.
		expect(pattern.medianAmount).toBe(1000);
		expect(pattern.largestAmount).toBe(1000);
	});

	it('sier «urørt» når alle uttakene ligger utenfor periodene', () => {
		const pattern = describeWithdrawalPattern([{ date: '2026-09-02', amount: 4000 }], periods);

		expect(pattern.verdict).toBe('urørt');
		expect(pattern.count).toBe(0);
		expect(pattern.outsidePeriods).toBe(1);
	});

	it('teller alle uttakene som utenfor når det ikke finnes perioder', () => {
		const pattern = describeWithdrawalPattern(
			[
				{ date: '2026-06-28', amount: 5000 },
				{ date: '2026-07-28', amount: 5000 }
			],
			[]
		);

		expect(pattern.verdict).toBe('ukjent');
		expect(pattern.count).toBe(0);
		expect(pattern.outsidePeriods).toBe(2);
	});
});


describe('resolveSavingsAccounts', () => {
	const sparekonto = {
		accountId: 'spar-1',
		accountName: 'Sparekonto Ekteskapet',
		accountType: 'Sparekonto',
		balance: 70_372
	};
	const barnekonto = {
		accountId: 'ung-1',
		accountName: 'Nils Grønningsæter Høiby SPAREKONTO UNG',
		accountType: 'Sparekonto',
		balance: 5314
	};
	const brukskonto = {
		accountId: 'bruk-1',
		accountName: 'Regningskonto',
		accountType: 'Brukskonto',
		balance: 9547
	};

	function roles(entries: Record<string, SavingsRole>): Map<string, SavingsRole> {
		return new Map(Object.entries(entries)) as Map<string, SavingsRole>;
	}

	it('bruker heuristikken når ingenting er valgt', () => {
		const decisions = resolveSavingsAccounts([sparekonto, brukskonto]);

		expect(decisions.map((d) => [d.account.accountId, d.isBuffer, d.basis])).toEqual([
			['spar-1', true, 'navn'],
			['bruk-1', false, 'ukjent-navn']
		]);
	});

	// Selve bestillingen: barnas «SPAREKONTO UNG» skal ikke inngå i husholdningens buffer.
	it('holder barnas konto utenfor som standard', () => {
		const decisions = resolveSavingsAccounts([sparekonto, barnekonto], {
			childNameTokens: ['nils', 'grønningsæter']
		});

		expect(decisions.find((d) => d.account.accountId === 'ung-1')?.isBuffer).toBe(false);
		expect(decisions.find((d) => d.account.accountId === 'ung-1')?.basis).toBe('barn');
		// Husholdningens egen sparekonto er urørt.
		expect(decisions.find((d) => d.account.accountId === 'spar-1')?.isBuffer).toBe(true);
	});

	// Barnenavnet må sjekkes FØR navneheuristikken: kontoen heter «SPAREKONTO UNG» og
	// treffer `spar`, så en sjekk etterpå ville aldri sett den.
	it('lar barnenavnet slå navneheuristikken, ikke omvendt', () => {
		const [decision] = resolveSavingsAccounts([barnekonto], { childNameTokens: ['nils'] });

		expect(looksLikeSavingsAccount(barnekonto)).toBe(true);
		expect(decision.isBuffer).toBe(false);
	});

	it('lar brukerens valg slå både barnenavn og heuristikk', () => {
		const included = resolveSavingsAccounts([barnekonto], {
			roles: roles({ 'ung-1': 'buffer' }),
			childNameTokens: ['nils']
		});
		expect(included[0].isBuffer).toBe(true);
		expect(included[0].basis).toBe('valgt');

		const excluded = resolveSavingsAccounts([sparekonto], {
			roles: roles({ 'spar-1': 'ignore' })
		});
		expect(excluded[0].isBuffer).toBe(false);
		expect(excluded[0].basis).toBe('utelatt');
	});

	it('kan legge til en konto heuristikken ikke fanget', () => {
		const decisions = resolveSavingsAccounts([brukskonto], {
			roles: roles({ 'bruk-1': 'buffer' })
		});

		expect(decisions[0].isBuffer).toBe(true);
	});

	it('skiller «uten navn» fra «ukjent navn»', () => {
		const [decision] = resolveSavingsAccounts([
			{ accountId: 'pdf-1', accountName: null, accountType: null, balance: 1000 }
		]);

		expect(decision.basis).toBe('uten-navn');
		expect(decision.isBuffer).toBe(false);
	});

	it('returnerer en beslutning per konto, også de utelatte', () => {
		const decisions = resolveSavingsAccounts([sparekonto, barnekonto, brukskonto], {
			childNameTokens: ['nils']
		});

		// Hele lista, ellers kan brukeren bare trekke fra og aldri legge til.
		expect(decisions).toHaveLength(3);
	});

	it('bærer en grunn i ord for hver beslutning', () => {
		const decisions = resolveSavingsAccounts([sparekonto, barnekonto, brukskonto], {
			childNameTokens: ['nils']
		});

		for (const decision of decisions) {
			expect(decision.reason.length).toBeGreaterThan(10);
		}
	});
});

describe('isSavingsRole', () => {
	it('godtar de tre tilstandene', () => {
		expect(isSavingsRole('auto')).toBe(true);
		expect(isSavingsRole('buffer')).toBe(true);
		expect(isSavingsRole('ignore')).toBe(true);
	});

	it('avviser alt annet', () => {
		expect(isSavingsRole('sparekonto')).toBe(false);
		expect(isSavingsRole(true)).toBe(false);
		expect(isSavingsRole(null)).toBe(false);
		expect(isSavingsRole(undefined)).toBe(false);
	});
});

describe('autoWouldInclude', () => {
	const sparekonto = {
		accountId: 'spar-1',
		accountName: 'Sparekonto Ekteskapet',
		accountType: 'Sparekonto',
		balance: 70_372
	};

	// Uten dette feltet kunne en veksleknapp ikke gå tilbake til `auto`, og ville lagret et
	// eksplisitt valg identisk med standarden — en usynlig lås.
	it('sier hva heuristikken ville gjort selv når et valg overstyrer den', () => {
		const [ignored] = resolveSavingsAccounts([sparekonto], {
			roles: new Map<string, SavingsRole>([['spar-1', 'ignore']])
		});

		expect(ignored.isBuffer).toBe(false);
		expect(ignored.basis).toBe('utelatt');
		expect(ignored.autoWouldInclude).toBe(true);
	});

	it('regner barneregelen med i det heuristikken ville gjort', () => {
		const barn = {
			accountId: 'ung-1',
			accountName: 'Nils SPAREKONTO UNG',
			accountType: 'Sparekonto',
			balance: 5314
		};
		const [chosen] = resolveSavingsAccounts([barn], {
			roles: new Map<string, SavingsRole>([['ung-1', 'buffer']]),
			childNameTokens: ['nils']
		});

		expect(chosen.isBuffer).toBe(true);
		expect(chosen.autoWouldInclude).toBe(false);
	});
});
