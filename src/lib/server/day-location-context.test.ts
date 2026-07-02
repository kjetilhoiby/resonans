import { describe, it, expect } from 'vitest';
import {
	formatDayContextBlock,
	movementFromItem,
	sortMovementByTime,
	chainMovementOrigins,
	type DayContext,
	type DayMovement,
	type DayOrigin
} from './day-location-context';

const base: DayContext = {
	date: '2026-07-03',
	locations: [],
	stay: null,
	movement: [],
	origin: null
};

describe('formatDayContextBlock', () => {
	it('tom kontekst gir tom streng', () => {
		expect(formatDayContextBlock(base)).toBe('');
	});

	it('sted i dag uten opphold', () => {
		const out = formatDayContextBlock({ ...base, locations: ['Volda'] });
		expect(out).toContain('Sted i dag: Volda.');
		expect(out).toContain('--- DAGENS STED ---');
	});

	it('flerdagers opphold vinner over sted-linje', () => {
		const out = formatDayContextBlock({
			...base,
			locations: ['Volda'],
			stay: { place: 'Volda', startDate: '2026-07-01', endDate: '2026-07-05', dayNo: 3, totalDays: 5 }
		});
		expect(out).toContain('Opphold i Volda');
		expect(out).toContain('(dag 3 av 5)');
		expect(out).not.toContain('Sted i dag:');
	});

	it('reisesegment med klokkeslett', () => {
		const out = formatDayContextBlock({
			...base,
			movement: [{ mode: 'drive', destination: 'Volda', time: '12:30' }]
		});
		expect(out).toContain('Reise i dag: kjøretur til Volda kl. 12:30.');
	});

	it('reisesegment uten destinasjon og uten tid', () => {
		const out = formatDayContextBlock({ ...base, movement: [{ mode: 'flight', time: null }] });
		expect(out).toContain('Reise i dag: fly.');
	});

	it('viser ankomstfrist når den finnes', () => {
		const out = formatDayContextBlock({
			...base,
			movement: [{ mode: 'drive', destination: 'Oslo', time: '12:00', arriveBy: '18:00' }]
		});
		expect(out).toContain('Reise i dag: kjøretur til Oslo kl. 12:00 (innen kl. 18:00).');
	});

	it('viser «fra X til Y» når etappen har et startpunkt', () => {
		const out = formatDayContextBlock({
			...base,
			movement: [{ mode: 'drive', origin: 'Volda', destination: 'Oslo', time: '09:00' }]
		});
		expect(out).toContain('Reise i dag: kjøretur fra Volda til Oslo kl. 09:00.');
	});

	it('utelater «fra» når startpunkt er likt destinasjonen', () => {
		const out = formatDayContextBlock({
			...base,
			movement: [{ mode: 'drive', origin: 'Oslo', destination: 'Oslo', time: '09:00' }]
		});
		expect(out).toContain('Reise i dag: kjøretur til Oslo kl. 09:00.');
		expect(out).not.toContain('fra Oslo');
	});
});

describe('sortMovementByTime', () => {
	it('sorterer etappene kronologisk', () => {
		const movement: DayMovement[] = [
			{ mode: 'drive', destination: 'Dovre', time: '16:00' },
			{ mode: 'drive', destination: 'Hamar', time: '09:00' }
		];
		expect(sortMovementByTime(movement).map((m) => m.destination)).toEqual(['Hamar', 'Dovre']);
	});

	it('legger etapper uten tid sist og bevarer ellers rekkefølgen', () => {
		const movement: DayMovement[] = [
			{ mode: 'flight', destination: 'A', time: null },
			{ mode: 'drive', destination: 'B', time: '10:00' },
			{ mode: 'boat', destination: 'C', time: null }
		];
		expect(sortMovementByTime(movement).map((m) => m.destination)).toEqual(['B', 'A', 'C']);
	});
});

describe('chainMovementOrigins', () => {
	const origin: DayOrigin = {
		place: 'Volda',
		lat: 62.15,
		lon: 6.07,
		source: 'declared',
		fromDate: '2026-07-03'
	};

	it('sammensatt reise: Hamar blir stopp, Dovre destinasjon', () => {
		const movement: DayMovement[] = [
			{ mode: 'drive', destination: 'Hamar', time: '09:00' },
			{ mode: 'drive', destination: 'Dovre', time: '16:00' }
		];
		const chained = chainMovementOrigins(movement, origin);
		expect(chained.map((m) => [m.origin, m.destination])).toEqual([
			['Volda', 'Hamar'],
			['Hamar', 'Dovre']
		]);
	});

	it('kjeder også når etappene kommer i feil rekkefølge (sorterer først)', () => {
		const movement: DayMovement[] = [
			{ mode: 'drive', destination: 'Dovre', time: '16:00' },
			{ mode: 'drive', destination: 'Hamar', time: '09:00' }
		];
		const chained = chainMovementOrigins(movement, origin);
		expect(chained.map((m) => m.destination)).toEqual(['Hamar', 'Dovre']);
		expect(chained[1].origin).toBe('Hamar');
	});

	it('kjeder koordinater: neste etappe arver forrige etappes destinasjonskoordinat', () => {
		const movement: DayMovement[] = [
			{ mode: 'drive', destination: 'Hamar', time: '09:00', destLat: 60.79, destLon: 11.07 },
			{ mode: 'drive', destination: 'Dovre', time: '16:00' }
		];
		const chained = chainMovementOrigins(movement, origin);
		expect(chained[0]).toMatchObject({ origin: 'Volda', originLat: 62.15, originLon: 6.07 });
		expect(chained[1]).toMatchObject({ origin: 'Hamar', originLat: 60.79, originLon: 11.07 });
	});

	it('uten origin: første etappe mangler startpunkt, men resten kjedes', () => {
		const movement: DayMovement[] = [
			{ mode: 'drive', destination: 'Hamar', time: '09:00' },
			{ mode: 'drive', destination: 'Dovre', time: '16:00' }
		];
		const chained = chainMovementOrigins(movement, null);
		expect(chained[0].origin).toBeUndefined();
		expect(chained[1].origin).toBe('Hamar');
	});

	it('utelater koordinater når origin bare har sted (ikke koordinat)', () => {
		const chained = chainMovementOrigins([{ mode: 'drive', destination: 'Hamar', time: '09:00' }], {
			place: 'Volda',
			source: 'declared',
			fromDate: '2026-07-03'
		});
		expect(chained[0].origin).toBe('Volda');
		expect(chained[0].originLat).toBeUndefined();
		expect(chained[0].originLon).toBeUndefined();
	});

	it('muterer ikke input', () => {
		const movement: DayMovement[] = [{ mode: 'drive', destination: 'Hamar', time: '09:00' }];
		chainMovementOrigins(movement, origin);
		expect(movement[0].origin).toBeUndefined();
	});
});

describe('movementFromItem', () => {
	it('returnerer null for ikke-reise-punkter', () => {
		expect(movementFromItem({ text: 'Handle mat' })).toBeNull();
		expect(movementFromItem({ text: 'Sted: Oslo', metadata: { kind: 'location' } })).toBeNull();
	});

	it('bygger segment fra reise-metadata med tid', () => {
		expect(
			movementFromItem({
				text: 'Kjøre til Oslo',
				metadata: {
					kind: 'travel',
					travelMode: 'drive',
					destination: 'Oslo',
					timeHour: 12,
					timeMinute: 0
				}
			})
		).toEqual({ mode: 'drive', destination: 'Oslo', time: '12:00' });
	});

	it('tar med destLat/destLon når begge koordinater finnes', () => {
		const m = movementFromItem({
			text: 'Kjøre til Oslo',
			metadata: {
				kind: 'travel',
				travelMode: 'drive',
				destination: 'Oslo',
				lat: 59.9139,
				lon: 10.7522
			}
		});
		expect(m).toEqual({
			mode: 'drive',
			destination: 'Oslo',
			time: null,
			destLat: 59.9139,
			destLon: 10.7522
		});
	});

	it('utelater koordinater når bare én finnes', () => {
		const m = movementFromItem({
			text: 'Kjøre til Oslo',
			metadata: { kind: 'travel', travelMode: 'drive', destination: 'Oslo', lat: 59.9139 }
		});
		expect(m?.destLat).toBeUndefined();
		expect(m?.destLon).toBeUndefined();
	});

	it('tar med arriveBy («HH:MM») når en frist er satt', () => {
		const m = movementFromItem({
			text: 'Kjøre til Oslo',
			metadata: {
				kind: 'travel',
				travelMode: 'drive',
				destination: 'Oslo',
				arriveByHour: 18,
				arriveByMinute: 0
			}
		});
		expect(m?.arriveBy).toBe('18:00');
	});

	it('utelater arriveBy når ingen frist er satt', () => {
		const m = movementFromItem({
			text: 'Kjøre til Oslo',
			metadata: { kind: 'travel', travelMode: 'drive', destination: 'Oslo' }
		});
		expect(m?.arriveBy).toBeUndefined();
	});
});
