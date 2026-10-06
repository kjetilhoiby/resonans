import { describe, it, expect } from 'vitest';
import { pickHomePlace, roundForWeather, type PlaceWithPosition } from './home-place';

function place(overrides: Partial<PlaceWithPosition>): PlaceWithPosition {
	return {
		name: 'Hjemme',
		category: 'home',
		named: true,
		archived: false,
		latitude: 59.93801,
		longitude: 10.76602,
		updatedAt: new Date('2026-10-01T00:00:00Z'),
		...overrides
	};
}

describe('pickHomePlace', () => {
	it('velger et navngitt hjem framfor et automatisk', () => {
		const auto = place({ name: 'Nytt sted', named: false, updatedAt: new Date('2026-10-05T00:00:00Z') });
		const named = place({});
		expect(pickHomePlace([auto, named])).toBe(named);
	});

	it('hopper over arkiverte hjem og andre kategorier', () => {
		expect(pickHomePlace([place({ archived: true }), place({ category: 'work' })])).toBeNull();
	});

	it('det sist oppdaterte vinner blant like', () => {
		const old = place({ name: 'Gamle leiligheten' });
		const fresh = place({ name: 'Huset', updatedAt: new Date('2026-10-04T00:00:00Z') });
		expect(pickHomePlace([old, fresh])).toBe(fresh);
	});
});

describe('roundForWeather', () => {
	it('sender ~1 km presisjon ut av huset', () => {
		expect(roundForWeather(59.93801)).toBe(59.94);
	});
});
