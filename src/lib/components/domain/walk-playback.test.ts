import { describe, it, expect } from 'vitest';
import {
	trackToCoords,
	haversineMeters,
	walkStatsFromTrack,
	placeImagesOnTrack,
	coordsBounds,
	buildWalkPlayback,
	buildElevationProfile,
	type WalkTrackPoint,
	type WalkImage
} from './walk-playback';

// Et lite, rett spor østover langs ekvator-nær breddegrad (Oslo-ish) med tider
// på hele minutter, så bilde-matching mot tid blir forutsigbar.
const track: WalkTrackPoint[] = [
	{ lat: 59.9, lon: 10.7, ele: 10, time: '2026-07-20T08:00:00.000Z' },
	{ lat: 59.9, lon: 10.71, ele: 20, time: '2026-07-20T08:10:00.000Z' },
	{ lat: 59.9, lon: 10.72, ele: 15, time: '2026-07-20T08:20:00.000Z' },
	{ lat: 59.9, lon: 10.73, ele: 40, time: '2026-07-20T08:30:00.000Z' }
];

describe('trackToCoords', () => {
	it('gjør om til [lon, lat] og filtrerer ugyldige punkter', () => {
		const coords = trackToCoords([
			{ lat: 59.9, lon: 10.7 },
			{ lat: NaN, lon: 10.71 },
			{ lat: 60, lon: 11 }
		] as WalkTrackPoint[]);
		expect(coords).toEqual([
			[10.7, 59.9],
			[11, 60]
		]);
	});
});

describe('haversineMeters', () => {
	it('er 0 for samme punkt', () => {
		expect(haversineMeters([10.7, 59.9], [10.7, 59.9])).toBe(0);
	});

	it('er positiv og symmetrisk', () => {
		const ab = haversineMeters([10.7, 59.9], [10.73, 59.9]);
		const ba = haversineMeters([10.73, 59.9], [10.7, 59.9]);
		expect(ab).toBeGreaterThan(0);
		expect(ab).toBeCloseTo(ba, 6);
	});
});

describe('walkStatsFromTrack', () => {
	it('summerer distanse, kun positiv stigning og varighet fra tider', () => {
		const stats = walkStatsFromTrack(track);
		expect(stats.pointCount).toBe(4);
		expect(stats.distanceMeters).toBeGreaterThan(0);
		// Stigning: 10→20 (+10), 20→15 (nedover, ignoreres), 15→40 (+25) = 35
		expect(stats.ascentMeters).toBe(35);
		// 08:00 → 08:30 = 1800 s
		expect(stats.durationSeconds).toBe(1800);
	});

	it('gir null varighet uten tider', () => {
		const stats = walkStatsFromTrack([
			{ lat: 59.9, lon: 10.7 },
			{ lat: 59.9, lon: 10.72 }
		]);
		expect(stats.durationSeconds).toBeNull();
	});
});

describe('placeImagesOnTrack', () => {
	it('fester bilde til nærmeste spor-punkt i tid', () => {
		const images: WalkImage[] = [{ url: 'a.jpg', capturedAt: '2026-07-20T08:19:00.000Z' }];
		const pins = placeImagesOnTrack(track, images);
		expect(pins).toHaveLength(1);
		// 08:19 er nærmest 08:20 → punkt 2 ([10.72, 59.9])
		expect(pins[0].lon).toBe(10.72);
		expect(pins[0].lat).toBe(59.9);
		expect(pins[0].fraction).toBeGreaterThan(0.5);
	});

	it('faller tilbake til geo når tid mangler', () => {
		const images: WalkImage[] = [{ url: 'b.jpg', lat: 59.9, lon: 10.705 }];
		const pins = placeImagesOnTrack(track, images);
		// 10.705 er nærmest 10.7 → punkt 0
		expect(pins[0].lon).toBe(10.7);
		expect(pins[0].fraction).toBe(0);
	});

	it('fordeler jevnt uten tid eller geo, sortert etter andel', () => {
		const images: WalkImage[] = [{ url: '1.jpg' }, { url: '2.jpg' }];
		const pins = placeImagesOnTrack(track, images);
		expect(pins.map((p) => p.url)).toEqual(['1.jpg', '2.jpg']);
		expect(pins[0].fraction).toBeLessThan(pins[1].fraction);
	});

	it('gir tom liste for tomt spor', () => {
		expect(placeImagesOnTrack([], [{ url: 'x.jpg' }])).toEqual([]);
	});

	it('hopper over bilder uten url', () => {
		const pins = placeImagesOnTrack(track, [{ url: '' } as WalkImage, { url: 'ok.jpg' }]);
		expect(pins).toHaveLength(1);
		expect(pins[0].url).toBe('ok.jpg');
	});
});

describe('coordsBounds', () => {
	it('finner utstrekning og midtpunkt', () => {
		const { bounds, center } = coordsBounds([
			[10.7, 59.9],
			[10.73, 59.92]
		]);
		expect(bounds).toEqual([
			[10.7, 59.9],
			[10.73, 59.92]
		]);
		expect(center[0]).toBeCloseTo(10.715, 5);
		expect(center[1]).toBeCloseTo(59.91, 5);
	});

	it('degraderer trygt for tomt spor', () => {
		expect(coordsBounds([])).toEqual({ bounds: [[0, 0], [0, 0]], center: [0, 0] });
	});
});

describe('buildElevationProfile', () => {
	it('bygger profil med andel (0–1) og min/max høyde', () => {
		const prof = buildElevationProfile(track);
		expect(prof.hasData).toBe(true);
		expect(prof.samples).toHaveLength(4);
		expect(prof.minEle).toBe(10);
		expect(prof.maxEle).toBe(40);
		// Første punkt på 0, siste på 1 (jevnt fordelte punkter langs en rett linje).
		expect(prof.samples[0].x).toBe(0);
		expect(prof.samples[prof.samples.length - 1].x).toBeCloseTo(1, 6);
		// x er monotont stigende.
		for (let i = 1; i < prof.samples.length; i++) {
			expect(prof.samples[i].x).toBeGreaterThanOrEqual(prof.samples[i - 1].x);
		}
	});

	it('hopper over punkter uten høyde', () => {
		const prof = buildElevationProfile([
			{ lat: 59.9, lon: 10.7, ele: 10 },
			{ lat: 59.9, lon: 10.71 },
			{ lat: 59.9, lon: 10.72, ele: 30 }
		] as WalkTrackPoint[]);
		expect(prof.samples).toHaveLength(2);
		expect(prof.minEle).toBe(10);
		expect(prof.maxEle).toBe(30);
	});

	it('gir hasData=false med færre enn to høyder', () => {
		const prof = buildElevationProfile([
			{ lat: 59.9, lon: 10.7, ele: 10 },
			{ lat: 59.9, lon: 10.71 }
		] as WalkTrackPoint[]);
		expect(prof.hasData).toBe(false);
		expect(prof.samples).toEqual([]);
	});
});

describe('buildWalkPlayback', () => {
	it('setter sammen rute, bilder og nøkkeltall', () => {
		const playback = buildWalkPlayback(track, [{ url: 'a.jpg', capturedAt: '2026-07-20T08:20:00.000Z' }]);
		expect(playback.coords).toHaveLength(4);
		expect(playback.imagePins).toHaveLength(1);
		expect(playback.stats.ascentMeters).toBe(35);
		expect(playback.center[1]).toBeCloseTo(59.9, 5);
		expect(playback.elevation.hasData).toBe(true);
	});

	it('lar lagrede nøkkeltall vinne over avledede', () => {
		const playback = buildWalkPlayback(track, [], { distanceMeters: 5000, durationSeconds: 3600 });
		expect(playback.stats.distanceMeters).toBe(5000);
		expect(playback.stats.durationSeconds).toBe(3600);
		// pointCount er alltid avledet
		expect(playback.stats.pointCount).toBe(4);
	});
});
