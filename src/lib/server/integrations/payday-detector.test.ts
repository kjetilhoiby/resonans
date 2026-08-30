import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/db', () => ({ db: {} }));

import {
	normalizeDescriptionFingerprint,
	amountBucket,
	median,
	businessDayDom,
	isWeekend,
	toIsoDate,
	monthKey,
	selectPaydaySource,
	pickBestPerMonth,
	type SalaryCandidate
} from './payday-detector';

describe('normalizeDescriptionFingerprint', () => {
	it('normaliserer til uppercase, fjerner tall, beholder maks 3 ord', () => {
		expect(normalizeDescriptionFingerprint('Firma AS 12345 betaling')).toBe('FIRMA AS BETALING');
	});

	it('fjerner spesialtegn men beholder ÆØÅ', () => {
		expect(normalizeDescriptionFingerprint('Lønn fra Ås kommune')).toBe('LØNN FRA ÅS');
	});

	it('returnerer UNKNOWN for tom streng', () => {
		expect(normalizeDescriptionFingerprint('')).toBe('UNKNOWN');
		expect(normalizeDescriptionFingerprint('123 456')).toBe('UNKNOWN');
	});

	it('begrenser til 3 ord', () => {
		expect(normalizeDescriptionFingerprint('ett to tre fire fem')).toBe('ETT TO TRE');
	});

	it('kollapser whitespace', () => {
		expect(normalizeDescriptionFingerprint('  mye   mellomrom  ')).toBe('MYE MELLOMROM');
	});
});

describe('amountBucket', () => {
	it('runder til nærmeste 500', () => {
		expect(amountBucket(45000)).toBe(45000);
		expect(amountBucket(45200)).toBe(45000);
		expect(amountBucket(45250)).toBe(45500);
		expect(amountBucket(45700)).toBe(45500);
	});

	it('håndterer 0', () => {
		expect(amountBucket(0)).toBe(0);
	});

	it('håndterer negative tall', () => {
		expect(amountBucket(-1200)).toBe(-1000);
	});
});

describe('median', () => {
	it('returnerer median for odde antall', () => {
		expect(median([3, 1, 2])).toBe(2);
	});

	it('returnerer gjennomsnitt av midterste for partall', () => {
		expect(median([1, 2, 3, 4])).toBe(2.5);
	});

	it('returnerer 0 for tom liste', () => {
		expect(median([])).toBe(0);
	});

	it('returnerer verdien for ett element', () => {
		expect(median([42])).toBe(42);
	});

	it('sorterer før beregning', () => {
		expect(median([10, 1, 5])).toBe(5);
	});
});

describe('isWeekend', () => {
	it('søndag er helg', () => {
		expect(isWeekend(new Date('2026-01-04T12:00:00Z'))).toBe(true); // Sunday
	});

	it('lørdag er helg', () => {
		expect(isWeekend(new Date('2026-01-03T12:00:00Z'))).toBe(true); // Saturday
	});

	it('mandag er ikke helg', () => {
		expect(isWeekend(new Date('2026-01-05T12:00:00Z'))).toBe(false); // Monday
	});

	it('fredag er ikke helg', () => {
		expect(isWeekend(new Date('2026-01-09T12:00:00Z'))).toBe(false); // Friday
	});
});

describe('businessDayDom', () => {
	it('returnerer dag-i-måneden for ukedag', () => {
		expect(businessDayDom(new Date('2026-01-07T12:00:00Z'))).toBe(7); // Wednesday
	});

	it('ruller tilbake fra lørdag til fredag', () => {
		expect(businessDayDom(new Date('2026-01-03T12:00:00Z'))).toBe(2); // Sat → Fri 2. jan
	});

	it('ruller tilbake fra søndag til fredag', () => {
		expect(businessDayDom(new Date('2026-01-04T12:00:00Z'))).toBe(2); // Sun → Fri 2. jan
	});
});

describe('toIsoDate', () => {
	it('returnerer YYYY-MM-DD', () => {
		expect(toIsoDate(new Date('2026-03-15T14:30:00Z'))).toBe('2026-03-15');
	});
});

describe('monthKey', () => {
	it('returnerer YYYY-MM', () => {
		expect(monthKey(new Date('2026-03-15T14:30:00Z'))).toBe('2026-03');
	});
});

describe('selectPaydaySource', () => {
	function income(
		date: string,
		amount: number,
		accountId: string,
		description = 'AMEDIA AS',
		typeText = ''
	): SalaryCandidate {
		return {
			accountId,
			amount,
			description,
			typeText,
			timestamp: new Date(`${date}T12:00:00Z`)
		};
	}

	/** Tolv måneder med lønn der ordet «lønn» bare står i `typeText` (SB1s `category`). */
	function twelveMonthsOfSalary(accountId = 'lonnskonto'): SalaryCandidate[] {
		return Array.from({ length: 12 }, (_, i) =>
			income(`2025-${String(i + 1).padStart(2, '0')}-15`, 48_000, accountId, 'AMEDIA AS', 'Lønn')
		);
	}

	it('finner lønna når ordet bare står i typeText', () => {
		const selection = selectPaydaySource(twelveMonthsOfSalary());

		expect(selection?.source).toBe('keyword');
		expect(selection?.sourceAccountId).toBe('lonnskonto');
		expect(selection?.candidates).toHaveLength(12);
	});

	// Regresjonstesten for «hvorfor har vi bare én lønnsperiode»: to tilfeldige
	// nøkkelordtreff slo ut et helt år med regelmessige innskudd, fordi kandidatsettet
	// ble begrenset til treffene framfor til kontoen.
	it('lar to tilfeldige nøkkelordtreff ikke slå ut et helt år med innskudd', () => {
		const candidates = [
			// Tolv månedlige innskudd uten lønnsord i noe felt.
			...Array.from({ length: 12 }, (_, i) =>
				income(`2025-${String(i + 1).padStart(2, '0')}-15`, 48_000, 'brukskonto', 'AMEDIA AS')
			),
			// To overføringer som tilfeldigvis har ordet i teksten.
			income('2025-03-04', 15_000, 'brukskonto', 'Overføring lønn til felles'),
			income('2025-09-19', 15_000, 'brukskonto', 'Overføring lønn til felles')
		];

		const selection = selectPaydaySource(candidates);

		// Alle inntektene på kontoen er kandidater, ikke bare de to treffene.
		expect(selection?.candidates).toHaveLength(14);

		const paydays = pickBestPerMonth(selection!.candidates, selection!.preferredFingerprint);
		expect(paydays.length).toBeGreaterThanOrEqual(12);
	});

	it('velger kontoen med flest MÅNEDER med treff, ikke flest treff', () => {
		const candidates = [
			// Tolv treff, men alle i samme måned.
			...Array.from({ length: 12 }, (_, i) =>
				income(`2025-04-${String(i + 1).padStart(2, '0')}`, 20_000, 'feilkonto', 'X', 'Lønn')
			),
			// Tre måneder, ett treff i hver.
			income('2025-01-15', 48_000, 'lonnskonto', 'AMEDIA AS', 'Lønn'),
			income('2025-02-14', 48_000, 'lonnskonto', 'AMEDIA AS', 'Lønn'),
			income('2025-03-14', 48_000, 'lonnskonto', 'AMEDIA AS', 'Lønn')
		];

		expect(selectPaydaySource(candidates)?.sourceAccountId).toBe('lonnskonto');
	});

	it('faller tilbake på største månedlige innskudd når ingen nøkkelord finnes', () => {
		const candidates = [
			income('2025-01-15', 48_000, 'brukskonto'),
			income('2025-02-14', 48_000, 'brukskonto'),
			income('2025-01-20', 12_000, 'annen'),
			income('2025-02-20', 12_000, 'annen')
		];

		const selection = selectPaydaySource(candidates);
		expect(selection?.source).toBe('largest-inflow');
		expect(selection?.sourceAccountId).toBe('brukskonto');
	});

	it('utleder fingeravtrykket av treffene, ikke av det hyppigste innskuddet', () => {
		const candidates = [
			// Lønna: én gang i måneden, med ordet i typeText.
			...twelveMonthsOfSalary('brukskonto'),
			// En fast overføring inn samme konto, oftere og med annet beløp.
			...Array.from({ length: 24 }, (_, i) =>
				income(
					`2025-${String((i % 12) + 1).padStart(2, '0')}-${i < 12 ? '02' : '20'}`,
					20_000,
					'brukskonto',
					'FAST OVERFØRING'
				)
			)
		];

		const selection = selectPaydaySource(candidates);
		expect(selection?.preferredFingerprint).toBe(
			`${normalizeDescriptionFingerprint('AMEDIA AS')}|${amountBucket(48_000)}`
		);
	});

	it('returnerer null uten kandidater og uten grunnlag', () => {
		expect(selectPaydaySource([])).toBeNull();
		// Ett enkelt innskudd er ikke et mønster.
		expect(selectPaydaySource([income('2025-01-15', 48_000, 'a')])).toBeNull();
	});
});
