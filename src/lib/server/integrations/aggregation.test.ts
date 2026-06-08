import { describe, it, expect } from 'vitest';
import { avg, sum, min, max, latest } from './aggregation';

describe('avg', () => {
	it('beregner gjennomsnitt', () => {
		expect(avg([10, 20, 30])).toBe(20);
	});

	it('ignorerer undefined og null', () => {
		expect(avg([10, undefined, 30, null as unknown as undefined])).toBe(20);
	});

	it('returnerer undefined for tom liste', () => {
		expect(avg([])).toBeUndefined();
	});

	it('returnerer undefined for kun undefined-verdier', () => {
		expect(avg([undefined, undefined])).toBeUndefined();
	});

	it('håndterer én verdi', () => {
		expect(avg([42])).toBe(42);
	});

	it('håndterer desimaltall', () => {
		expect(avg([1.5, 2.5])).toBe(2);
	});
});

describe('sum', () => {
	it('summerer verdier', () => {
		expect(sum([10, 20, 30])).toBe(60);
	});

	it('ignorerer undefined', () => {
		expect(sum([10, undefined, 30])).toBe(40);
	});

	it('returnerer undefined for tom liste', () => {
		expect(sum([])).toBeUndefined();
	});

	it('håndterer én verdi', () => {
		expect(sum([42])).toBe(42);
	});

	it('håndterer negative tall', () => {
		expect(sum([-10, 30])).toBe(20);
	});
});

describe('min', () => {
	it('finner minimum', () => {
		expect(min([30, 10, 20])).toBe(10);
	});

	it('ignorerer undefined', () => {
		expect(min([undefined, 30, 10])).toBe(10);
	});

	it('returnerer undefined for tom liste', () => {
		expect(min([])).toBeUndefined();
	});

	it('håndterer negative tall', () => {
		expect(min([-5, 0, 5])).toBe(-5);
	});
});

describe('max', () => {
	it('finner maksimum', () => {
		expect(max([10, 30, 20])).toBe(30);
	});

	it('ignorerer undefined', () => {
		expect(max([undefined, 10, 30])).toBe(30);
	});

	it('returnerer undefined for tom liste', () => {
		expect(max([])).toBeUndefined();
	});
});

describe('latest', () => {
	it('returnerer siste ikke-undefined verdi', () => {
		expect(latest([10, 20, 30])).toBe(30);
	});

	it('hopper over trailing undefined', () => {
		expect(latest([10, 20, undefined])).toBe(20);
	});

	it('hopper over trailing null', () => {
		expect(latest([10, 20, null as unknown as undefined])).toBe(20);
	});

	it('returnerer undefined for tom liste', () => {
		expect(latest([])).toBeUndefined();
	});

	it('returnerer undefined for kun undefined-verdier', () => {
		expect(latest([undefined, undefined])).toBeUndefined();
	});

	it('finner verdien selv om bare én finnes', () => {
		expect(latest([undefined, 42, undefined])).toBe(42);
	});
});
