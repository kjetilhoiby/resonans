import { describe, it, expect } from 'vitest';
import { angleDeg, averageAngle, distance, midpoint, isVisible } from './geometry';

describe('geometry', () => {
	describe('angleDeg', () => {
		it('gir 180° for en strak linje (toppunkt i midten)', () => {
			expect(angleDeg({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 })).toBeCloseTo(180);
		});

		it('gir 90° for en rett vinkel', () => {
			expect(angleDeg({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(90);
		});

		it('gir 0° når begge ben peker samme vei', () => {
			expect(angleDeg({ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 0, y: 2 })).toBeCloseTo(0);
		});

		it('returnerer null når et ben har lengde 0', () => {
			expect(angleDeg({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeNull();
		});
	});

	describe('averageAngle', () => {
		it('snitter to vinkler', () => {
			expect(averageAngle(100, 140)).toBe(120);
		});
		it('faller tilbake til den ene når den andre mangler', () => {
			expect(averageAngle(100, null)).toBe(100);
			expect(averageAngle(null, 140)).toBe(140);
		});
		it('gir null når begge mangler', () => {
			expect(averageAngle(null, null)).toBeNull();
		});
	});

	it('distance og midpoint', () => {
		expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
		expect(midpoint({ x: 0, y: 0 }, { x: 2, y: 4 })).toEqual({ x: 1, y: 2 });
	});

	it('isVisible respekterer konfidensgrensen', () => {
		expect(isVisible({ x: 0, y: 0, score: 0.5 }, 0.4)).toBe(true);
		expect(isVisible({ x: 0, y: 0, score: 0.3 }, 0.4)).toBe(false);
		expect(isVisible(undefined, 0.4)).toBe(false);
	});
});
