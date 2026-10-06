import { describe, it, expect } from 'vitest';
import {
	isStale,
	normalizeTimelineDay,
	osloDayBounds,
	parseTimelineEnvelope,
	referencedPlaceIds,
	MAX_DAYS_PER_UPLOAD
} from './timeline';

const HOME = 'home-1';
const WORK = 'work-1';
const known = new Set([HOME, WORK]);

/** En hverdag i sommertid: hjemme til 08:03, sykkel til jobb, på jobb. */
function commuteDay(overrides: Record<string, unknown> = {}) {
	return {
		date: '2026-09-28',
		generatedAt: '2026-09-29T06:12:00+02:00',
		detectorVersion: '2026.10.1',
		entries: [
			{
				kind: 'stay',
				startedAt: '2026-09-28T00:00:00+02:00',
				endedAt: '2026-09-28T08:03:00+02:00',
				placeId: HOME
			},
			{
				kind: 'journey',
				startedAt: '2026-09-28T08:03:00+02:00',
				endedAt: '2026-09-28T08:25:00+02:00',
				fromPlaceId: HOME,
				toPlaceId: WORK,
				distanceMeters: 7240,
				legs: [
					{
						mode: 'e_bike',
						modeSource: 'label',
						confidence: 0.5,
						startedAt: '2026-09-28T08:03:00+02:00',
						endedAt: '2026-09-28T08:25:00+02:00',
						distanceMeters: 7240,
						labelRef: 'c3d2'
					}
				]
			},
			{
				kind: 'stay',
				startedAt: '2026-09-28T08:25:00+02:00',
				endedAt: '2026-09-28T16:40:00+02:00',
				placeId: null,
				center: { lat: 59.91234, lon: 10.74876 }
			}
		],
		...overrides
	};
}

function entries(day: ReturnType<typeof commuteDay>) {
	return day.entries as Array<Record<string, any>>;
}

describe('parseTimelineEnvelope', () => {
	it('godtar 1–31 dager', () => {
		expect(parseTimelineEnvelope({ days: [commuteDay()] }).ok).toBe(true);
	});

	it('avviser tom liste, for mange dager og feil form', () => {
		expect(parseTimelineEnvelope({ days: [] }).ok).toBe(false);
		expect(parseTimelineEnvelope({ days: Array(MAX_DAYS_PER_UPLOAD + 1).fill({}) }).ok).toBe(false);
		expect(parseTimelineEnvelope([commuteDay()]).ok).toBe(false);
		expect(parseTimelineEnvelope(null).ok).toBe(false);
	});
});

describe('osloDayBounds', () => {
	it('gir Oslo-døgnet i UTC, også i sommertid', () => {
		const bounds = osloDayBounds('2026-09-28');
		expect(bounds?.start.toISOString()).toBe('2026-09-27T22:00:00.000Z');
		expect(bounds?.end.toISOString()).toBe('2026-09-28T22:00:00.000Z');
	});

	it('har 25 timer natta klokka stilles tilbake', () => {
		const bounds = osloDayBounds('2026-10-25');
		expect(bounds!.end.getTime() - bounds!.start.getTime()).toBe(25 * 3600_000);
	});

	it('avviser datoer som ikke finnes', () => {
		expect(osloDayBounds('2026-02-30')).toBeNull();
		expect(osloDayBounds('28.09.2026')).toBeNull();
	});
});

describe('normalizeTimelineDay', () => {
	it('normaliserer en hel dag til UTC og deler i opphold og reiser', () => {
		const result = normalizeTimelineDay(commuteDay(), known);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.day.generatedAt).toBe('2026-09-29T04:12:00.000Z');
		expect(result.day.stays).toHaveLength(2);
		expect(result.day.journeys).toHaveLength(1);
		expect(result.day.journeys[0].legs[0]).toEqual({
			mode: 'e_bike',
			modeSource: 'label',
			confidence: 0.5,
			startedAt: '2026-09-28T06:03:00.000Z',
			endedAt: '2026-09-28T06:25:00.000Z',
			distanceMeters: 7240,
			labelRef: 'c3d2'
		});
	});

	it('avrunder sentrum på ukjente steder, også når appen glemmer det', () => {
		const result = normalizeTimelineDay(commuteDay(), known);
		if (!result.ok) throw new Error(result.message);
		expect(result.day.stays[1].center).toEqual({ lat: 59.912, lon: 10.749 });
	});

	it('lagrer aldri koordinater for et opphold på et kjent sted', () => {
		const day = commuteDay();
		entries(day)[0].center = { lat: 59.938, lon: 10.766 };
		const result = normalizeTimelineDay(day, known);
		if (!result.ok) throw new Error(result.message);
		expect(result.day.stays[0].center).toBeNull();
	});

	it('tar bare med felt kontrakten kjenner', () => {
		const day = commuteDay();
		entries(day)[1].path = [[59.9, 10.7]];
		entries(day)[1].legs[0].points = [{ lat: 59.9, lon: 10.7 }];
		const result = normalizeTimelineDay(day, known);
		if (!result.ok) throw new Error(result.message);
		expect(Object.keys(result.day.journeys[0]).sort()).toEqual(
			['date', 'distanceMeters', 'endedAt', 'fromPlaceId', 'legs', 'startedAt', 'toPlaceId'].sort()
		);
		expect(result.day.journeys[0].legs[0]).not.toHaveProperty('points');
	});

	it('avviser en ukjent transportform framfor å gjette', () => {
		const day = commuteDay();
		entries(day)[1].legs[0].mode = 'scooter';
		const result = normalizeTimelineDay(day, known);
		expect(result).toMatchObject({ ok: false, code: 'unknown_mode' });
	});

	it('avviser et sted serveren ikke har fått', () => {
		const result = normalizeTimelineDay(commuteDay(), new Set([HOME]));
		expect(result).toMatchObject({ ok: false, code: 'unknown_place' });
		if (!result.ok) expect(result.message).toContain('toPlaceId');
	});

	it('krever sentrum når oppholdet ikke ligger på et kjent sted', () => {
		const day = commuteDay();
		delete entries(day)[2].center;
		expect(normalizeTimelineDay(day, known)).toMatchObject({ ok: false, code: 'invalid_entry' });
	});

	it('avviser en oppføring utenfor dagen', () => {
		const day = commuteDay();
		entries(day)[0].startedAt = '2026-09-27T23:30:00+02:00';
		expect(normalizeTimelineDay(day, known)).toMatchObject({ ok: false, code: 'outside_day' });
	});

	it('avviser overlapp mellom oppføringer, men godtar at de møtes', () => {
		const day = commuteDay();
		entries(day)[1].startedAt = '2026-09-28T08:00:00+02:00';
		entries(day)[1].legs[0].startedAt = '2026-09-28T08:00:00+02:00';
		expect(normalizeTimelineDay(day, known)).toMatchObject({ ok: false, code: 'overlap' });
		expect(normalizeTimelineDay(commuteDay(), known).ok).toBe(true);
	});

	it('avviser en etappe utenfor reisen', () => {
		const day = commuteDay();
		entries(day)[1].legs[0].endedAt = '2026-09-28T08:30:00+02:00';
		expect(normalizeTimelineDay(day, known)).toMatchObject({ ok: false, code: 'invalid_leg' });
	});

	it('krever minst én etappe på en reise', () => {
		const day = commuteDay();
		entries(day)[1].legs = [];
		expect(normalizeTimelineDay(day, known)).toMatchObject({ ok: false, code: 'invalid_leg' });
	});

	it('avviser tidspunkter uten offset, siden de ville blitt tolket som UTC', () => {
		const day = commuteDay();
		entries(day)[0].endedAt = '2026-09-28T08:03:00';
		expect(normalizeTimelineDay(day, known)).toMatchObject({ ok: false, code: 'invalid_entry' });
	});

	it('avviser en ugyldig dato', () => {
		expect(normalizeTimelineDay(commuteDay({ date: '2026-13-01' }), known)).toMatchObject({
			ok: false,
			code: 'invalid_date'
		});
	});

	it('godtar en dag uten oppføringer — telefonen kan ha vært av', () => {
		const result = normalizeTimelineDay(commuteDay({ entries: [] }), known);
		expect(result.ok).toBe(true);
	});
});

describe('referencedPlaceIds', () => {
	it('finner alle sted-id-er dagen peker på', () => {
		expect(referencedPlaceIds(commuteDay()).sort()).toEqual([HOME, WORK].sort());
	});
});

describe('isStale', () => {
	it('er foreldet bare når det lagrede er nyere', () => {
		expect(isStale('2026-09-29T06:00:00Z', '2026-09-29T05:00:00Z')).toBe(true);
		expect(isStale('2026-09-29T06:00:00Z', '2026-09-29T06:00:00Z')).toBe(false);
		expect(isStale('2026-09-29T05:00:00Z', '2026-09-29T06:00:00Z')).toBe(false);
		expect(isStale(null, '2026-09-29T06:00:00Z')).toBe(false);
	});
});
