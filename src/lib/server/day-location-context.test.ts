import { describe, it, expect } from 'vitest';
import { formatDayContextBlock, type DayContext } from './day-location-context';

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
});
