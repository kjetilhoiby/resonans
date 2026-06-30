import { describe, it, expect } from 'vitest';
import { formatDayContextBlock, movementFromItem, type DayContext } from './day-location-context';

const base: DayContext = { date: '2026-07-03', locations: [], stay: null, movement: [] };

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
