import { describe, it, expect } from 'vitest';
import { pickTrackSource, MIN_USABLE_TRACK_POINTS, type TrackCandidate } from './track-source';

function candidate(over: Partial<TrackCandidate> = {}): TrackCandidate {
	return {
		eventId: 'a',
		priority: 1,
		points: 500,
		startOffsetMs: 0,
		...over
	};
}

describe('pickTrackSource', () => {
	it('gir null uten kandidater', () => {
		expect(pickTrackSource([])).toBeNull();
	});

	it('velger høyeste kildeprioritet', () => {
		const valgt = pickTrackSource([
			candidate({ eventId: 'withings', priority: 3 }),
			candidate({ eventId: 'fil', priority: 4 })
		]);
		expect(valgt?.eventId).toBe('fil');
	});

	it('lar preferGps slå prioritet', () => {
		const valgt = pickTrackSource([
			candidate({ eventId: 'fil', priority: 4 }),
			candidate({ eventId: 'klokke', priority: 3, preferGps: true })
		]);
		expect(valgt?.eventId).toBe('klokke');
	});

	it('respekterer sourceRejected som veto', () => {
		const valgt = pickTrackSource([
			candidate({ eventId: 'avvist', priority: 4, sourceRejected: true }),
			candidate({ eventId: 'beholdt', priority: 3 })
		]);
		expect(valgt?.eventId).toBe('beholdt');
	});

	it('gir null når den ENESTE kandidaten er avvist', () => {
		expect(pickTrackSource([candidate({ sourceRejected: true })])).toBeNull();
	});

	it('en avvist kilde vinner ikke selv med preferGps', () => {
		// Motstridende flagg finnes i basen: `preferGps` og `sourceRejected` er
		// to uavhengige nøkler. Veto skal veie tyngst — «denne kilden er feil
		// for økta» er en sterkere påstand enn «denne eier GPS».
		const valgt = pickTrackSource([
			candidate({ eventId: 'avvist', priority: 4, preferGps: true, sourceRejected: true }),
			candidate({ eventId: 'beholdt', priority: 1 })
		]);
		expect(valgt?.eventId).toBe('beholdt');
	});

	it('foretrekker flest punkter ved samme prioritet', () => {
		const valgt = pickTrackSource([
			candidate({ eventId: 'tynt', priority: 4, points: 12 }),
			candidate({ eventId: 'tett', priority: 4, points: 1800 })
		]);
		expect(valgt?.eventId).toBe('tett');
	});

	it('foretrekker nærmest starttid når prioritet og punkter er like', () => {
		const valgt = pickTrackSource([
			candidate({ eventId: 'langt', priority: 4, startOffsetMs: 90 * 60 * 1000 }),
			candidate({ eventId: 'naert', priority: 4, startOffsetMs: -2 * 60 * 1000 })
		]);
		expect(valgt?.eventId).toBe('naert');
	});

	it('forkaster spor som er for korte å tegne', () => {
		expect(pickTrackSource([candidate({ points: MIN_USABLE_TRACK_POINTS - 1 })])).toBeNull();
	});

	it('er stabil mellom to kall når alt annet er likt', () => {
		const liste = [
			candidate({ eventId: 'b', priority: 4 }),
			candidate({ eventId: 'a', priority: 4 })
		];
		expect(pickTrackSource(liste)?.eventId).toBe('a');
		expect(pickTrackSource([...liste].reverse())?.eventId).toBe('a');
	});

	it('muterer ikke lista den fikk', () => {
		const liste = [
			candidate({ eventId: 'lav', priority: 1 }),
			candidate({ eventId: 'hoy', priority: 4 })
		];
		pickTrackSource(liste);
		expect(liste.map((k) => k.eventId)).toEqual(['lav', 'hoy']);
	});
});
