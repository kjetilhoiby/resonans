import { describe, it, expect } from 'vitest';
import {
	aggregationStartDate,
	AGGREGATE_MAX_LOOKBACK_DAYS,
	FOLLOWUP_MAX_AGE_DAYS,
	NOTIFY_MAX_AGE_DAYS,
	pickLinkEvent,
	selectClustersToNotify,
	selectFollowupDays,
	type WorkoutClusterRef
} from './workout-followup';

const NOW = new Date('2026-08-10T18:00:00Z');

function cluster(
	activityId: string,
	startTime: string,
	evidence: Array<{ eventId: string; timestamp?: string; hasTrackPoints?: boolean }>
): WorkoutClusterRef {
	return {
		activityId,
		startTime,
		evidence: evidence.map((e) => ({
			eventId: e.eventId,
			timestamp: e.timestamp ?? startTime,
			hasTrackPoints: e.hasTrackPoints ?? false
		}))
	};
}

describe('selectClustersToNotify', () => {
	it('varsler om en fersk klynge som inneholder en nyskrevet hendelse', () => {
		const result = selectClustersToNotify({
			clusters: [cluster('a', '2026-08-10T16:00:00Z', [{ eventId: 'a' }])],
			writtenEventIds: ['a'],
			alreadyNotifiedEventIds: [],
			now: NOW
		});

		expect(result).toHaveLength(1);
		expect(result[0].cluster.activityId).toBe('a');
	});

	it('ignorerer klynger som ikke er berørt av skrivingen', () => {
		const result = selectClustersToNotify({
			clusters: [
				cluster('a', '2026-08-10T16:00:00Z', [{ eventId: 'a' }]),
				cluster('b', '2026-08-09T16:00:00Z', [{ eventId: 'b' }])
			],
			writtenEventIds: ['a'],
			alreadyNotifiedEventIds: [],
			now: NOW
		});

		expect(result.map((r) => r.cluster.activityId)).toEqual(['a']);
	});

	it('varsler ikke to ganger når en ANNEN kilde beskriver samme tur', () => {
		// Ekko lastet opp først (event «ekko») og varselet er sendt. Withings-klokka
		// lander etterpå med event «withings» i samme klynge.
		const result = selectClustersToNotify({
			clusters: [
				cluster('ekko', '2026-08-10T16:00:00Z', [
					{ eventId: 'ekko' },
					{ eventId: 'withings' }
				])
			],
			writtenEventIds: ['withings'],
			alreadyNotifiedEventIds: ['ekko'],
			now: NOW
		});

		expect(result).toEqual([]);
	});

	it('varsler ikke to ganger selv om klyngens id flytter seg til den nye kilden', () => {
		// Fella dedup-på-activityId ville gått i: klyngens id er den ELDSTE kilden,
		// så en Withings-rad med tidligere tidsstempel overtar id-en.
		const result = selectClustersToNotify({
			clusters: [
				cluster('withings', '2026-08-10T15:58:00Z', [
					{ eventId: 'withings', timestamp: '2026-08-10T15:58:00Z' },
					{ eventId: 'ekko', timestamp: '2026-08-10T16:00:00Z' }
				])
			],
			writtenEventIds: ['withings'],
			alreadyNotifiedEventIds: ['ekko'],
			now: NOW
		});

		expect(result).toEqual([]);
	});

	it('varsler ikke om økter eldre enn vinduet — backfill skal ikke tømme telefonen', () => {
		const gammel = new Date(NOW.getTime() - (NOTIFY_MAX_AGE_DAYS + 1) * 86400000).toISOString();
		const result = selectClustersToNotify({
			clusters: [cluster('a', gammel, [{ eventId: 'a' }])],
			writtenEventIds: ['a'],
			alreadyNotifiedEventIds: [],
			now: NOW
		});

		expect(result).toEqual([]);
	});

	it('slipper gjennom en økt som ligger så vidt innenfor vinduet', () => {
		const nesten = new Date(NOW.getTime() - (NOTIFY_MAX_AGE_DAYS - 1) * 86400000).toISOString();
		const result = selectClustersToNotify({
			clusters: [cluster('a', nesten, [{ eventId: 'a' }])],
			writtenEventIds: ['a'],
			alreadyNotifiedEventIds: [],
			now: NOW
		});

		expect(result).toHaveLength(1);
	});

	it('slipper gjennom et tidsstempel litt fram i tid — en klokke som går foran er ikke backfill', () => {
		const framtid = new Date(NOW.getTime() + 5 * 60_000).toISOString();
		const result = selectClustersToNotify({
			clusters: [cluster('a', framtid, [{ eventId: 'a' }])],
			writtenEventIds: ['a'],
			alreadyNotifiedEventIds: [],
			now: NOW
		});

		expect(result).toHaveLength(1);
	});
});

describe('pickLinkEvent', () => {
	it('peker på kilden med GPS-spor, ikke på klyngens id', () => {
		const c = cluster('withings', '2026-08-10T15:58:00Z', [
			{ eventId: 'withings', timestamp: '2026-08-10T15:58:00Z', hasTrackPoints: false },
			{ eventId: 'ekko', timestamp: '2026-08-10T16:00:00Z', hasTrackPoints: true }
		]);

		expect(pickLinkEvent(c)).toBe('ekko');
	});

	it('faller tilbake på klyngens id når ingen kilde har spor', () => {
		const c = cluster('withings', '2026-08-10T15:58:00Z', [{ eventId: 'withings' }]);
		expect(pickLinkEvent(c)).toBe('withings');
	});

	it('velger det eldste sporet når flere kilder har spor', () => {
		const c = cluster('a', '2026-08-10T16:00:00Z', [
			{ eventId: 'dropbox', timestamp: '2026-08-10T16:02:00Z', hasTrackPoints: true },
			{ eventId: 'ekko', timestamp: '2026-08-10T16:00:00Z', hasTrackPoints: true }
		]);

		expect(pickLinkEvent(c)).toBe('ekko');
	});
});

describe('selectFollowupDays', () => {
	it('gir Oslo-datoen for ferske økter, uten duplikater', () => {
		const result = selectFollowupDays(
			[new Date('2026-08-10T06:00:00Z'), new Date('2026-08-10T17:00:00Z')],
			NOW
		);

		expect(result.dates).toEqual(['2026-08-10']);
		expect(result.skipped).toBe(0);
	});

	it('bruker Oslo-døgnet, ikke UTC-døgnet', () => {
		// 22:30 UTC 9. august er 00:30 den 10. i Oslo (CEST, UTC+2).
		const result = selectFollowupDays([new Date('2026-08-09T22:30:00Z')], NOW);
		expect(result.dates).toEqual(['2026-08-10']);
	});

	it('kapper økter eldre enn vinduet og rapporterer hvor mange', () => {
		const gammel = new Date(NOW.getTime() - (FOLLOWUP_MAX_AGE_DAYS + 3) * 86400000);
		const result = selectFollowupDays([gammel, new Date('2026-08-10T06:00:00Z')], NOW);

		expect(result.dates).toEqual(['2026-08-10']);
		expect(result.skipped).toBe(1);
	});

	it('kapper en full backfill ned til ingenting framfor å løpe tusen datoer', () => {
		const backfill = Array.from({ length: 500 }, (_, i) =>
			new Date(NOW.getTime() - (30 + i) * 86400000)
		);
		const result = selectFollowupDays(backfill, NOW);

		expect(result.dates).toEqual([]);
		expect(result.skipped).toBe(500);
	});
});

describe('aggregationStartDate', () => {
	it('starter like før den eldste berørte økta', () => {
		const start = aggregationStartDate([new Date('2026-08-10T16:00:00Z')], NOW);
		expect(start.toISOString()).toBe('2026-08-10T15:59:59.000Z');
	});

	it('velger den eldste når flere økter er skrevet', () => {
		const start = aggregationStartDate(
			[new Date('2026-08-10T16:00:00Z'), new Date('2026-08-08T09:00:00Z')],
			NOW
		);
		expect(start.toISOString()).toBe('2026-08-08T08:59:59.000Z');
	});

	it('klipper til taket, så en backfill ikke drar en full historikk-rebuild inn i requesten', () => {
		const start = aggregationStartDate([new Date('2017-10-13T09:00:00Z')], NOW);
		const floor = new Date(NOW.getTime() - AGGREGATE_MAX_LOOKBACK_DAYS * 86400000);
		expect(start.toISOString()).toBe(floor.toISOString());
	});

	it('faller tilbake på taket når ingen gyldige tidsstempler finnes', () => {
		const start = aggregationStartDate([new Date('ugyldig')], NOW);
		const floor = new Date(NOW.getTime() - AGGREGATE_MAX_LOOKBACK_DAYS * 86400000);
		expect(start.toISOString()).toBe(floor.toISOString());
	});
});
