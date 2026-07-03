import { describe, it, expect } from 'vitest';
import {
	mergeTrackSamples,
	deriveTrackEvent,
	buildTrackPoints,
	WAKE_GAP_MS,
	type TrackEventRow,
	type TrackSample
} from './tesla-track';

function row(dataType: string, iso: string, data: Record<string, unknown>): TrackEventRow {
	return { dataType, timestamp: new Date(iso), data };
}

function sample(iso: string, fields: Partial<TrackSample> = {}): TrackSample {
	return { tsMs: Date.parse(iso), ...fields };
}

describe('mergeTrackSamples', () => {
	it('slår sammen de tre dataTypene med samme tidsstempel til ett sample', () => {
		const merged = mergeTrackSamples([
			row('drive_state', '2026-07-03T09:15:00Z', { lat: 60.79, lon: 11.07, speedKmh: 52, shiftState: 'D' }),
			row('charge_state', '2026-07-03T09:15:00Z', { charging: false, batteryPercent: 48 }),
			row('vehicle_state', '2026-07-03T09:15:00Z', { odometerKm: 40123.4 })
		]);
		expect(merged).toEqual([
			{
				tsMs: Date.parse('2026-07-03T09:15:00Z'),
				lat: 60.79,
				lon: 11.07,
				speedKmh: 52,
				shiftState: 'D',
				charging: false,
				batteryPercent: 48,
				odometerKm: 40123.4
			}
		]);
	});

	it('skiller manglende drive_state (undefined) fra eksplisitt parkert (null)', () => {
		const merged = mergeTrackSamples([
			row('charge_state', '2026-07-03T09:00:00Z', { charging: true }),
			row('drive_state', '2026-07-03T09:15:00Z', { lat: 60, lon: 11, shiftState: null })
		]);
		expect(merged[0].shiftState).toBeUndefined();
		expect(merged[1].shiftState).toBeNull();
	});

	it('sorterer kronologisk uavhengig av input-rekkefølge', () => {
		const merged = mergeTrackSamples([
			row('drive_state', '2026-07-03T10:00:00Z', { lat: 61, lon: 11 }),
			row('drive_state', '2026-07-03T09:00:00Z', { lat: 60, lon: 11 })
		]);
		expect(merged.map((s) => s.lat)).toEqual([60, 61]);
	});
});

describe('deriveTrackEvent', () => {
	it('gir park ved overgang fra kjøring til P eller null', () => {
		const prev = sample('2026-07-03T09:00:00Z', { shiftState: 'D' });
		expect(deriveTrackEvent(prev, sample('2026-07-03T09:15:00Z', { shiftState: 'P' }))).toBe('park');
		expect(deriveTrackEvent(prev, sample('2026-07-03T09:15:00Z', { shiftState: null }))).toBe('park');
	});

	it('gir depart ved overgang fra parkert til D/R/N', () => {
		const prev = sample('2026-07-03T09:00:00Z', { shiftState: null });
		expect(deriveTrackEvent(prev, sample('2026-07-03T09:15:00Z', { shiftState: 'D' }))).toBe('depart');
		expect(deriveTrackEvent(prev, sample('2026-07-03T09:15:00Z', { shiftState: 'R' }))).toBe('depart');
	});

	it('gir charge_start/charge_stop ved ladeovergang', () => {
		expect(
			deriveTrackEvent(
				sample('2026-07-03T09:00:00Z', { charging: false }),
				sample('2026-07-03T09:15:00Z', { charging: true })
			)
		).toBe('charge_start');
		expect(
			deriveTrackEvent(
				sample('2026-07-03T09:00:00Z', { charging: true }),
				sample('2026-07-03T09:15:00Z', { charging: false })
			)
		).toBe('charge_stop');
	});

	it('prioriterer ladeovergang over gir-overgang når begge skjer samtidig', () => {
		// Ankomst lader: kjørte (D, ikke lading) → parkert (null) og lader.
		expect(
			deriveTrackEvent(
				sample('2026-07-03T09:00:00Z', { shiftState: 'D', charging: false }),
				sample('2026-07-03T09:15:00Z', { shiftState: null, charging: true })
			)
		).toBe('charge_start');
	});

	it('gir wake for første sample etter et tidsgap', () => {
		expect(
			deriveTrackEvent(
				sample('2026-07-03T09:00:00Z'),
				sample(new Date(Date.parse('2026-07-03T09:00:00Z') + WAKE_GAP_MS).toISOString())
			)
		).toBe('wake');
	});

	it('gir ingen markør uten forrige sample eller uten overgang', () => {
		expect(deriveTrackEvent(undefined, sample('2026-07-03T09:00:00Z'))).toBeUndefined();
		expect(
			deriveTrackEvent(
				sample('2026-07-03T09:00:00Z', { shiftState: 'D', charging: false }),
				sample('2026-07-03T09:15:00Z', { shiftState: 'D', charging: false })
			)
		).toBeUndefined();
	});

	it('markerer ikke park/depart når giret er ukjent (manglende drive_state)', () => {
		expect(
			deriveTrackEvent(
				sample('2026-07-03T09:00:00Z'),
				sample('2026-07-03T09:15:00Z', { shiftState: 'D' })
			)
		).toBeUndefined();
	});
});

describe('buildTrackPoints', () => {
	it('bygger punkter med lokal-offset-ts og feltene fra samplet', () => {
		const points = buildTrackPoints(
			[sample('2026-07-03T07:15:00Z', { lat: 60.79, lon: 11.07, speedKmh: 52, shiftState: 'D', charging: false, batteryPercent: 48, odometerKm: 40123.4 })],
			'Europe/Oslo'
		);
		expect(points).toEqual([
			{
				ts: '2026-07-03T09:15:00+02:00',
				lat: 60.79,
				lon: 11.07,
				speedKmh: 52,
				shiftState: 'D',
				charging: false,
				batteryPercent: 48,
				odometerKm: 40123.4
			}
		]);
	});

	it('arver forrige kjente posisjon når drive_state mangler (bilen står stille)', () => {
		const points = buildTrackPoints(
			[
				sample('2026-07-03T09:00:00Z', { lat: 60.79, lon: 11.07, shiftState: null }),
				sample('2026-07-03T09:05:00Z', { charging: true, batteryPercent: 50 })
			],
			'UTC'
		);
		expect(points).toHaveLength(2);
		expect(points[1].lat).toBe(60.79);
		expect(points[1].lon).toBe(11.07);
		expect(points[1].charging).toBe(true);
	});

	it('dropper samples før første kjente posisjon', () => {
		const points = buildTrackPoints(
			[
				sample('2026-07-03T08:00:00Z', { charging: false }),
				sample('2026-07-03T09:00:00Z', { lat: 60, lon: 11 })
			],
			'UTC'
		);
		expect(points).toHaveLength(1);
		expect(points[0].lat).toBe(60);
	});

	it('avleder hendelser over hele sekvensen — en dags kjøretur med ladestopp', () => {
		const points = buildTrackPoints(
			[
				sample('2026-07-03T06:00:00Z', { lat: 60.0, lon: 10.0, shiftState: null, charging: false }),
				sample('2026-07-03T06:15:00Z', { lat: 60.0, lon: 10.0, shiftState: 'D', charging: false }),
				sample('2026-07-03T06:30:00Z', { lat: 60.2, lon: 10.3, shiftState: 'D', charging: false }),
				sample('2026-07-03T06:45:00Z', { lat: 60.4, lon: 10.6, shiftState: null, charging: true }),
				sample('2026-07-03T07:15:00Z', { lat: 60.4, lon: 10.6, shiftState: null, charging: false }),
				// Bilen sovnet etter ladingen — neste sample 2 timer senere.
				sample('2026-07-03T09:15:00Z', { lat: 60.4, lon: 10.6, shiftState: 'D', charging: false })
			],
			'UTC'
		);
		expect(points.map((p) => p.event)).toEqual([
			undefined,
			'depart',
			undefined,
			'charge_start',
			'charge_stop',
			'depart' // gir-overgang prioriteres over wake (samme punkt)
		]);
	});

	it('returnerer tom liste for tomme samples', () => {
		expect(buildTrackPoints([], 'UTC')).toEqual([]);
	});
});
