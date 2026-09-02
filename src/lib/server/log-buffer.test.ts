import { describe, it, expect } from 'vitest';
import { createRingBuffer, formatLogArgs } from './log-buffer';

describe('formatLogArgs', () => {
	it('lar strenger stå og JSON-ifiserer objekter', () => {
		expect(formatLogArgs(['[chat-perf]', 'wall=1ms', { a: 1 }])).toBe('[chat-perf] wall=1ms {"a":1}');
	});

	it('tar med stacken fra en Error', () => {
		const err = new Error('boom');
		expect(formatLogArgs(['feil:', err])).toContain('boom');
		expect(formatLogArgs(['feil:', err])).toContain('log-buffer.test');
	});

	it('overlever sirkulære objekter', () => {
		const a: Record<string, unknown> = {};
		a.self = a;
		expect(formatLogArgs([a])).toBe('[object Object]');
	});

	it('kutter svært lange linjer', () => {
		const line = formatLogArgs(['x'.repeat(10_000)]);
		expect(line.length).toBeLessThan(4100);
		expect(line.endsWith('…[kuttet]')).toBe(true);
	});
});

describe('createRingBuffer', () => {
	it('beholder de siste N i riktig rekkefølge når kapasiteten rundes', () => {
		const ring = createRingBuffer<number>(3);
		for (const n of [1, 2, 3, 4, 5]) ring.push(n);
		expect(ring.list()).toEqual([3, 4, 5]);
		expect(ring.totalPushed()).toBe(5);
	});

	it('lister eldst først før kapasiteten er nådd', () => {
		const ring = createRingBuffer<number>(3);
		ring.push(1);
		ring.push(2);
		expect(ring.list()).toEqual([1, 2]);
	});
});
