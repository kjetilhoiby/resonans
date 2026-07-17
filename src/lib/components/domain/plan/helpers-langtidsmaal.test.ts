import { describe, it, expect } from 'vitest';
import { formatSecondsAsTime, formatLongTermValue } from './helpers.js';

describe('formatSecondsAsTime', () => {
	it('formatterer under en time som mm:ss', () => {
		expect(formatSecondsAsTime(2999)).toBe('49:59');
		expect(formatSecondsAsTime(3000)).toBe('50:00');
		expect(formatSecondsAsTime(65)).toBe('1:05');
	});

	it('formatterer over en time som t:mm:ss', () => {
		expect(formatSecondsAsTime(3661)).toBe('1:01:01');
	});

	it('runder og klemmer negative til null', () => {
		expect(formatSecondsAsTime(59.6)).toBe('1:00');
		expect(formatSecondsAsTime(-5)).toBe('0:00');
	});
});

describe('formatLongTermValue', () => {
	it('viser 10 km-tid som mm:ss', () => {
		expect(formatLongTermValue('running_10k_time', 3000)).toBe('50:00');
	});

	it('viser sparing som kroner', () => {
		expect(formatLongTermValue('monthly_savings', 8000)).toBe('8 000 kr');
	});

	it('viser vekt i kg', () => {
		expect(formatLongTermValue('weight_change', 80.25)).toBe('80.3 kg');
	});

	it('faller tilbake til tall + enhet', () => {
		expect(formatLongTermValue(null, 42, 'stk')).toBe('42 stk');
	});
});
