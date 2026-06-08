import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reconstructBalanceSeries } from './balance-reconstructor';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-10T12:00:00Z')); });
afterEach(() => { vi.useRealTimers(); });

function maps(data: Record<string, number>) {
	return new Map(Object.entries(data));
}

const empty = new Map<string, number>();

describe('reconstructBalanceSeries', () => {
	it('bygger serie for enkle dager uten transaksjoner', () => {
		const snapshots = maps({ '2026-01-01': 10000 });
		const result = reconstructBalanceSeries(snapshots, empty, empty, empty, '2026-01-01', '2026-01-03', 10000);
		expect(result).toHaveLength(3);
		expect(result[0]).toEqual({ date: '2026-01-01', balance: 10000, innskudd: 0, uttak: 0 });
		expect(result[1].balance).toBe(10000);
		expect(result[2].balance).toBe(10000);
	});

	it('anvender transaksjoner kumulativt', () => {
		const tx = maps({ '2026-01-02': -500, '2026-01-03': -300 });
		const uttak = maps({ '2026-01-02': -500, '2026-01-03': -300 });
		const result = reconstructBalanceSeries(empty, tx, empty, uttak, '2026-01-01', '2026-01-03', 10000);
		expect(result[0].balance).toBe(10000);
		expect(result[1].balance).toBe(9500);
		expect(result[2].balance).toBe(9200);
		expect(result[1].uttak).toBe(-500);
	});

	it('snapper til snapshot-anker og korrigerer drift', () => {
		const snapshots = maps({ '2026-01-01': 10000, '2026-01-03': 9000 });
		const tx = maps({ '2026-01-02': -1500 });
		const result = reconstructBalanceSeries(snapshots, tx, empty, empty, '2026-01-01', '2026-01-03', 10000);
		expect(result[0].balance).toBe(10000);
		expect(result[1].balance).toBe(8500);
		expect(result[2].balance).toBe(9000);
	});

	it('håndterer innskudd og uttak separat', () => {
		const tx = maps({ '2026-01-02': 2000 });
		const innskudd = maps({ '2026-01-02': 2000 });
		const result = reconstructBalanceSeries(empty, tx, innskudd, empty, '2026-01-01', '2026-01-02', 5000);
		expect(result[1].balance).toBe(7000);
		expect(result[1].innskudd).toBe(2000);
		expect(result[1].uttak).toBe(0);
	});

	it('runder til 2 desimaler', () => {
		const tx = maps({ '2026-01-02': -33.333 });
		const result = reconstructBalanceSeries(empty, tx, empty, empty, '2026-01-01', '2026-01-02', 100);
		expect(result[1].balance).toBe(66.67);
	});

	it('returnerer tom liste for ugyldig datorange', () => {
		const result = reconstructBalanceSeries(empty, empty, empty, empty, '2026-01-05', '2026-01-01', 0);
		expect(result).toHaveLength(0);
	});

	it('håndterer negativ openingBalance', () => {
		const result = reconstructBalanceSeries(empty, empty, empty, empty, '2026-01-01', '2026-01-01', -500);
		expect(result[0].balance).toBe(-500);
	});

	it('flere snapshots korrigerer drift gjennom hele perioden', () => {
		const snapshots = maps({ '2026-01-01': 10000, '2026-01-03': 9500, '2026-01-05': 9000 });
		const tx = maps({ '2026-01-02': -600, '2026-01-04': -600 });
		const result = reconstructBalanceSeries(snapshots, tx, empty, empty, '2026-01-01', '2026-01-05', 10000);
		expect(result[0].balance).toBe(10000);
		expect(result[1].balance).toBe(9400);
		expect(result[2].balance).toBe(9500);
		expect(result[3].balance).toBe(8900);
		expect(result[4].balance).toBe(9000);
	});
});
