import { describe, it, expect } from 'vitest';
import { fmtMinutter } from './duration';

describe('fmtMinutter', () => {
	it('under en time: bare minutter', () => {
		expect(fmtMinutter(43)).toBe('43 min');
		expect(fmtMinutter(59.4)).toBe('59 min');
	});

	it('over en time: timer og minutter', () => {
		expect(fmtMinutter(103)).toBe('1 t 43 min');
		expect(fmtMinutter(125)).toBe('2 t 5 min');
	});

	it('hele timer uten rest-minutter', () => {
		expect(fmtMinutter(60)).toBe('1 t');
		expect(fmtMinutter(120)).toBe('2 t');
	});

	it('runder til nærmeste minutt', () => {
		expect(fmtMinutter(59.6)).toBe('1 t');
		expect(fmtMinutter(102.7)).toBe('1 t 43 min');
	});
});
