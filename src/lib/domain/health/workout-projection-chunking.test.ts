import { describe, it, expect } from 'vitest';
import {
	decideProjectionChunk,
	nextProjectionCursor,
	type ProjectionPage
} from './workout-projection-chunking';

const END = new Date('2026-09-06T00:00:00Z');

function page(overrides: Partial<ProjectionPage> = {}): ProjectionPage {
	return {
		eventsRead: 500,
		eventLimit: 2000,
		activityStartTimes: [new Date('2015-03-01T10:00:00Z')],
		requestedEndDate: END,
		...overrides
	};
}

describe('decideProjectionChunk', () => {
	it('en side som ikke fylte hendelsesgrensa dekker hele resten av vinduet', () => {
		const decision = decideProjectionChunk(page({ eventsRead: 500, eventLimit: 2000 }));
		expect(decision).toEqual({ chunkEndDate: END, hasMore: false });
	});

	it('en tom side gir null — ingenting å slette, ingenting å skrive', () => {
		expect(decideProjectionChunk(page({ activityStartTimes: [] }))).toBeNull();
	});

	/**
	 * REGRESJON. Feilen som fjernet ni års historikk i prod: 2000 hendelser blir
	 * ~900 aktiviteter fordi tre kilder beskriver samme tur, og en regel som
	 * sammenlignet ANTALL AKTIVITETER mot HENDELSESGRENSA leste det som «kilden
	 * gikk tom» — og lot kalleren slette hele vinduet.
	 */
	it('900 aktiviteter fra 2000 hendelser er AVKORTET, ikke tomt', () => {
		const starts = Array.from(
			{ length: 900 },
			(_, i) => new Date(Date.UTC(2015, 0, 1 + i, 10))
		);
		const decision = decideProjectionChunk(
			page({ eventsRead: 2000, eventLimit: 2000, activityStartTimes: starts })
		);
		expect(decision?.hasMore).toBe(true);
		// Kuttet skal ligge på sidens egne data, ALDRI på vinduets slutt.
		expect(decision!.chunkEndDate.getTime()).toBeLessThan(END.getTime());
	});

	it('kutter rett FØR den nyeste aktiviteten, så klyngen leses hel neste gang', () => {
		const newest = new Date('2016-06-01T08:00:00Z');
		const decision = decideProjectionChunk(
			page({
				eventsRead: 2000,
				eventLimit: 2000,
				activityStartTimes: [new Date('2015-01-01T10:00:00Z'), newest]
			})
		);
		expect(decision!.chunkEndDate.getTime()).toBe(newest.getTime() - 1);
		// Markøren blir nøyaktig den nyeste aktivitetens tidspunkt.
		expect(nextProjectionCursor(decision!.chunkEndDate).getTime()).toBe(newest.getTime());
	});

	/**
	 * Lista fra aktivitetslaget er sortert SYNKENDE mens hendelsene hentes
	 * stigende. En regel som stolte på posisjon leste den eldste som den nyeste.
	 */
	it('finner ytterpunktet uansett rekkefølge på starttidspunktene', () => {
		const times = [
			new Date('2016-06-01T08:00:00Z'),
			new Date('2015-01-01T10:00:00Z'),
			new Date('2015-08-09T06:00:00Z')
		];
		const descending = decideProjectionChunk(
			page({ eventsRead: 2000, eventLimit: 2000, activityStartTimes: times })
		);
		const ascending = decideProjectionChunk(
			page({ eventsRead: 2000, eventLimit: 2000, activityStartTimes: [...times].reverse() })
		);
		expect(descending).toEqual(ascending);
		expect(descending!.chunkEndDate.getTime()).toBe(
			new Date('2016-06-01T08:00:00Z').getTime() - 1
		);
	});

	it('en avkortet side som rekker forbi vinduet dekker vinduet, og ikke mer', () => {
		const decision = decideProjectionChunk(
			page({
				eventsRead: 2000,
				eventLimit: 2000,
				activityStartTimes: [new Date('2026-01-01T10:00:00Z'), new Date('2026-09-30T10:00:00Z')]
			})
		);
		expect(decision).toEqual({ chunkEndDate: END, hasMore: false });
	});

	/**
	 * Uten denne grenen kan løkka ikke terminere: et kutt «før den nyeste» ville
	 * ikke flyttet markøren, og samme side hentes i det uendelige.
	 */
	it('gjør framgang når hele siden er ett tidspunkt', () => {
		const only = new Date('2015-03-01T10:00:00Z');
		const decision = decideProjectionChunk(
			page({
				eventsRead: 2000,
				eventLimit: 2000,
				activityStartTimes: [only, new Date(only)]
			})
		);
		expect(decision).toEqual({ chunkEndDate: only, hasMore: true });
		expect(nextProjectionCursor(decision!.chunkEndDate).getTime()).toBe(only.getTime() + 1);
	});

	it('markøren flytter seg alltid framover', () => {
		const at = new Date('2020-05-05T00:00:00Z');
		expect(nextProjectionCursor(at).getTime()).toBe(at.getTime() + 1);
	});
});
