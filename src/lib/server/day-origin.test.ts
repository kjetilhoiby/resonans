import { describe, it, expect } from 'vitest';
import { resolveDeclaredOrigin, enrichMovementWithOrigins, type DayOrigin } from './day-origin';
import type { DayMovement } from './day-location-context';
import type { LocationStay } from '$lib/utils/checklist-group';

function stay(place: string, startDate: string, endDate: string, lat?: number, lon?: number): LocationStay {
	return { place, startDate, endDate, lat, lon };
}

function drive(destination?: string, destLat?: number, destLon?: number): DayMovement {
	return { mode: 'drive', destination, time: null, destLat, destLon };
}

describe('resolveDeclaredOrigin', () => {
	it('velger opphold som dekker i dag og startet tidligere (brukeren våknet der)', () => {
		const origin = resolveDeclaredOrigin('2026-07-03', [stay('Volda', '2026-07-01', '2026-07-05', 62.15, 6.07)], []);
		expect(origin).toEqual({
			place: 'Volda',
			lat: 62.15,
			lon: 6.07,
			source: 'declared',
			fromDate: '2026-07-01'
		});
	});

	it('ignorerer opphold som starter i dag (ankomst, ikke avreisepunkt)', () => {
		const origin = resolveDeclaredOrigin('2026-07-03', [stay('Volda', '2026-07-03', '2026-07-05')], []);
		expect(origin).toBeNull();
	});

	it('bruker gårsdagens siste reisesegment med destinasjon', () => {
		const origin = resolveDeclaredOrigin(
			'2026-07-03',
			[],
			[drive('Lillehammer', 61.11, 10.46), drive('Hamar', 60.79, 11.07)]
		);
		expect(origin).toEqual({
			place: 'Hamar',
			lat: 60.79,
			lon: 11.07,
			source: 'declared',
			fromDate: '2026-07-02'
		});
	});

	it('foretrekker opphold-inn-i-dag over gårsdagens reise (dagsutflukt tilbake)', () => {
		const origin = resolveDeclaredOrigin(
			'2026-07-03',
			[stay('Volda', '2026-07-01', '2026-07-05')],
			[drive('Ålesund')]
		);
		expect(origin?.place).toBe('Volda');
	});

	it('faller tilbake til opphold som dekket gårsdagen', () => {
		const origin = resolveDeclaredOrigin('2026-07-03', [stay('Hjemme', '2026-06-28', '2026-07-02')], []);
		expect(origin).toEqual({
			place: 'Hjemme',
			source: 'declared',
			fromDate: '2026-06-28'
		});
	});

	it('utelater koordinat når oppholdet mangler det (begge eller ingen)', () => {
		const origin = resolveDeclaredOrigin('2026-07-03', [stay('Volda', '2026-07-01', '2026-07-05', 62.15)], []);
		expect(origin?.lat).toBeUndefined();
		expect(origin?.lon).toBeUndefined();
	});

	it('gir null når verken opphold eller gårsreise finnes', () => {
		expect(resolveDeclaredOrigin('2026-07-03', [], [])).toBeNull();
	});
});

describe('enrichMovementWithOrigins', () => {
	const dayOrigin: DayOrigin = {
		place: 'Volda',
		lat: 62.15,
		lon: 6.07,
		source: 'declared',
		fromDate: '2026-07-02'
	};

	it('etappe 1 arver dagens origin, etappe N får forrige etappes destinasjon', () => {
		const enriched = enrichMovementWithOrigins(
			[drive('Hamar', 60.79, 11.07), drive('Oslo', 59.91, 10.75)],
			dayOrigin
		);
		expect(enriched[0].origin).toBe('Volda');
		expect(enriched[0].originLat).toBe(62.15);
		expect(enriched[0].originLon).toBe(6.07);
		expect(enriched[0].originSource).toBe('declared');
		expect(enriched[1].origin).toBe('Hamar');
		expect(enriched[1].originLat).toBe(60.79);
		expect(enriched[1].originLon).toBe(11.07);
		expect(enriched[1].originSource).toBe('declared');
	});

	it('observert origin gir koordinat uten navn på etappe 1', () => {
		const enriched = enrichMovementWithOrigins([drive('Hamar')], {
			lat: 61.5,
			lon: 8.2,
			source: 'observed',
			fromDate: '2026-07-02'
		});
		expect(enriched[0].origin).toBeUndefined();
		expect(enriched[0].originLat).toBe(61.5);
		expect(enriched[0].originLon).toBe(8.2);
		expect(enriched[0].originSource).toBe('observed');
	});

	it('utelater alle origin-felt når dagens origin er ukjent', () => {
		const enriched = enrichMovementWithOrigins([drive('Hamar')], null);
		expect(enriched[0].origin).toBeUndefined();
		expect(enriched[0].originLat).toBeUndefined();
		expect(enriched[0].originSource).toBeUndefined();
	});

	it('etappe N uten forrige destinasjon får ingen origin-felt', () => {
		const enriched = enrichMovementWithOrigins([drive(), drive('Oslo')], null);
		expect(enriched[1].origin).toBeUndefined();
		expect(enriched[1].originSource).toBeUndefined();
	});

	it('muterer ikke input', () => {
		const movement = [drive('Hamar', 60.79, 11.07)];
		enrichMovementWithOrigins(movement, dayOrigin);
		expect(movement[0].origin).toBeUndefined();
	});
});
