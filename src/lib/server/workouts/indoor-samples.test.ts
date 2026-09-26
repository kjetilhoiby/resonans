import { describe, it, expect } from 'vitest';
import { profileSeries, readWorkoutSamples, type WorkoutSample } from '$lib/domain/health/workout-samples';
import {
	cumulativeDistanceMeters,
	computeHrDistribution,
	computeKmSplits,
	computeSpeedSeries
} from '$lib/utils/track-stats';
import { analyzeWorkout } from '$lib/server/workouts/workout-analytics';
import { buildIndoorTcx } from '$lib/server/workouts/samples-tcx';
import { parseWorkoutFile } from '$lib/server/integrations/dropbox-sync';

/**
 * 30 minutter på mølla, 10 km/t, et sample hvert 5. sekund. Pulsen stiger rolig fra
 * 120 mot 150 – nok til å gå gjennom artefaktvakta som en ekte kurve.
 */
function treadmillSamples(): WorkoutSample[] {
	const start = Date.parse('2026-09-26T16:00:00Z');
	return Array.from({ length: 361 }, (_, i) => ({
		time: new Date(start + i * 5000).toISOString(),
		dist: (10_000 / 3600) * i * 5,
		ele: 100 + (10_000 / 3600) * i * 5 * 0.01,
		hr: Math.round(120 + (30 * i) / 360)
	}));
}

describe('readWorkoutSamples', () => {
	it('beholder gyldige samples og forkaster resten', () => {
		const out = readWorkoutSamples([
			{ time: '2026-09-26T16:00:00Z', dist: 0, hr: 120 },
			{ time: '2026-09-26T16:00:05Z' },
			'søppel',
			{ time: '2026-09-26T16:00:10Z', dist: 27.8, ele: 'høy' }
		]);
		expect(out).toEqual([
			{ time: '2026-09-26T16:00:00Z', dist: 0, hr: 120 },
			{ time: '2026-09-26T16:00:10Z', dist: 27.8 }
		]);
		expect(readWorkoutSamples(null)).toEqual([]);
	});
});

describe('profileSeries', () => {
	it('sporet vinner, samplene er reserven', () => {
		const track = [{ lat: 1, lon: 1 }, { lat: 1.001, lon: 1 }];
		const samples = treadmillSamples();
		expect(profileSeries(track, samples)).toBe(track);
		expect(profileSeries([], samples)).toBe(samples);
		expect(profileSeries([], [])).toEqual([]);
	});
});

describe('grafene på øktsiden leser samples', () => {
	const samples = treadmillSamples();

	it('distansen er enhetens, ikke haversine (det finnes ingen posisjon)', () => {
		const cum = cumulativeDistanceMeters(samples);
		expect(cum[cum.length - 1]).toBeCloseTo(5000, 0);
	});

	it('fart, kilometersplitter og pulsfordeling', () => {
		const speed = computeSpeedSeries(samples);
		expect(speed.at(-1)?.value).toBeCloseTo(10, 1);
		const splits = computeKmSplits(samples);
		expect(splits.length).toBe(5);
		const bands = computeHrDistribution(samples, [
			{ label: 'lav', minBpm: 0, maxBpm: 135, color: '#000' },
			{ label: 'høy', minBpm: 135, maxBpm: 999, color: '#fff' }
		] as never);
		const total = bands.reduce((s, b) => s + b.seconds, 0);
		expect(total).toBeCloseTo(1800, 0);
	});
});

describe('øktanalysen leser samples', () => {
	it('gir sonefordeling og tidsdeling for en mølleøkt', () => {
		const a = analyzeWorkout(treadmillSamples(), { restHr: 50, maxHr: 185 });
		expect(a.hrZoneDistribution).toBeDefined();
		expect(a.intensitySplit?.measuredSeconds).toBeCloseTo(1800, -1);
		expect(a.bestEfforts?.['5k']).toBeCloseTo(1800, -1);
	});
});

describe('buildIndoorTcx (etterpåsynken til Strava)', () => {
	it('rundturen gjennom parseren gir samme økt tilbake', () => {
		const samples = treadmillSamples();
		const tcx = buildIndoorTcx(samples, { startTime: new Date('2026-09-26T16:00:00Z'), durationSeconds: 1800, name: 'Løpetur' });
		expect(tcx.startsWith('<?xml')).toBe(true);
		expect(tcx).not.toContain('<Position>');
		const parsed = parseWorkoutFile('x.tcx', tcx)!;
		expect(parsed.duration).toBe(1800);
		expect(parsed.distance).toBeCloseTo(5000, 0);
		expect(parsed.maxHeartRate).toBe(150);
		expect(parsed.samples).toHaveLength(361);
	});
});
