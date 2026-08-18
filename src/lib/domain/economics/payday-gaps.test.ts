import { describe, it, expect } from 'vitest';
import {
	fillPaydayGaps,
	longestPaydayGapDays,
	MAX_INFERRED_RUN,
	MIN_OBSERVED
} from './payday-gaps';

/** De faktiske lønnsdatoene fra prod 18. august 2026. Mars mangler. */
const PROD_PAYDAYS = [
	'2026-01-22',
	'2026-02-24',
	'2026-04-23',
	'2026-05-21',
	'2026-06-24',
	'2026-07-23'
];

describe('fillPaydayGaps — prod-tilfellet', () => {
	it('fyller mars, som ga 58-dagersperioden', () => {
		const result = fillPaydayGaps(PROD_PAYDAYS);

		expect(result.inferred).toEqual(['2026-03-23']);
		expect(result.observed).toEqual(PROD_PAYDAYS);
		expect(result.dates).toEqual([
			'2026-01-22',
			'2026-02-24',
			'2026-03-23',
			'2026-04-23',
			'2026-05-21',
			'2026-06-24',
			'2026-07-23'
		]);
	});

	// Selve poenget: 58 dager var det som gjorde snittkurven ubrukelig.
	//
	// Etter utfyllingen er det største hullet 34 dager (21. mai → 24. juni). Det er EKTE —
	// lønnsdagen gled fra den 21. til den 24. — og skal ikke fylles. Grensa er derfor 40 og
	// ikke 31: den skiller «én måned med drift» fra «en måned mangler», som er hele skillet
	// funksjonen finnes for.
	it('fjerner det lange hullet, men lar ekte drift stå', () => {
		expect(longestPaydayGapDays(PROD_PAYDAYS)).toBe(58);

		const filled = fillPaydayGaps(PROD_PAYDAYS).dates;
		expect(longestPaydayGapDays(filled)).toBe(34);
		expect(longestPaydayGapDays(filled)).toBeLessThan(40);
	});

	it('etterlater ingenting uforklart', () => {
		const result = fillPaydayGaps(PROD_PAYDAYS);
		expect(result.skippedMonths).toEqual([]);
		expect(result.inferredDom).toBe(23);
	});
});

describe('fillPaydayGaps — vaktene mot å slutte for mye', () => {
	it('nekter å fylle et hull lengre enn MAX_INFERRED_RUN', () => {
		// Fire måneder uten lønn er en livshendelse, ikke en tapt rad.
		const result = fillPaydayGaps(['2026-01-22', '2026-02-23', '2026-03-23', '2026-08-21']);

		expect(result.inferred).toEqual([]);
		expect(result.skippedMonths).toEqual(['2026-04', '2026-05', '2026-06', '2026-07']);
	});

	it('fyller nøyaktig MAX_INFERRED_RUN måneder', () => {
		const result = fillPaydayGaps(['2026-01-22', '2026-02-23', '2026-03-23', '2026-06-23']);

		expect(result.inferred).toHaveLength(MAX_INFERRED_RUN);
		expect(result.inferred).toEqual(['2026-04-23', '2026-05-22']); // 23. mai 2026 er en lørdag
		expect(result.skippedMonths).toEqual([]);
	});

	it('gjør ingenting med for få observasjoner', () => {
		const few = ['2026-01-22', '2026-04-23'];
		expect(few.length).toBeLessThan(MIN_OBSERVED);

		const result = fillPaydayGaps(few);
		expect(result.inferred).toEqual([]);
		expect(result.dates).toEqual(few);
		expect(result.inferredDom).toBeNull();
	});

	it('rapporterer hoppede måneder framfor å utelate dem stille', () => {
		// En stille utelatelse ser ut som full dekning, og det var nettopp det som gjorde
		// 58-dagersperioden vanskelig å feste.
		const result = fillPaydayGaps(['2026-01-22', '2026-02-23', '2026-03-23', '2026-09-23']);
		expect(result.skippedMonths.length).toBeGreaterThan(0);
	});
});

describe('fillPaydayGaps — plasseringen i måneden', () => {
	it('trekker bakover fra helg', () => {
		// Lønnsdag 25; 25. januar 2026 er en søndag → 23. (fredag).
		const result = fillPaydayGaps(['2025-11-25', '2025-12-25', '2026-02-25', '2026-03-25']);
		expect(result.inferred).toEqual(['2026-01-23']);
	});

	it('klemmer mot månedslengden i februar', () => {
		// Lønnsdag 30 finnes ikke i februar. Uten klemming ville datoen blitt 2. mars.
		const result = fillPaydayGaps(['2025-11-28', '2025-12-30', '2026-01-30', '2026-03-30']);
		expect(result.inferred).toEqual(['2026-02-27']); // 28. feb 2026 er en lørdag
		expect(result.inferred[0].slice(0, 7)).toBe('2026-02');
	});

	it('lar sene lønninger stå utenfor medianen', () => {
		// 28. er «sen» (> 25) og skal ikke dra lønnsdagen oppover.
		const result = fillPaydayGaps(['2026-01-20', '2026-02-20', '2026-03-28', '2026-05-20']);
		expect(result.inferredDom).toBe(20);
	});
});

describe('fillPaydayGaps — degenererte inndata', () => {
	it('beholder tidligste dato per måned', () => {
		const result = fillPaydayGaps([
			'2026-01-22',
			'2026-01-29', // to i samme måned
			'2026-02-24',
			'2026-04-23'
		]);
		expect(result.observed).toEqual(['2026-01-22', '2026-02-24', '2026-04-23']);
		expect(result.inferred).toEqual(['2026-03-23']);
	});

	it('ignorerer søppel', () => {
		const result = fillPaydayGaps(['ikke-en-dato', '', '2026-01-22', '2026-02-24', '2026-04-23']);
		expect(result.observed).toEqual(['2026-01-22', '2026-02-24', '2026-04-23']);
	});

	it('tåler tom liste og år-overgang', () => {
		expect(fillPaydayGaps([]).dates).toEqual([]);

		const crossYear = fillPaydayGaps(['2025-11-20', '2025-12-22', '2026-02-20', '2026-03-20']);
		expect(crossYear.inferred).toEqual(['2026-01-20']);
	});

	it('er idempotent — en utfylt serie fylles ikke om igjen', () => {
		const once = fillPaydayGaps(PROD_PAYDAYS);
		const twice = fillPaydayGaps(once.dates);
		expect(twice.dates).toEqual(once.dates);
		expect(twice.inferred).toEqual([]);
	});
});

describe('longestPaydayGapDays', () => {
	it('finner det lengste hullet', () => {
		expect(longestPaydayGapDays(['2026-01-01', '2026-01-31', '2026-04-01'])).toBe(60);
	});

	it('sorterer selv', () => {
		expect(longestPaydayGapDays(['2026-04-01', '2026-01-01', '2026-01-31'])).toBe(60);
	});

	it('er 0 for tom og ettelements liste', () => {
		expect(longestPaydayGapDays([])).toBe(0);
		expect(longestPaydayGapDays(['2026-01-01'])).toBe(0);
	});
});
