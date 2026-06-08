import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseTaskDateTime, parseSubtaskDates } from './date-time-parser';

describe('parseTaskDateTime', () => {
	beforeEach(() => {
		// Wednesday 2026-01-07 12:00 UTC
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-01-07T12:00:00Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('extracts day name and time: "Ring byggeleder onsdag kl. 10"', () => {
		const result = parseTaskDateTime('Ring byggeleder onsdag kl. 10');
		expect(result.text).toBe('Ring byggeleder');
		expect(result.startDate).toBe('2026-01-07');
		expect(result.hour).toBe(10);
		expect(result.minute).toBeUndefined();
	});

	it('extracts day name only: "Møte fredag"', () => {
		const result = parseTaskDateTime('Møte fredag');
		expect(result.text).toBe('Møte');
		expect(result.startDate).toBe('2026-01-09');
		expect(result.hour).toBeUndefined();
	});

	it('wraps to next week for past days: "mandag"', () => {
		const result = parseTaskDateTime('Trening mandag');
		expect(result.startDate).toBe('2026-01-12');
	});

	it('extracts time at start: "Kl. 14 presentasjon"', () => {
		const result = parseTaskDateTime('Kl. 14 presentasjon');
		expect(result.text).toBe('presentasjon');
		expect(result.hour).toBe(14);
		expect(result.startDate).toBeUndefined();
	});

	it('extracts HH:MM time: "Lunsj 12:00"', () => {
		const result = parseTaskDateTime('Lunsj 12:00');
		expect(result.text).toBe('Lunsj');
		expect(result.hour).toBe(12);
		expect(result.minute).toBe(0);
	});

	it('extracts kl. with minutes: "kl. 14:30 møte med Per"', () => {
		const result = parseTaskDateTime('kl. 14:30 møte med Per');
		expect(result.text).toBe('møte med Per');
		expect(result.hour).toBe(14);
		expect(result.minute).toBe(30);
	});

	it('returns text unchanged when no date/time is present', () => {
		const result = parseTaskDateTime('Kjøpe melk');
		expect(result.text).toBe('Kjøpe melk');
		expect(result.startDate).toBeUndefined();
		expect(result.hour).toBeUndefined();
		expect(result.minute).toBeUndefined();
	});
});

describe('parseSubtaskDates', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-01-07T12:00:00Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('maps over an array of subtask texts', () => {
		const results = parseSubtaskDates([
			'Møte fredag kl. 10',
			'Kjøpe melk',
			'Ring lege onsdag'
		]);
		expect(results).toHaveLength(3);
		expect(results[0]).toMatchObject({ text: 'Møte', startDate: '2026-01-09', hour: 10 });
		expect(results[1]).toMatchObject({ text: 'Kjøpe melk' });
		expect(results[1].startDate).toBeUndefined();
		expect(results[2]).toMatchObject({ text: 'Ring lege', startDate: '2026-01-07' });
	});
});
