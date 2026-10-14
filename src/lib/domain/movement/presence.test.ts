import { describe, expect, it } from 'vitest';
import { describePresenceNow, isPresenceFresh, normalizePresence, pickWeatherLocation } from './presence';

const now = new Date('2026-10-12T08:43:00Z');
const known = new Set(['jobb', 'hjem']);

function base(over: Record<string, unknown> = {}) {
	return {
		state: 'stay',
		since: '2026-10-12T08:24:00+02:00',
		generatedAt: '2026-10-12T08:40:00Z',
		placeId: 'jobb',
		...over
	};
}

describe('normalizePresence', () => {
	it('godtar et opphold på et kjent sted', () => {
		const r = normalizePresence(base(), known, now);
		expect(r).toMatchObject({ ok: true, presence: { state: 'stay', placeId: 'jobb', mode: null, approx: null } });
		if (r.ok) expect(r.presence.since).toBe('2026-10-12T06:24:00.000Z');
	});

	it('avrunder posisjonen til ~1 km også når appen ikke gjorde det', () => {
		const r = normalizePresence(base({ placeId: null, approx: { lat: 59.913872, lon: 10.752245 } }), known, now);
		expect(r.ok && r.presence.approx).toEqual({ lat: 59.91, lon: 10.75 });
	});

	it('dropper et ukjent sted med en advarsel framfor å gjette', () => {
		const r = normalizePresence(base({ placeId: 'nytt', approx: { lat: 59.9, lon: 10.7 } }), known, now);
		expect(r.ok && r.presence.placeId).toBeNull();
		expect(r.ok && r.warnings).toHaveLength(1);
	});

	it('avviser et signal uten sted og uten posisjon', () => {
		expect(normalizePresence(base({ placeId: 'nytt' }), known, now).ok).toBe(false);
	});

	it('krever transportform på en reise og avviser en ukjent', () => {
		expect(normalizePresence(base({ state: 'journey', placeId: null, approx: { lat: 59.9, lon: 10.7 } }), known, now).ok).toBe(false);
		expect(normalizePresence(base({ state: 'journey', placeId: null, mode: 'teleport', approx: { lat: 59.9, lon: 10.7 } }), known, now).ok).toBe(false);
		const r = normalizePresence(base({ state: 'journey', placeId: null, mode: 'e_bike', approx: { lat: 59.9, lon: 10.7 } }), known, now);
		expect(r.ok && r.presence.mode).toBe('e_bike');
	});

	it('avviser et sted på en reise og en transportform på et opphold', () => {
		expect(normalizePresence(base({ state: 'journey', mode: 'walking' }), known, now).ok).toBe(false);
		expect(normalizePresence(base({ mode: 'walking' }), known, now).ok).toBe(false);
	});

	it('avviser tidspunkt uten tidssone og et signal fra framtida', () => {
		expect(normalizePresence(base({ generatedAt: '2026-10-12T08:40:00' }), known, now).ok).toBe(false);
		expect(normalizePresence(base({ generatedAt: '2026-10-12T09:40:00Z' }), known, now).ok).toBe(false);
	});

	it('tar ikke med felt kontrakten ikke kjenner', () => {
		const r = normalizePresence(base({ address: 'Storgata 1', accuracy: 5 }), known, now);
		expect(r.ok && Object.keys(r.presence).sort()).toEqual(['approx', 'generatedAt', 'mode', 'placeId', 'since', 'state']);
	});
});

describe('isPresenceFresh', () => {
	it('et opphold gjelder i to døgn, en reise i en time', () => {
		const at = (h: number) => new Date(now.getTime() + h * 3600_000);
		const stay = { state: 'stay' as const, generatedAt: now.toISOString() };
		const journey = { state: 'journey' as const, generatedAt: now.toISOString() };
		expect(isPresenceFresh(stay, at(47))).toBe(true);
		expect(isPresenceFresh(stay, at(49))).toBe(false);
		expect(isPresenceFresh(journey, at(0.9))).toBe(true);
		expect(isPresenceFresh(journey, at(1.1))).toBe(false);
	});
});

describe('pickWeatherLocation', () => {
	const home = { name: 'Hjemme', latitude: 59.94, longitude: 10.77 };
	const cabin = { name: 'Hytta', latitude: 61.1, longitude: 9.1 };

	it('i dag: der du er nå', () => {
		expect(pickWeatherLocation({ day: '2026-10-12', today: '2026-10-12', now: cabin, home })?.source).toBe('now');
	});

	it('en annen dag: hjemmet, ikke der du er nå', () => {
		expect(pickWeatherLocation({ day: '2026-10-15', today: '2026-10-12', now: cabin, home })).toMatchObject({ name: 'Hjemme', source: 'home' });
	});

	it('uten noe av det: null, så kalleren velger', () => {
		expect(pickWeatherLocation({ day: '2026-10-12', today: '2026-10-12', now: null, home: null })).toBeNull();
	});
});

describe('describePresenceNow', () => {
	it('navngir stedet, i Oslo-tid', () => {
		expect(describePresenceNow({ state: 'stay', since: '2026-10-12T06:24:00Z', mode: null, place: { name: 'Jobb', category: 'work' } }))
			.toBe('Nå: på Jobb siden 08:24.');
	});

	it('en reise sier transportformen', () => {
		expect(describePresenceNow({ state: 'journey', since: '2026-10-12T05:59:00Z', mode: 'e_bike', place: null }))
			.toBe('Nå: underveis (elsykkel) siden 07:59.');
	});

	it('et sted uten navn gjettes ikke', () => {
		expect(describePresenceNow({ state: 'stay', since: '2026-10-12T06:24:00Z', mode: null, place: null }))
			.toBe('Nå: på et sted uten navn siden 08:24.');
	});
});
