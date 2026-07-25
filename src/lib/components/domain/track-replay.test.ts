import { describe, it, expect } from 'vitest';
import { buildReplay, haversineMeters, type ReplayTrackPoint } from './track-replay';

// Enkel rett strekning østover, fire punkter med ett minutt mellom hvert.
const points: ReplayTrackPoint[] = [
	{ lat: 62.16, lon: 6.18, time: '2026-07-20T10:00:00Z' },
	{ lat: 62.16, lon: 6.19, time: '2026-07-20T10:01:00Z' },
	{ lat: 62.16, lon: 6.2, time: '2026-07-20T10:02:00Z' },
	{ lat: 62.16, lon: 6.21, time: '2026-07-20T10:03:00Z' }
];

describe('buildReplay', () => {
	it('bygger [lon,lat]-koordinater og kumulativ distanse', () => {
		const r = buildReplay(points, []);
		expect(r.coords[0]).toEqual([6.18, 62.16]);
		expect(r.coords.length).toBe(4);
		expect(r.totalMeters).toBeGreaterThan(0);
		expect(r.cumulative[0]).toBe(0);
		expect(r.cumulative[3]).toBeCloseTo(r.totalMeters, 5);
	});

	it('plasserer bilder på nærmeste trackpunkt i tid', () => {
		// Bilde tatt 10:02:10 → nærmest punkt 3 (10:02) → fraction ~2/3.
		const r = buildReplay(points, [{ url: 'a.jpg', takenAt: '2026-07-20T10:02:10Z' }]);
		expect(r.photos).toHaveLength(1);
		expect(r.photos[0].lon).toBeCloseTo(6.2, 5);
		expect(r.photos[0].fraction).toBeCloseTo(2 / 3, 2);
	});

	it('sorterer bilder etter posisjon langs ruta', () => {
		const r = buildReplay(points, [
			{ url: 'sen.jpg', takenAt: '2026-07-20T10:03:00Z' },
			{ url: 'tidlig.jpg', takenAt: '2026-07-20T10:00:00Z' }
		]);
		expect(r.photos.map((p) => p.url)).toEqual(['tidlig.jpg', 'sen.jpg']);
	});

	it('fordeler bilder jevnt når trackpunktene mangler tid', () => {
		const noTime = points.map((p) => ({ lat: p.lat, lon: p.lon }));
		const r = buildReplay(noTime, [{ url: 'a.jpg' }, { url: 'b.jpg' }, { url: 'c.jpg' }]);
		expect(r.photos[0].fraction).toBeCloseTo(0, 5);
		expect(r.photos[2].fraction).toBeCloseTo(1, 1);
	});
});

describe('haversineMeters', () => {
	it('måler ca. 1.11 km per 0.01° breddegrad', () => {
		const d = haversineMeters({ lat: 62, lon: 6 }, { lat: 62.01, lon: 6 });
		expect(d).toBeGreaterThan(1100);
		expect(d).toBeLessThan(1120);
	});
});
