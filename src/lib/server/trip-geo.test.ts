import { describe, it, expect } from 'vitest';
import {
	shouldReplaceDayGeo,
	buildObservedDayGeo,
	applyDayGeo,
	osloDayKey,
	pickTripForDate,
	dayWindowInfo,
	reconcileDeclaredGeo,
	type DayGeo,
	type TripCandidate,
	type GeoByDay
} from './trip-geo';

describe('shouldReplaceDayGeo — presedens observert > deklarert > overnatting', () => {
	const overnight: DayGeo = { source: 'overnight', place: 'Hotell' };
	const declared: DayGeo = { source: 'declared', place: 'Volda' };
	const observed: DayGeo = { source: 'observed', place: 'Volda', lat: 62.1, lon: 6.07 };

	it('skriver alltid når dagen er tom', () => {
		expect(shouldReplaceDayGeo(undefined, overnight)).toBe(true);
	});

	it('observert slår deklarert', () => {
		expect(shouldReplaceDayGeo(declared, observed)).toBe(true);
	});

	it('deklarert slår overnatting', () => {
		expect(shouldReplaceDayGeo(overnight, declared)).toBe(true);
	});

	it('deklarert taper mot eksisterende observert', () => {
		expect(shouldReplaceDayGeo(observed, declared)).toBe(false);
	});

	it('overnatting taper mot eksisterende deklarert', () => {
		expect(shouldReplaceDayGeo(declared, overnight)).toBe(false);
	});

	it('lik presedens → ferskeste skriving vinner (siste etappe overskriver)', () => {
		const earlier: DayGeo = { source: 'observed', place: 'Dombås', lat: 62.07, lon: 9.12 };
		expect(shouldReplaceDayGeo(earlier, observed)).toBe(true);
	});
});

describe('buildObservedDayGeo', () => {
	it('bruker bilens faktiske sluttposisjon når den finnes', () => {
		const geo = buildObservedDayGeo({
			id: 'sess-1',
			lastLat: 62.146,
			lastLon: 6.071,
			destLat: 62.1,
			destLon: 6.0,
			destLabel: 'Volda'
		});
		expect(geo).toMatchInlineSnapshot(`
			{
			  "lat": 62.146,
			  "liveSessionId": "sess-1",
			  "lon": 6.071,
			  "place": "Volda",
			  "source": "observed",
			}
		`);
	});

	it('faller tilbake til planlagt destinasjon når sluttposisjon mangler', () => {
		const geo = buildObservedDayGeo({
			id: 'sess-2',
			lastLat: null,
			lastLon: null,
			destLat: 62.1,
			destLon: 6.0,
			destLabel: 'Volda'
		});
		expect(geo?.lat).toBe(62.1);
		expect(geo?.lon).toBe(6.0);
		expect(geo?.source).toBe('observed');
	});

	it('returnerer null uten noen koordinater', () => {
		const geo = buildObservedDayGeo({ id: 'sess-3', lastLat: null, lastLon: null });
		expect(geo).toBeNull();
	});
});

describe('applyDayGeo — ren merge', () => {
	it('legger til dag uten å mutere input', () => {
		const before = { '2026-07-01': { source: 'declared', place: 'Oslo' } as DayGeo };
		const after = applyDayGeo(before, '2026-07-02', { source: 'observed', place: 'Volda' });
		expect(Object.keys(after)).toEqual(['2026-07-01', '2026-07-02']);
		expect(before['2026-07-02' as keyof typeof before]).toBeUndefined();
	});

	it('overskriver når kandidaten har høyere presedens', () => {
		const before = { '2026-07-02': { source: 'declared', place: 'Volda' } as DayGeo };
		const after = applyDayGeo(before, '2026-07-02', {
			source: 'observed',
			place: 'Volda',
			lat: 62.1,
			lon: 6.0
		});
		expect(after['2026-07-02'].source).toBe('observed');
		expect(after['2026-07-02'].lat).toBe(62.1);
	});

	it('beholder eksisterende observert når en deklarert kandidat kommer', () => {
		const before = {
			'2026-07-02': { source: 'observed', place: 'Volda', lat: 62.1, lon: 6.0 } as DayGeo
		};
		const after = applyDayGeo(before, '2026-07-02', { source: 'declared', place: 'Ørsta' });
		expect(after['2026-07-02'].source).toBe('observed');
		expect(after['2026-07-02'].place).toBe('Volda');
	});

	it('håndterer udefinert startkart', () => {
		const after = applyDayGeo(undefined, '2026-07-01', { source: 'overnight', place: 'Hytta' });
		expect(after).toEqual({ '2026-07-01': { source: 'overnight', place: 'Hytta' } });
	});
});

describe('pickTripForDate — serveren utleder turen fra datoen', () => {
	const trips: TripCandidate[] = [
		{ id: 'bilferie', startDate: '2026-07-01', endDate: '2026-07-05' },
		{ id: 'sommer', startDate: '2026-06-20', endDate: '2026-08-10' }
	];

	it('velger turen hvis vindu dekker datoen', () => {
		expect(pickTripForDate([trips[0]], '2026-07-03')).toBe('bilferie');
	});

	it('returnerer null når ingen tur dekker datoen', () => {
		expect(pickTripForDate(trips, '2026-09-01')).toBeNull();
	});

	it('inkluderer endepunktene (start og slutt)', () => {
		expect(pickTripForDate([trips[0]], '2026-07-01')).toBe('bilferie');
		expect(pickTripForDate([trips[0]], '2026-07-05')).toBe('bilferie');
	});

	it('velger smaleste vindu ved overlapp', () => {
		// Begge dekker 3. juli; bilferie (5 dager) er smalere enn sommer (52 dager).
		expect(pickTripForDate(trips, '2026-07-03')).toBe('bilferie');
	});

	it('ignorerer kandidater uten datoer', () => {
		expect(pickTripForDate([{ id: 'udatert' }], '2026-07-03')).toBeNull();
	});
});

describe('dayWindowInfo', () => {
	it('første dag = dag 1', () => {
		expect(dayWindowInfo('2026-07-01', '2026-07-05', '2026-07-01')).toEqual({ dayNo: 1, totalDays: 5 });
	});

	it('midt i vinduet', () => {
		expect(dayWindowInfo('2026-07-01', '2026-07-05', '2026-07-03')).toEqual({ dayNo: 3, totalDays: 5 });
	});

	it('siste dag = totalDays', () => {
		expect(dayWindowInfo('2026-07-01', '2026-07-05', '2026-07-05')).toEqual({ dayNo: 5, totalDays: 5 });
	});

	it('én-dags vindu', () => {
		expect(dayWindowInfo('2026-07-01', '2026-07-01', '2026-07-01')).toEqual({ dayNo: 1, totalDays: 1 });
	});
});

describe('reconcileDeclaredGeo', () => {
	const window = ['2026-07-01', '2026-07-05'] as const;

	it('legger inn deklarerte dager fra dagsoppgaver', () => {
		const out = reconcileDeclaredGeo({}, window[0], window[1], [
			{ date: '2026-07-02', place: 'Volda', lat: 62.1, lon: 6.07 }
		]);
		expect(out['2026-07-02']).toEqual({
			place: 'Volda',
			lat: 62.1,
			lon: 6.07,
			source: 'declared'
		});
	});

	it('rører ikke observert dag (presedens)', () => {
		const existing: GeoByDay = {
			'2026-07-02': { place: 'Volda sentrum', lat: 62.15, lon: 6.08, source: 'observed', liveSessionId: 's1' }
		};
		const out = reconcileDeclaredGeo(existing, window[0], window[1], [
			{ date: '2026-07-02', place: 'Volda', lat: 62.1, lon: 6.07 }
		]);
		expect(out['2026-07-02'].source).toBe('observed');
		expect(out['2026-07-02'].place).toBe('Volda sentrum');
	});

	it('fjerner foreldet deklarert dag i vinduet (oppgave slettet)', () => {
		const existing: GeoByDay = {
			'2026-07-02': { place: 'Volda', source: 'declared' },
			'2026-07-03': { place: 'Ørsta', source: 'declared' }
		};
		const out = reconcileDeclaredGeo(existing, window[0], window[1], [
			{ date: '2026-07-02', place: 'Volda' }
		]);
		expect(out['2026-07-02']).toBeDefined();
		expect(out['2026-07-03']).toBeUndefined();
	});

	it('beholder deklarerte dager utenfor vinduet', () => {
		const existing: GeoByDay = { '2026-06-15': { place: 'Annet', source: 'declared' } };
		const out = reconcileDeclaredGeo(existing, window[0], window[1], []);
		expect(out['2026-06-15']).toBeDefined();
	});

	it('overskriver eldre deklarert med ny deklarert', () => {
		const existing: GeoByDay = { '2026-07-02': { place: 'Gammel', source: 'declared' } };
		const out = reconcileDeclaredGeo(existing, window[0], window[1], [
			{ date: '2026-07-02', place: 'Ny', lat: 1, lon: 2 }
		]);
		expect(out['2026-07-02'].place).toBe('Ny');
	});
});

describe('osloDayKey', () => {
	it('tilskriver natt-ankomst riktig lokal dato (ikke UTC-dagen før)', () => {
		// 23:30 UTC 1. juli = 01:30 norsk sommertid 2. juli
		expect(osloDayKey(new Date('2026-07-01T23:30:00Z'))).toBe('2026-07-02');
	});

	it('gir ISO-format', () => {
		expect(osloDayKey(new Date('2026-07-15T12:00:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});
});
