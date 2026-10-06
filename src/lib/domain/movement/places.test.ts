import { describe, it, expect } from 'vitest';
import { normalizePlaces } from './places';

function place(overrides: Record<string, unknown> = {}) {
	return {
		id: '6f1c',
		name: 'Hjemme',
		category: 'home',
		lat: 59.93801,
		lon: 10.76602,
		radiusMeters: 120,
		named: true,
		archived: false,
		...overrides
	};
}

describe('normalizePlaces', () => {
	it('normaliserer en gyldig liste', () => {
		const result = normalizePlaces({ places: [place(), place({ id: 'a90e', name: 'Jobb', category: 'work' })] });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.places[0]).toEqual({
			externalId: '6f1c',
			name: 'Hjemme',
			category: 'home',
			latitude: 59.93801,
			longitude: 10.76602,
			radiusMeters: 120,
			named: true,
			archived: false
		});
	});

	it('godtar en tom liste — alle steder arkiveres da', () => {
		expect(normalizePlaces({ places: [] })).toEqual({ ok: true, places: [] });
	});

	it('avviser en ukjent kategori', () => {
		const result = normalizePlaces({ places: [place({ category: 'hytte' })] });
		expect(result.ok).toBe(false);
	});

	it('avviser samme id to ganger', () => {
		expect(normalizePlaces({ places: [place(), place()] }).ok).toBe(false);
	});

	it('avviser koordinater og radius utenfor gyldig område', () => {
		expect(normalizePlaces({ places: [place({ lat: 91 })] }).ok).toBe(false);
		expect(normalizePlaces({ places: [place({ lon: 'x' })] }).ok).toBe(false);
		expect(normalizePlaces({ places: [place({ radiusMeters: 0 })] }).ok).toBe(false);
	});

	it('krever named og archived som sannhetsverdier', () => {
		expect(normalizePlaces({ places: [place({ named: undefined })] }).ok).toBe(false);
	});

	it('tar ikke med felt kontrakten ikke kjenner', () => {
		const result = normalizePlaces({ places: [place({ visitCount: 40, address: 'Gata 1' })] });
		if (!result.ok) throw new Error(result.message);
		expect(result.places[0]).not.toHaveProperty('address');
		expect(result.places[0]).not.toHaveProperty('visitCount');
	});
});
