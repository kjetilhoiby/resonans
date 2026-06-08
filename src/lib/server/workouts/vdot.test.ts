import { describe, it, expect } from 'vitest';
import {
	vdotFromTime,
	paceZonesForVdot,
	estimateVdotFromBestEfforts,
	vdotFromCooper
} from './vdot';

describe('vdotFromTime', () => {
	it('5k in 20:00 → VDOT ~46-49', () => {
		const vdot = vdotFromTime(5000, 20 * 60);
		expect(vdot).not.toBeNull();
		expect(vdot).toBeCloseTo(47.5, -1); // ±2 tolerance
	});

	it('10k in 40:00 → VDOT ~48-50', () => {
		const vdot = vdotFromTime(10000, 40 * 60);
		expect(vdot).not.toBeNull();
		expect(vdot).toBeCloseTo(49, -1);
	});

	it('5k in 25:00 → VDOT ~38-41', () => {
		const vdot = vdotFromTime(5000, 25 * 60);
		expect(vdot).not.toBeNull();
		expect(vdot).toBeCloseTo(39.5, -1);
	});

	it('returns null for 0 distance', () => {
		expect(vdotFromTime(0, 1200)).toBeNull();
	});

	it('returns null for negative time', () => {
		expect(vdotFromTime(5000, -100)).toBeNull();
	});

	it('returns null for distance < 1500m', () => {
		expect(vdotFromTime(1000, 300)).toBeNull();
	});
});

describe('paceZonesForVdot', () => {
	it('VDOT 50: pace ordering easy > marathon > tempo > interval (sec/km)', () => {
		const paces = paceZonesForVdot(50);
		expect(paces.easySecPerKm).toBeGreaterThan(paces.marathonSecPerKm);
		expect(paces.marathonSecPerKm).toBeGreaterThan(paces.tempoSecPerKm);
		expect(paces.tempoSecPerKm).toBeGreaterThan(paces.intervalSecPerKm);
	});

	it('VDOT 50: all paces are positive finite numbers', () => {
		const paces = paceZonesForVdot(50);
		for (const val of Object.values(paces)) {
			expect(val).toBeGreaterThan(0);
			expect(Number.isFinite(val)).toBe(true);
		}
	});

	it('higher VDOT produces faster paces', () => {
		const slow = paceZonesForVdot(40);
		const fast = paceZonesForVdot(60);
		expect(fast.easySecPerKm).toBeLessThan(slow.easySecPerKm);
		expect(fast.intervalSecPerKm).toBeLessThan(slow.intervalSecPerKm);
	});
});

describe('estimateVdotFromBestEfforts', () => {
	it('prefers 10k over 5k', () => {
		const result = estimateVdotFromBestEfforts({
			'5k': 20 * 60,
			'10k': 40 * 60
		});
		expect(result).not.toBeNull();
		expect(result!.sourceDistance).toBe('10k');
	});

	it('falls back to 5k when no 10k', () => {
		const result = estimateVdotFromBestEfforts({ '5k': 20 * 60 });
		expect(result).not.toBeNull();
		expect(result!.sourceDistance).toBe('5k');
	});

	it('falls back to 3k when no 5k or 10k', () => {
		const result = estimateVdotFromBestEfforts({ '3k': 12 * 60 });
		expect(result).not.toBeNull();
		expect(result!.sourceDistance).toBe('3k');
	});

	it('returns null for empty efforts', () => {
		expect(estimateVdotFromBestEfforts({})).toBeNull();
	});

	it('returns null when only 1k is provided', () => {
		expect(estimateVdotFromBestEfforts({ '1k': 210 })).toBeNull();
	});
});

describe('vdotFromCooper', () => {
	it('3000m Cooper → reasonable VDOT', () => {
		const vdot = vdotFromCooper(3000);
		expect(vdot).not.toBeNull();
		expect(vdot!).toBeGreaterThan(40);
		expect(vdot!).toBeLessThan(60);
	});

	it('returns null for 0 meters', () => {
		expect(vdotFromCooper(0)).toBeNull();
	});

	it('returns null for negative meters', () => {
		expect(vdotFromCooper(-100)).toBeNull();
	});

	it('short Cooper distance (<1500m) returns null', () => {
		expect(vdotFromCooper(1000)).toBeNull();
	});
});
