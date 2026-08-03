import { describe, it, expect } from 'vitest';
import {
	vdotFromTime,
	paceZonesForVdot,
	estimateVdotFromBestEfforts,
	vdotFromCooper,
	averagePaceSecPerKm
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

describe('stigningsjustering', () => {
	it('gir høyere VDOT for en motbakketur', () => {
		// Beste 3k på 16:20. Flatt gir ett tall; stiger økta, tilsvarer samme
		// innsats en raskere flat tid, og dermed en høyere VDOT.
		const flat = estimateVdotFromBestEfforts({ '3k': 980 });
		const uphill = estimateVdotFromBestEfforts(
			{ '3k': 980 },
			{ gapSecPerKm: 310, rawPaceSecPerKm: 340 }
		);
		expect(uphill!.vdot).toBeGreaterThan(flat!.vdot);
		expect(uphill!.gradeAdjusted).toBe(true);
		expect(flat!.gradeAdjusted).toBe(false);
	});

	it('gir lavere VDOT for en utforbakke', () => {
		const flat = estimateVdotFromBestEfforts({ '5k': 1500 });
		const downhill = estimateVdotFromBestEfforts(
			{ '5k': 1500 },
			{ gapSecPerKm: 320, rawPaceSecPerKm: 300 }
		);
		expect(downhill!.vdot).toBeLessThan(flat!.vdot);
	});

	it('avviser justeringer utenfor ±20 %', () => {
		// Feil høydedata skal ikke kunne gange et dårlig tall opp.
		const flat = estimateVdotFromBestEfforts({ '3k': 980 });
		const absurd = estimateVdotFromBestEfforts(
			{ '3k': 980 },
			{ gapSecPerKm: 150, rawPaceSecPerKm: 340 }
		);
		expect(absurd!.vdot).toBe(flat!.vdot);
		expect(absurd!.gradeAdjusted).toBe(false);
	});

	it('treffer grensene', () => {
		const flat = estimateVdotFromBestEfforts({ '3k': 980 })!.vdot;
		const atLimit = estimateVdotFromBestEfforts(
			{ '3k': 980 },
			{ gapSecPerKm: 80, rawPaceSecPerKm: 100 }
		);
		expect(atLimit!.gradeAdjusted).toBe(true);
		const justOutside = estimateVdotFromBestEfforts(
			{ '3k': 980 },
			{ gapSecPerKm: 79, rawPaceSecPerKm: 100 }
		);
		expect(justOutside!.vdot).toBe(flat);
	});

	it('ignorerer tull uten å kaste', () => {
		const flat = estimateVdotFromBestEfforts({ '3k': 980 })!.vdot;
		for (const grade of [
			null,
			undefined,
			{ gapSecPerKm: 0, rawPaceSecPerKm: 340 },
			{ gapSecPerKm: 310, rawPaceSecPerKm: 0 },
			{ gapSecPerKm: Number.NaN, rawPaceSecPerKm: 340 }
		]) {
			expect(estimateVdotFromBestEfforts({ '3k': 980 }, grade as never)!.vdot).toBe(flat);
		}
	});

	it('beholder prioriteringen 10k > 5k > 3k', () => {
		const result = estimateVdotFromBestEfforts({ '3k': 900, '5k': 1600, '10k': 3400 });
		expect(result!.sourceDistance).toBe('10k');
	});
});

describe('averagePaceSecPerKm', () => {
	it('regner sek/km', () => {
		expect(averagePaceSecPerKm(5000, 1550)).toBe(310);
	});

	it('gir null for manglende eller urimelige tall', () => {
		expect(averagePaceSecPerKm(null, 1550)).toBeNull();
		expect(averagePaceSecPerKm(5000, null)).toBeNull();
		expect(averagePaceSecPerKm(0, 1550)).toBeNull();
		expect(averagePaceSecPerKm(300, 100)).toBeNull();
		expect(averagePaceSecPerKm(5000, 0)).toBeNull();
	});
});
