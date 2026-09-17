import { describe, it, expect } from 'vitest';
import { normalizeEventInput } from './event-input';

describe('normalizeEventInput — oppretting', () => {
	const opts = { partial: false };

	it('krever navn og dato', () => {
		expect(normalizeEventInput({}, opts).error).toBe('Arrangementet må ha et navn.');
		expect(normalizeEventInput({ title: 'Karpe' }, opts).error).toBe('Arrangementet må ha en dato.');
	});

	it('avviser tomt navn — mellomrom er ikke et navn', () => {
		expect(normalizeEventInput({ title: '   ', eventDate: '2026-11-14' }, opts).error).toBe(
			'Arrangementet må ha et navn.'
		);
	});

	it('normaliserer feltene', () => {
		const result = normalizeEventInput(
			{
				title: '  Karpe  ',
				kind: 'Konsert',
				eventDate: '2026-11-14',
				startTime: '19.30',
				venue: ' Oslo Spektrum ',
				ticketCount: '2'
			},
			opts
		);
		expect(result.ok).toBe(true);
		expect(result.value).toEqual({
			title: 'Karpe',
			kind: 'konsert',
			eventDate: '2026-11-14',
			startTime: '19:30',
			venue: 'Oslo Spektrum',
			ticketCount: 2
		});
	});

	it('avviser ugyldig dato og klokkeslett med en melding flaten kan vise', () => {
		expect(normalizeEventInput({ title: 'X', eventDate: '14.11.2026' }, opts).error).toBe(
			'Ugyldig dato — bruk ÅÅÅÅ-MM-DD.'
		);
		expect(normalizeEventInput({ title: 'X', eventDate: '2026-11-14', startTime: '99:99' }, opts).error).toBe(
			'Ugyldig klokkeslett — bruk TT:MM.'
		);
	});

	it('avviser en sluttdato før startdatoen', () => {
		const result = normalizeEventInput(
			{ title: 'X', eventDate: '2026-11-14', endDate: '2026-11-01' },
			opts
		);
		expect(result.error).toBe('Sluttdatoen kan ikke være før startdatoen.');
	});

	it('godtar sluttdato lik startdato', () => {
		expect(
			normalizeEventInput({ title: 'X', eventDate: '2026-11-14', endDate: '2026-11-14' }, opts).ok
		).toBe(true);
	});
});

describe('normalizeEventInput — retting', () => {
	const opts = { partial: true };

	it('utelatt felt betyr «ikke endre»', () => {
		const result = normalizeEventInput({ venue: 'Sentrum Scene' }, opts);
		expect(result.ok).toBe(true);
		expect(result.value).toEqual({ venue: 'Sentrum Scene' });
	});

	it('eksplisitt null NULLER feltet — ellers kunne en feilskrevet inngang aldri fjernes', () => {
		expect(normalizeEventInput({ entrance: null }, opts).value).toEqual({ entrance: null });
		expect(normalizeEventInput({ startTime: '' }, opts).value).toEqual({ startTime: null });
		expect(normalizeEventInput({ endDate: null }, opts).value).toEqual({ endDate: null });
	});

	it('slipper ikke gjennom felter en klient ikke eier', () => {
		const result = normalizeEventInput(
			{ userId: 'noen-andre', id: 'x', createdAt: '2020-01-01', tickets: [] } as never,
			opts
		);
		expect(result.value).toEqual({});
	});

	it('godtar bare kjente statuser', () => {
		expect(normalizeEventInput({ status: 'cancelled' }, opts).value).toEqual({ status: 'cancelled' });
		expect(normalizeEventInput({ status: 'slettet' }, opts).error).toBe('Ukjent status.');
	});

	it('ukjent type blir null framfor å gjette', () => {
		expect(normalizeEventInput({ kind: 'foredrag' }, opts).value).toEqual({ kind: null });
	});

	it('krever ikke navn og dato', () => {
		expect(normalizeEventInput({}, opts).ok).toBe(true);
	});
});

describe('normalizeEventInput — billettlenke', () => {
	const opts = { partial: true };

	it('normaliserer og godtar en vanlig lenke', () => {
		expect(normalizeEventInput({ ticketUrl: 'cosmopolite.no/billett' }, opts).value).toEqual({
			ticketUrl: 'https://cosmopolite.no/billett'
		});
	});

	it('avviser et skjema som ikke hører hjemme i en href', () => {
		expect(normalizeEventInput({ ticketUrl: 'javascript:alert(1)' }, opts).error).toBe(
			'Lenka må være en http- eller https-adresse.'
		);
	});

	it('tom streng fjerner lenka', () => {
		expect(normalizeEventInput({ ticketUrl: '' }, opts).value).toEqual({ ticketUrl: null });
	});
});
