import { describe, it, expect } from 'vitest';
import {
	MAX_OPEN_SICK_DAYS,
	activeSickPeriod,
	describeSickPeriod,
	resolveSickPeriod,
	sickDayKeys,
	validateSickPeriod
} from './sick-periods';

const period = (over: Partial<Parameters<typeof resolveSickPeriod>[0]> = {}) => ({
	id: 'p1',
	startDate: '2026-09-01',
	endDate: '2026-09-03' as string | null,
	note: null,
	...over
});

describe('resolveSickPeriod', () => {
	it('dekker start til slutt inklusive', () => {
		const r = resolveSickPeriod(period(), '2026-09-10');
		expect(r.effectiveEnd).toBe('2026-09-03');
		expect(r.days).toBe(3);
		expect(r.activeToday).toBe(false);
	});

	it('unnskylder aldri dager fram i tid', () => {
		// Registrert «syk ut uka» på tirsdag: onsdag og torsdag har ikke vært,
		// og en dag som ikke har skjedd kan ikke være unnskyldt.
		const r = resolveSickPeriod(period({ endDate: '2026-09-05' }), '2026-09-02');
		expect(r.effectiveEnd).toBe('2026-09-02');
		expect(r.days).toBe(2);
		expect(r.activeToday).toBe(true);
	});

	it('åpen periode løper til i dag', () => {
		const r = resolveSickPeriod(period({ endDate: null }), '2026-09-04');
		expect(r.open).toBe(true);
		expect(r.staleOpen).toBe(false);
		expect(r.effectiveEnd).toBe('2026-09-04');
		expect(r.days).toBe(4);
	});

	it('åpen periode slutter å unnskylde etter taket', () => {
		const r = resolveSickPeriod(period({ endDate: null }), '2026-09-30');
		expect(r.staleOpen).toBe(true);
		expect(r.activeToday).toBe(false);
		expect(r.days).toBe(MAX_OPEN_SICK_DAYS);
	});
});

describe('activeSickPeriod', () => {
	it('finner perioden som dekker i dag', () => {
		const found = activeSickPeriod([period(), period({ id: 'p2', startDate: '2026-09-20', endDate: null })], '2026-09-21');
		expect(found?.id).toBe('p2');
	});

	it('en foreldet åpen periode er ikke aktiv', () => {
		expect(activeSickPeriod([period({ endDate: null })], '2026-10-01')).toBeNull();
	});
});

describe('sickDayKeys', () => {
	it('gir hver dag i perioden', () => {
		const days = sickDayKeys([period()], '2026-08-01', '2026-09-30', '2026-09-30');
		expect([...days].sort()).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
	});

	it('overlappende perioder gir ikke duplikater', () => {
		const days = sickDayKeys(
			[period(), period({ id: 'p2', startDate: '2026-09-02', endDate: '2026-09-04' })],
			'2026-08-01',
			'2026-09-30',
			'2026-09-30'
		);
		expect(days.size).toBe(4);
	});

	it('klipper mot vinduet', () => {
		const days = sickDayKeys([period()], '2026-09-02', '2026-09-02', '2026-09-30');
		expect([...days]).toEqual(['2026-09-02']);
	});

	it('foreldet åpen periode unnskylder ingenting', () => {
		const days = sickDayKeys([period({ endDate: null })], '2026-08-01', '2026-10-01', '2026-10-01');
		expect(days.size).toBe(0);
	});
});

describe('validateSickPeriod', () => {
	it('avviser startdato fram i tid', () => {
		const r = validateSickPeriod({ startDate: '2026-09-10' }, '2026-09-02');
		expect(r.ok).toBe(false);
	});

	it('avviser sluttdato før startdato', () => {
		const r = validateSickPeriod({ startDate: '2026-09-05', endDate: '2026-09-01' }, '2026-09-10');
		expect(r.ok).toBe(false);
	});

	it('tom sluttdato blir null — altså «inntil videre»', () => {
		const r = validateSickPeriod({ startDate: '2026-09-01', endDate: '' }, '2026-09-10');
		expect(r.ok && r.value.endDate).toBeNull();
	});

	it('godtar sluttdato fram i tid', () => {
		// «Jeg regner med å være dårlig ut uka» er en gyldig registrering;
		// resolveSickPeriod sørger for at framtida ikke unnskyldes ennå.
		const r = validateSickPeriod({ startDate: '2026-09-01', endDate: '2026-09-20' }, '2026-09-02');
		expect(r.ok).toBe(true);
	});
});

describe('describeSickPeriod', () => {
	it('lukket periode med spenn', () => {
		expect(describeSickPeriod(resolveSickPeriod(period(), '2026-09-10'))).toBe(
			'Syk 1.–3. sep (3 dager)'
		);
	});

	it('én dag', () => {
		expect(
			describeSickPeriod(resolveSickPeriod(period({ endDate: '2026-09-01' }), '2026-09-10'))
		).toBe('Syk 1. sep');
	});

	it('åpen periode sier at sluttdato mangler', () => {
		expect(describeSickPeriod(resolveSickPeriod(period({ endDate: null }), '2026-09-03'))).toContain(
			'ingen sluttdato'
		);
	});

	it('foreldet åpen periode sier at den ikke unnskylder lenger', () => {
		expect(describeSickPeriod(resolveSickPeriod(period({ endDate: null }), '2026-10-01'))).toContain(
			'unnskylder ikke lenger'
		);
	});
});
