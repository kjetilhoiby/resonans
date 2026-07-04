import { describe, it, expect } from 'vitest';
import { buildDriveRoutes, approxDistanceM, decimate, type DrivePoint } from './tesla-routes';

// Oslo sentrum → nordover. ~0.001 breddegrad ≈ 111 m.
function pt(iso: string, lat: number, lon: number): DrivePoint {
	return { lat, lon, timestamp: new Date(iso) };
}

describe('approxDistanceM', () => {
	it('beregner omtrentlig avstand i meter', () => {
		const d = approxDistanceM({ lat: 59.91, lon: 10.75 }, { lat: 59.92, lon: 10.75 });
		expect(d).toBeGreaterThan(1050);
		expect(d).toBeLessThan(1180);
	});

	it('null avstand for samme punkt', () => {
		expect(approxDistanceM({ lat: 59.91, lon: 10.75 }, { lat: 59.91, lon: 10.75 })).toBe(0);
	});
});

describe('decimate', () => {
	it('beholder alt når under taket', () => {
		expect(decimate([1, 2, 3], 5)).toEqual([1, 2, 3]);
	});

	it('tynner uniformt og beholder første og siste', () => {
		const input = Array.from({ length: 100 }, (_, i) => i);
		const out = decimate(input, 10);
		expect(out).toHaveLength(10);
		expect(out[0]).toBe(0);
		expect(out[out.length - 1]).toBe(99);
	});
});

describe('buildDriveRoutes', () => {
	it('grupperer punkter per Oslo-dag', () => {
		const points = [
			// 28. juni: kjøretur på ~5,5 km nordover
			...Array.from({ length: 12 }, (_, i) => pt(`2026-06-28T10:${String(i).padStart(2, '0')}:00Z`, 59.9 + i * 0.005, 10.75)),
			// 29. juni: ny kjøretur
			...Array.from({ length: 12 }, (_, i) => pt(`2026-06-29T10:${String(i).padStart(2, '0')}:00Z`, 60.5 + i * 0.005, 10.5))
		];
		const routes = buildDriveRoutes(points);
		expect(Object.keys(routes).sort()).toEqual(['2026-06-28', '2026-06-29']);
		expect(routes['2026-06-28'].length).toBe(12);
		// [lon, lat]-rekkefølge
		expect(routes['2026-06-28'][0]).toEqual([10.75, 59.9]);
	});

	it('tilskriver punkter rett etter midnatt Oslo-tid til riktig dag', () => {
		// 22:30Z 28. juni = 00:30 29. juni i Oslo (sommertid, UTC+2)
		const points = Array.from({ length: 12 }, (_, i) =>
			pt(`2026-06-28T22:${String(30 + i).padStart(2, '0')}:00Z`, 59.9 + i * 0.005, 10.75)
		);
		const routes = buildDriveRoutes(points);
		expect(Object.keys(routes)).toEqual(['2026-06-29']);
	});

	it('dropper stillstands-jitter (punkter under 50 m fra forrige)', () => {
		const points = [
			pt('2026-06-28T10:00:00Z', 59.9, 10.75),
			pt('2026-06-28T10:01:00Z', 59.90001, 10.75001), // ~1 m — jitter
			pt('2026-06-28T10:02:00Z', 59.90002, 10.75), // fortsatt jitter
			pt('2026-06-28T10:03:00Z', 59.92, 10.75), // ~2,2 km — reell bevegelse
			pt('2026-06-28T10:04:00Z', 59.94, 10.75)
		];
		const routes = buildDriveRoutes(points);
		expect(routes['2026-06-28']).toHaveLength(3);
	});

	it('utelater dager uten reell kjøring (under 1 km total)', () => {
		const points = [
			pt('2026-06-28T10:00:00Z', 59.9, 10.75),
			pt('2026-06-28T12:00:00Z', 59.9005, 10.75), // ~55 m — over jitter, men under kjøredag-terskel
			pt('2026-06-28T14:00:00Z', 59.901, 10.75)
		];
		expect(buildDriveRoutes(points)).toEqual({});
	});

	it('sorterer usorterte punkter kronologisk', () => {
		const points = [
			pt('2026-06-28T10:10:00Z', 59.94, 10.75),
			pt('2026-06-28T10:00:00Z', 59.9, 10.75),
			pt('2026-06-28T10:05:00Z', 59.92, 10.75)
		];
		const routes = buildDriveRoutes(points);
		expect(routes['2026-06-28'].map(([, lat]) => lat)).toEqual([59.9, 59.92, 59.94]);
	});

	it('tynner lange dager til maks 300 punkter', () => {
		const points = Array.from({ length: 1000 }, (_, i) =>
			pt(
				`2026-06-28T${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00Z`,
				59.0 + i * 0.001,
				10.75
			)
		);
		const routes = buildDriveRoutes(points);
		expect(routes['2026-06-28'].length).toBeLessThanOrEqual(300);
		expect(routes['2026-06-28'][0]).toEqual([10.75, 59.0]);
	});

	it('ignorerer punkter uten gyldige koordinater', () => {
		const points = [
			pt('2026-06-28T10:00:00Z', NaN, 10.75),
			pt('2026-06-28T10:01:00Z', 59.9, Infinity)
		];
		expect(buildDriveRoutes(points)).toEqual({});
	});
});
