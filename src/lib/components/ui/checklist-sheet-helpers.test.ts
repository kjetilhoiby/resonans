import { describe, it, expect } from 'vitest';
import { isTodayDayContext, extractDayDate, extractWeekKey } from './checklist-sheet-helpers';

describe('isTodayDayContext', () => {
	it('er true for dagslista som matcher dagens Oslo-dato', () => {
		const now = new Date('2026-06-27T10:00:00Z'); // Oslo: 2026-06-27 12:00
		expect(isTodayDayContext('week:2026-W26:day:2026-06-27', now)).toBe(true);
	});

	it('er false for en annen dags dagsliste', () => {
		const now = new Date('2026-06-27T10:00:00Z');
		expect(isTodayDayContext('week:2026-W26:day:2026-06-28', now)).toBe(false);
	});

	it('er false for ukelista (ingen day-kontekst)', () => {
		const now = new Date('2026-06-27T10:00:00Z');
		expect(isTodayDayContext('week:2026-W26', now)).toBe(false);
	});

	it('er false for null og tom kontekst', () => {
		const now = new Date('2026-06-27T10:00:00Z');
		expect(isTodayDayContext(null, now)).toBe(false);
		expect(isTodayDayContext('', now)).toBe(false);
	});

	it('bruker Oslo-tidssone på døgnskiftet (UTC-kveld teller som neste Oslo-dag)', () => {
		const now = new Date('2026-06-26T23:30:00Z'); // Oslo: 2026-06-27 01:30
		expect(isTodayDayContext('week:2026-W26:day:2026-06-27', now)).toBe(true);
		expect(isTodayDayContext('week:2026-W26:day:2026-06-26', now)).toBe(false);
	});
});

describe('extractDayDate / extractWeekKey', () => {
	it('henter dato fra day-kontekst', () => {
		expect(extractDayDate('week:2026-W26:day:2026-06-27')).toBe('2026-06-27');
		expect(extractDayDate('week:2026-W26')).toBeNull();
	});

	it('henter ukenøkkel fra week-kontekst', () => {
		expect(extractWeekKey('week:2026-W26')).toBe('2026-W26');
		expect(extractWeekKey('week:2026-W26:day:2026-06-27')).toBeNull();
	});
});
