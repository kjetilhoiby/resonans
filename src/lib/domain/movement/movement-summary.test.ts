import { describe, it, expect } from 'vitest';
import {
	matchPlaces,
	normalizePlaceText,
	placeLabel,
	summarizeArrivals,
	summarizeDay,
	summarizeLastVisit,
	summarizePlaces,
	type MovementData,
	type MovementPlace
} from './movement-summary';
import type { StoredJourney, StoredLeg, StoredStay } from './timeline';

const HOME: MovementPlace = { id: 'h', name: 'Hjemme', category: 'home', named: true, archived: false };
const WORK: MovementPlace = { id: 'w', name: 'Kontoret', category: 'work', named: true, archived: false };
const CABIN: MovementPlace = { id: 'c', name: 'Hytta', category: 'recreation', named: true, archived: false };
const AUTO: MovementPlace = { id: 'a', name: 'Nytt sted', category: 'unknown', named: false, archived: false };
const places = [HOME, WORK, CABIN, AUTO];

/** Oslo-tid i sommertid → ISO i UTC, slik serveren lagrer det. */
function at(date: string, clock: string): string {
	return new Date(`${date}T${clock}:00+02:00`).toISOString();
}

function stay(date: string, from: string, to: string, placeId: string | null): StoredStay {
	return {
		date,
		startedAt: at(date, from),
		endedAt: to === '24:00' ? new Date(Date.parse(at(date, '00:00')) + 86_400_000).toISOString() : at(date, to),
		placeId,
		center: placeId ? null : { lat: 59.9, lon: 10.7 }
	};
}

function leg(date: string, from: string, to: string, mode: StoredLeg['mode'], meters: number, source: StoredLeg['modeSource'] = 'auto'): StoredLeg {
	return { mode, modeSource: source, confidence: null, startedAt: at(date, from), endedAt: at(date, to), distanceMeters: meters, labelRef: null };
}

function journey(date: string, from: string, to: string, fromPlaceId: string | null, toPlaceId: string | null, legs: StoredLeg[]): StoredJourney {
	return {
		date,
		startedAt: at(date, from),
		endedAt: at(date, to),
		fromPlaceId,
		toPlaceId,
		distanceMeters: legs.reduce((sum, l) => sum + l.distanceMeters, 0),
		legs
	};
}

function commuteDay(date: string, leave: string, arrive: string, mode: StoredLeg['mode']): MovementData {
	return {
		stays: [stay(date, '00:00', leave, 'h'), stay(date, arrive, '16:00', 'w'), stay(date, '16:30', '24:00', 'h')],
		journeys: [
			journey(date, leave, arrive, 'h', 'w', [leg(date, leave, arrive, mode, 7240)]),
			journey(date, '16:00', '16:30', 'w', 'h', [leg(date, '16:00', '16:30', mode, 7240)])
		],
		places
	};
}

function merge(...days: MovementData[]): MovementData {
	return {
		stays: days.flatMap((d) => d.stays),
		journeys: days.flatMap((d) => d.journeys),
		places
	};
}

describe('placeLabel', () => {
	const map = new Map(places.map((p) => [p.id, p]));

	it('bruker navnet på et navngitt sted', () => {
		expect(placeLabel('w', map)).toBe('Kontoret');
	});

	it('sier aldri «Nytt sted» — og aldri koordinater', () => {
		expect(placeLabel('a', map)).toBe('et sted uten navn');
		expect(placeLabel(null, map)).toBe('et sted uten navn');
	});
});

describe('matchPlaces', () => {
	it('finner hytta uansett bøyning', () => {
		expect(matchPlaces('hytta', places)).toMatchObject({ kind: 'name', places: [CABIN] });
		expect(matchPlaces('på hytte', places)).toMatchObject({ kind: 'name', places: [CABIN] });
	});

	it('faller tilbake på kategoriordet', () => {
		const match = matchPlaces('jobben', places);
		expect(match).toMatchObject({ kind: 'category', category: 'work', places: [WORK] });
	});

	it('et navn vinner over kategorien', () => {
		const withHome = [...places, { ...HOME, id: 'h2', name: 'Hjemme hos mor', category: 'family' as const }];
		expect(matchPlaces('hjemme hos mor', withHome)).toMatchObject({ kind: 'name' });
	});

	it('gjetter ikke når ingenting treffer', () => {
		expect(matchPlaces('Trondheim', places)).toEqual({ kind: 'none' });
	});

	it('normaliserer norske bokstaver', () => {
		expect(normalizePlaceText('Søsters Bøle')).toBe('sosters bole');
	});
});

describe('summarizeDay', () => {
	it('lister dagen i rekkefølge med Oslo-klokkeslett', () => {
		const day = summarizeDay('2026-09-28', commuteDay('2026-09-28', '08:03', '08:25', 'e_bike'));
		expect(day.weekday).toBe('mandag');
		expect(day.entries.map((e) => `${e.kind} ${e.from}–${e.to}`)).toEqual([
			'opphold 00:00–08:03',
			'reise 08:03–08:25',
			'opphold 08:25–16:00',
			'reise 16:00–16:30',
			'opphold 16:30–24:00'
		]);
		expect(day.entries[1]).toMatchObject({ fromPlace: 'Hjemme', toPlace: 'Kontoret', km: 7.2 });
		expect(day.kmByMode).toEqual({ elsykkel: 14.5 });
	});

	it('merker en rettet transportform', () => {
		const data = commuteDay('2026-09-28', '08:03', '08:25', 'e_bike');
		data.journeys[0].legs[0].modeSource = 'user';
		expect(summarizeDay('2026-09-28', data).entries[1].legs?.[0]).toMatchObject({ mode: 'elsykkel', source: 'rettet' });
	});
});

describe('summarizeArrivals', () => {
	const data = merge(
		commuteDay('2026-09-28', '08:03', '08:25', 'e_bike'),
		commuteDay('2026-09-29', '07:50', '08:15', 'e_bike'),
		commuteDay('2026-09-30', '08:10', '08:40', 'transit')
	);

	it('gir ankomst, transportform og når brukeren dro, nyeste først', () => {
		const summary = summarizeArrivals(new Set(['w']), 'Kontoret', data);
		expect(summary.arrivals.map((a) => `${a.date} ${a.arrivedAt} ${a.by} ${a.leftAt}`)).toEqual([
			'2026-09-30 08:40 kollektivt 16:00',
			'2026-09-29 08:15 elsykkel 16:00',
			'2026-09-28 08:25 elsykkel 16:00'
		]);
		expect(summary.typicalArrival).toBe('08:25');
		expect(summary.byMode).toEqual({ elsykkel: 2, kollektivt: 1 });
	});

	it('natta som fortsetter er ikke en ankomst hjem', () => {
		const summary = summarizeArrivals(new Set(['h']), 'Hjemme', data);
		expect(summary.arrivals.every((a) => a.arrivedAt === '16:30')).toBe(true);
	});

	it('en kort pause før ankomsten gjør den ikke transportløs', () => {
		const day = commuteDay('2026-10-01', '08:00', '08:20', 'cycling');
		day.stays[1] = stay('2026-10-01', '08:28', '16:00', 'w');
		const summary = summarizeArrivals(new Set(['w']), 'Kontoret', day);
		expect(summary.arrivals[0]).toMatchObject({ arrivedAt: '08:28', by: 'sykkel' });
	});

	it('teller en dag på stedet uten ankomst for seg', () => {
		const night: MovementData = { stays: [stay('2026-10-02', '00:00', '24:00', 'h')], journeys: [], places };
		expect(summarizeArrivals(new Set(['h']), 'Hjemme', night)).toMatchObject({ arrivals: [], daysWithoutArrival: 1 });
	});
});

describe('summarizeLastVisit', () => {
	it('finner siste dag på hytta og teller besøksdager', () => {
		const data: MovementData = {
			stays: [
				stay('2026-07-23', '15:00', '24:00', 'c'),
				stay('2026-07-24', '00:00', '14:00', 'c'),
				stay('2026-08-02', '09:00', '10:00', 'h')
			],
			journeys: [],
			places
		};
		expect(summarizeLastVisit(new Set(['c']), 'Hytta', data, '2026-10-06')).toEqual({
			place: 'Hytta',
			lastDate: '2026-07-24',
			lastWeekday: 'fredag',
			daysAgo: 74,
			visitDays: 2,
			hours: 23
		});
	});

	it('sier fra når stedet aldri er besøkt i vinduet', () => {
		const data: MovementData = { stays: [], journeys: [], places };
		expect(summarizeLastVisit(new Set(['c']), 'Hytta', data, '2026-10-06')).toMatchObject({ lastDate: null, visitDays: 0 });
	});
});

describe('summarizePlaces', () => {
	it('lister navngitte steder, mest besøkt først, og teller de uten navn', () => {
		const result = summarizePlaces(commuteDay('2026-09-28', '08:03', '08:25', 'e_bike'));
		expect(result.places.map((p) => `${p.name} ${p.visitDays}`)).toEqual(['Hjemme 1', 'Kontoret 1', 'Hytta 0']);
		expect(result.unnamedPlaces).toBe(1);
	});
});
