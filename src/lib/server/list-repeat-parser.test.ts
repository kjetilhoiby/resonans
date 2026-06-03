import { describe, it, expect } from 'vitest';
import { parseListRepeatCount } from './list-repeat-parser';

describe('parseListRepeatCount', () => {
	it('«fire ganger» (tallord, uten periode) → 4 slots', () => {
		expect(parseListRepeatCount('jogge fire ganger').repeatCount).toBe(4);
	});

	it('«4 ganger i uken» → 4', () => {
		expect(parseListRepeatCount('yoga 4 ganger i uken').repeatCount).toBe(4);
	});

	it('prefiks-tall «4 yoga» → 4', () => {
		const r = parseListRepeatCount('4 yoga');
		expect(r.repeatCount).toBe(4);
		expect(r.label.toLowerCase()).toContain('yoga');
	});

	it('uten antall → 1', () => {
		expect(parseListRepeatCount('yoga').repeatCount).toBe(1);
	});
});
