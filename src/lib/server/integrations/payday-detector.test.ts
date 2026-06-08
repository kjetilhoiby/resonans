import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/db', () => ({ db: {} }));

import {
	normalizeDescriptionFingerprint,
	amountBucket,
	median,
	businessDayDom,
	isWeekend,
	toIsoDate,
	monthKey
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
