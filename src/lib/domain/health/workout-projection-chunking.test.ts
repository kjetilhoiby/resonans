import { describe, it, expect } from 'vitest';
import { decideProjectionChunk, nextProjectionCursor } from './workout-projection-chunking';

const END = new Date('2026-09-06T00:00:00Z');

describe('decideProjectionChunk', () => {
	it('gir null på en tom side — ingenting å gjøre', () => {
		expect(
			decideProjectionChunk({
				pageLength: 0,
				limit: 2000,
				lastActivityStartTime: null,
				requestedEndDate: END
			})
		).toBeNull();
	});

	it('dekker HELE vinduet når siden ikke fylte grensa', () => {
		// Dette er den vanlige, korte spørringen — kilden gikk tom lenge før taket.
		const decision = decideProjectionChunk({
			pageLength: 40,
			limit: 2000,
			lastActivityStartTime: new Date('2026-08-01T00:00:00Z'),
			requestedEndDate: END
		});
		expect(decision).toEqual({ chunkEndDate: END, hasMore: false });
	});

	it('dekker BARE til siste aktivitet når siden fylte grensa', () => {
		// Dette er feilen: en full side betyr «vi vet ikke om det finnes flere».
		// chunkEndDate må IKKE bli requestedEndDate her.
		const last = new Date('2015-03-01T00:00:00Z');
		const decision = decideProjectionChunk({
			pageLength: 2000,
			limit: 2000,
			lastActivityStartTime: last,
			requestedEndDate: END
		});
		expect(decision).toEqual({ chunkEndDate: last, hasMore: true });
	});

	it('sier fra at det er mer igjen når siden er full og langt fra sluttdatoen', () => {
		const decision = decideProjectionChunk({
			pageLength: 2000,
			limit: 2000,
			lastActivityStartTime: new Date('2018-01-01T00:00:00Z'),
			requestedEndDate: END
		});
		expect(decision?.hasMore).toBe(true);
	});

	it('en full side som likevel når forbi sluttdatoen er ferdig, ikke «mer»', () => {
		// Vinduet var kortere enn det siden dekket — resten av siden er utenfor
		// det vi ble bedt om, og skal ikke tolkes som en ny runde.
		const decision = decideProjectionChunk({
			pageLength: 2000,
			limit: 2000,
			lastActivityStartTime: new Date('2026-09-10T00:00:00Z'),
			requestedEndDate: END
		});
		expect(decision).toEqual({ chunkEndDate: END, hasMore: false });
	});

	it('en full side nøyaktig PÅ sluttdatoen er også ferdig', () => {
		const decision = decideProjectionChunk({
			pageLength: 2000,
			limit: 2000,
			lastActivityStartTime: END,
			requestedEndDate: END
		});
		expect(decision).toEqual({ chunkEndDate: END, hasMore: false });
	});

	it('gir null på en «umulig» full side uten siste aktivitet, framfor å garantere for mye', () => {
		const decision = decideProjectionChunk({
			pageLength: 2000,
			limit: 2000,
			lastActivityStartTime: null,
			requestedEndDate: END
		});
		expect(decision).toBeNull();
	});
});

describe('nextProjectionCursor', () => {
	it('starter neste side ETT millisekund etter forrige dekning', () => {
		const prev = new Date('2018-01-01T00:00:00.000Z');
		expect(nextProjectionCursor(prev).toISOString()).toBe('2018-01-01T00:00:00.001Z');
	});
});
