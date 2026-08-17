import { describe, it, expect } from 'vitest';
import {
	DEFAULT_MAX_DELTA_DAYS,
	doubleCountedTotal,
	matchReservationsToBooked,
	type ReservationCandidate
} from './reservation-matching';

function res(
	id: string,
	date: string,
	amount: number,
	merchantKey = 'kiwi bolerl',
	accountId = 'a1'
): ReservationCandidate {
	return { id, accountId, date, amount, merchantKey, booked: false };
}
function booked(
	id: string,
	date: string,
	amount: number,
	merchantKey = 'kiwi bolerl',
	accountId = 'a1'
): ReservationCandidate {
	return { id, accountId, date, amount, merchantKey, booked: true };
}

describe('matchReservationsToBooked', () => {
	it('parrer en reservasjon med den bokførte raden dagen etter', () => {
		const { matches, unmatched } = matchReservationsToBooked([
			res('r1', '2026-07-29', -113),
			booked('b1', '2026-07-30', -113)
		]);

		expect(matches).toHaveLength(1);
		expect(matches[0]).toMatchObject({
			reservationId: 'r1',
			bookedId: 'b1',
			amount: 113,
			deltaDays: 1,
			merchantKeyChanged: false
		});
		expect(unmatched).toHaveLength(0);
	});

	// Selve poenget med modulen. Målingen viste 110 av 271 par med endret beskrivelse.
	it('parrer på tvers av endret beskrivelse — valutaprefikset', () => {
		const { matches } = matchReservationsToBooked([
			res('r1', '2026-07-27', -74, 'sek ica'),
			booked('b1', '2026-07-27', -74, 'ica nara')
		]);

		expect(matches).toHaveLength(1);
		expect(matches[0].merchantKeyChanged).toBe(true);
	});

	// Regresjonen. LATERAL-joinen ga hver reservasjon sin nærmeste bokførte rad uten å
	// reservere den, så tre PENDING på samme beløp ga tre par mot ett bokført kjøp.
	it('lar ikke tre reservasjoner peke på samme bokførte rad', () => {
		const { matches, unmatched } = matchReservationsToBooked([
			res('r1', '2026-07-28', -255),
			res('r2', '2026-07-28', -255),
			res('r3', '2026-07-28', -255),
			booked('b1', '2026-07-29', -255)
		]);

		expect(matches).toHaveLength(1);
		expect(unmatched).toHaveLength(2);
		expect(doubleCountedTotal(matches)).toBe(255);
	});

	it('parrer tre mot tre når det finnes tre bokførte', () => {
		const { matches, unmatched } = matchReservationsToBooked([
			res('r1', '2026-07-28', -255),
			res('r2', '2026-07-28', -255),
			res('r3', '2026-07-28', -255),
			booked('b1', '2026-07-29', -255),
			booked('b2', '2026-07-29', -255),
			booked('b3', '2026-07-30', -255)
		]);

		expect(matches).toHaveLength(3);
		expect(unmatched).toHaveLength(0);
		expect(new Set(matches.map((m) => m.bookedId)).size).toBe(3);
	});

	it('krever eksakt beløp — 33 av 35 par hadde 0 % avvik', () => {
		const { matches, unmatched } = matchReservationsToBooked([
			res('r1', '2026-07-29', -113),
			booked('b1', '2026-07-30', -113.5)
		]);

		expect(matches).toHaveLength(0);
		expect(unmatched.map((u) => u.id)).toEqual(['r1']);
	});

	it('krysser ikke kontogrenser', () => {
		const { matches } = matchReservationsToBooked([
			res('r1', '2026-07-29', -113, 'kiwi', 'a1'),
			booked('b1', '2026-07-30', -113, 'kiwi', 'a2')
		]);

		expect(matches).toHaveLength(0);
	});

	it('respekterer datovinduet', () => {
		const inside = matchReservationsToBooked([
			res('r1', '2026-07-20', -113),
			booked('b1', '2026-07-23', -113)
		]);
		const outside = matchReservationsToBooked([
			res('r1', '2026-07-20', -113),
			booked('b1', '2026-07-25', -113)
		]);

		expect(DEFAULT_MAX_DELTA_DAYS).toBe(3);
		expect(inside.matches).toHaveLength(1);
		expect(outside.matches).toHaveLength(0);
	});

	it('tar med negativ datoforskjell — bokført FØR reservasjonen', () => {
		// Målingen viste −1 og −2 dager i prod. Retningen er ikke garantert.
		const { matches } = matchReservationsToBooked([
			res('r1', '2026-07-29', -113),
			booked('b1', '2026-07-28', -113)
		]);

		expect(matches[0].deltaDays).toBe(-1);
	});

	it('foretrekker uendret beskrivelse når to bokførte er like nære', () => {
		const { matches } = matchReservationsToBooked([
			res('r1', '2026-07-29', -113, 'kiwi bolerl'),
			booked('b-annen', '2026-07-30', -113, 'rema boler'),
			booked('b-samme', '2026-07-30', -113, 'kiwi bolerl')
		]);

		expect(matches[0].bookedId).toBe('b-samme');
		expect(matches[0].merchantKeyChanged).toBe(false);
	});

	it('foretrekker nærmeste dato foran samme beskrivelse', () => {
		const { matches } = matchReservationsToBooked([
			res('r1', '2026-07-29', -113, 'kiwi bolerl'),
			booked('b-naer', '2026-07-29', -113, 'sek kiwi'),
			booked('b-fjern', '2026-08-01', -113, 'kiwi bolerl')
		]);

		expect(matches[0].bookedId).toBe('b-naer');
	});

	it('parrer aldri to reservasjoner med hverandre', () => {
		const { matches, unmatched } = matchReservationsToBooked([
			res('r1', '2026-07-29', -113),
			res('r2', '2026-07-30', -113)
		]);

		expect(matches).toHaveLength(0);
		expect(unmatched).toHaveLength(2);
	});

	it('rører ikke bokførte rader uten reservasjon', () => {
		const { matches, unmatched } = matchReservationsToBooked([
			booked('b1', '2026-07-29', -113),
			booked('b2', '2026-07-30', -255)
		]);

		expect(matches).toHaveLength(0);
		expect(unmatched).toHaveLength(0);
	});

	it('er deterministisk uansett inndatarekkefølge', () => {
		const rows = [
			res('r1', '2026-07-28', -255),
			res('r2', '2026-07-29', -255),
			booked('b1', '2026-07-29', -255),
			booked('b2', '2026-07-30', -255)
		];
		const forward = matchReservationsToBooked(rows);
		const reversed = matchReservationsToBooked([...rows].reverse());

		expect(forward.matches).toEqual(reversed.matches);
	});
});

describe('doubleCountedTotal', () => {
	it('summerer kronene som telles to ganger', () => {
		const { matches } = matchReservationsToBooked([
			res('r1', '2026-07-29', -113),
			booked('b1', '2026-07-30', -113),
			res('r2', '2026-07-29', -255, 'coop mega'),
			booked('b2', '2026-07-30', -255, 'coop mega')
		]);

		expect(doubleCountedTotal(matches)).toBe(368);
	});

	it('gir 0 uten par', () => {
		expect(doubleCountedTotal([])).toBe(0);
	});
});
