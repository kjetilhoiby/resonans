import { describe, it, expect } from 'vitest';
import {
	CONFIRM_WARNING_DAYS,
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

	it('foreldet åpen periode beholder dagene den rakk', () => {
		// Bortfallet gjelder framover. Fram til september 2026 gjorde `sickDayKeys`
		// `continue` på hele perioden, så dag 15 fjernet unnskyldningen for dag
		// 1–14 også — to uker i senga ble to uker brutt streak, med tilbakevirkende
		// kraft.
		const days = sickDayKeys([period({ endDate: null })], '2026-08-01', '2026-10-01', '2026-10-01');
		expect(days.size).toBe(MAX_OPEN_SICK_DAYS);
		expect(days.has('2026-09-01')).toBe(true);
		expect(days.has('2026-09-14')).toBe(true);
		expect(days.has('2026-09-15')).toBe(false);
	});

	it('en bekreftelse forlenger unnskyldningen', () => {
		const days = sickDayKeys(
			[period({ endDate: null, confirmedOn: '2026-09-12' })],
			'2026-08-01',
			'2026-10-01',
			'2026-09-20'
		);
		expect(days.has('2026-09-20')).toBe(true);
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

	it('foreldet åpen periode sier hvor langt den rakk, og spør', () => {
		const text = describeSickPeriod(resolveSickPeriod(period({ endDate: null }), '2026-10-01'));
		// Ikke bare «utløpt»: dagene fram til taket står, og det må sies — ellers
		// leses bortfallet som at to uker i senga ble strøket.
		expect(text).toContain('Unnskyldte til 14. sep');
		expect(text).toContain('Er du fortsatt syk?');
	});

	it('sier «aldri bekreftet» når ingenting er bekreftet', () => {
		const text = describeSickPeriod(resolveSickPeriod(period({ endDate: null }), '2026-10-01'));
		expect(text).toContain('aldri bekreftet');
		expect(text).not.toContain('sist bekreftet');
	});

	it('navngir bekreftelsesdagen når den finnes', () => {
		const text = describeSickPeriod(
			resolveSickPeriod(period({ endDate: null, confirmedOn: '2026-09-10' }), '2026-10-01')
		);
		expect(text).toContain('sist bekreftet 10. sep');
	});

	it('forvarselet spør før taket ryker', () => {
		// Dag 12 av 14: to dager igjen.
		const text = describeSickPeriod(resolveSickPeriod(period({ endDate: null }), '2026-09-12'));
		expect(text).toContain('Unnskylder 2 dager til');
		expect(text).toContain('er du fortsatt syk?');
	});

	it('siste dagen sies som siste dagen, ikke som «0 dager til»', () => {
		const text = describeSickPeriod(resolveSickPeriod(period({ endDate: null }), '2026-09-14'));
		expect(text).toContain('I dag er siste dagen den unnskylder');
	});
});

describe('bekreftelse som livstegn', () => {
	// Taket er en vakt mot bryteren ingen skrudde av, ikke en påstand om hvor
	// lenge folk er syke. Klokka løper derfor fra siste livstegn.
	it('en bekreftelse flytter taket', () => {
		const r = resolveSickPeriod(period({ endDate: null, confirmedOn: '2026-09-14' }), '2026-09-20');
		expect(r.staleOpen).toBe(false);
		expect(r.countsFrom).toBe('2026-09-14');
		expect(r.effectiveEnd).toBe('2026-09-20');
		expect(r.activeToday).toBe(true);
		expect(r.days).toBe(20);
	});

	it('en bekreftet periode er fortsatt aktiv langt forbi taket fra start', () => {
		const found = activeSickPeriod(
			[period({ endDate: null, confirmedOn: '2026-09-25' })],
			'2026-09-30'
		);
		expect(found?.id).toBe('p1');
	});

	it('en bekreftelse fram i tid eller før start teller ikke', () => {
		// Kan bare komme av en rettet startdato eller en rad skrevet feil. En
		// bekreftelse som ikke ligger i perioden er ikke et livstegn for den.
		expect(
			resolveSickPeriod(period({ endDate: null, confirmedOn: '2026-08-01' }), '2026-09-30').staleOpen
		).toBe(true);
		expect(
			resolveSickPeriod(period({ endDate: null, confirmedOn: '2026-12-01' }), '2026-09-30').staleOpen
		).toBe(true);
	});

	it('daysLeft teller ned, og needsConfirmation slår inn i varselvinduet', () => {
		const at = (today: string) => resolveSickPeriod(period({ endDate: null }), today);
		expect(at('2026-09-10').daysLeft).toBe(4);
		expect(at('2026-09-10').needsConfirmation).toBe(false);
		expect(at('2026-09-11').daysLeft).toBe(CONFIRM_WARNING_DAYS);
		expect(at('2026-09-11').needsConfirmation).toBe(true);
		expect(at('2026-09-14').daysLeft).toBe(0);
		expect(at('2026-09-14').needsConfirmation).toBe(true);
		// Foreldet er ikke «trenger bekreftelse» — da er det for sent, og flaten
		// sier noe annet.
		expect(at('2026-09-15').needsConfirmation).toBe(false);
		expect(at('2026-09-15').staleOpen).toBe(true);
	});

	it('en lukket periode ber aldri om bekreftelse', () => {
		const r = resolveSickPeriod(period({ endDate: '2026-09-03' }), '2026-09-30');
		expect(r.needsConfirmation).toBe(false);
		expect(r.staleOpen).toBe(false);
		expect(r.daysLeft).toBe(0);
	});
});
