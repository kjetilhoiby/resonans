import { describe, it, expect } from 'vitest';
import { pickFrameOffsets, formatTimestamp } from './video-frame-timing';

describe('pickFrameOffsets', () => {
	it('returnerer tomt for ugyldig varighet', () => {
		expect(pickFrameOffsets(0)).toEqual([]);
		expect(pickFrameOffsets(-5)).toEqual([]);
		expect(pickFrameOffsets(Number.NaN)).toEqual([]);
	});

	it('sampler inntil maks-antall for lang video', () => {
		expect(pickFrameOffsets(60)).toHaveLength(6);
	});

	it('sampler færre for kort video', () => {
		expect(pickFrameOffsets(16)).toHaveLength(2);
	});

	it('holder seg strengt innenfor (0, varighet) og er stigende', () => {
		const offsets = pickFrameOffsets(60);
		for (const t of offsets) {
			expect(t).toBeGreaterThan(0);
			expect(t).toBeLessThan(60);
		}
		expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
	});

	it('respekterer et lavere maks-tak', () => {
		expect(pickFrameOffsets(120, 3)).toHaveLength(3);
	});
});

describe('formatTimestamp', () => {
	it('formaterer sekunder som m:ss', () => {
		expect(formatTimestamp(5)).toBe('0:05');
		expect(formatTimestamp(65)).toBe('1:05');
		expect(formatTimestamp(0)).toBe('0:00');
		expect(formatTimestamp(9.6)).toBe('0:10');
	});
});
