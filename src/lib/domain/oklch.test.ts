import { describe, it, expect } from 'vitest';
import { inkForLightness, oklchToHex } from './oklch';

describe('oklchToHex', () => {
	it('treffer gråtoner uten kroma', () => {
		expect(oklchToHex(0, 0, 0)).toBe('#000000');
		expect(oklchToHex(1, 0, 0)).toBe('#ffffff');
	});

	it('gir en gjenkjennelig gul og rød', () => {
		// Kulør 95° er gul-grønn, 28° er rød i OKLCH.
		const gul = oklchToHex(0.8, 0.13, 95);
		const rod = oklchToHex(0.55, 0.15, 28);
		// Gul: mye rødt og grønt, lite blått.
		expect(parseInt(gul.slice(1, 3), 16)).toBeGreaterThan(180);
		expect(parseInt(gul.slice(3, 5), 16)).toBeGreaterThan(160);
		expect(parseInt(gul.slice(5, 7), 16)).toBeLessThan(140);
		// Rød: rødt dominerer.
		expect(parseInt(rod.slice(1, 3), 16)).toBeGreaterThan(parseInt(rod.slice(3, 5), 16) + 60);
	});

	it('holder seg innenfor sRGB ved umulig kroma', () => {
		// C 0,4 på en mørk rød finnes ikke i sRGB. Kroma skal gi seg, ikke lysheten.
		const hex = oklchToHex(0.35, 0.4, 28);
		expect(/^#[0-9a-f]{6}$/.test(hex)).toBe(true);
		expect(hex).not.toBe('#000000');
	});

	it('er monoton i lyshet for samme kulør', () => {
		const steps = [0.35, 0.5, 0.65, 0.8].map((L) => oklchToHex(L, 0.12, 60));
		const luminance = steps.map((hex) =>
			[1, 3, 5].reduce((sum, i) => sum + parseInt(hex.slice(i, i + 2), 16), 0)
		);
		for (let i = 1; i < luminance.length; i++) {
			expect(luminance[i]).toBeGreaterThan(luminance[i - 1]);
		}
	});
});

describe('inkForLightness', () => {
	it('velger mørk skrift på lys flate og omvendt', () => {
		expect(inkForLightness(0.8)).toBe('#14130f');
		expect(inkForLightness(0.4)).toBe('#f2eee4');
	});
});
