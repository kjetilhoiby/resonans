import { describe, it, expect } from 'vitest';
import {
	quarterPeriodKey,
	daysIntoQuarter,
	isInQuarterWindow,
	parseVisionBlock
} from './retning-kvartal';

describe('quarterPeriodKey', () => {
	it('gir riktig kvartal for alle årstider', () => {
		expect(quarterPeriodKey(new Date(2026, 0, 15))).toBe('2026-Q1');
		expect(quarterPeriodKey(new Date(2026, 3, 1))).toBe('2026-Q2');
		expect(quarterPeriodKey(new Date(2026, 6, 12))).toBe('2026-Q3');
		expect(quarterPeriodKey(new Date(2026, 11, 31))).toBe('2026-Q4');
	});
});

describe('daysIntoQuarter', () => {
	it('teller fra 1 på kvartalets første dag', () => {
		expect(daysIntoQuarter(new Date(2026, 6, 1))).toBe(1);
		expect(daysIntoQuarter(new Date(2026, 6, 21))).toBe(21);
		expect(daysIntoQuarter(new Date(2026, 7, 1))).toBe(32);
	});
});

describe('isInQuarterWindow', () => {
	it('er åpen de første tre ukene og lukket etterpå', () => {
		expect(isInQuarterWindow(new Date(2026, 6, 1))).toBe(true);
		expect(isInQuarterWindow(new Date(2026, 6, 21))).toBe(true);
		expect(isInQuarterWindow(new Date(2026, 6, 22))).toBe(false);
		expect(isInQuarterWindow(new Date(2026, 8, 30))).toBe(false);
	});
});

describe('parseVisionBlock', () => {
	it('henter innholdet mellom visjon-markørene', () => {
		expect(parseVisionBlock('Bra samtale!\n<visjon>Dette kvartalet prioriterer jeg søvn.</visjon>')).toBe(
			'Dette kvartalet prioriterer jeg søvn.'
		);
	});

	it('gir tom streng uten markører — løs prosa lagres aldri som visjon', () => {
		expect(parseVisionBlock('Kanskje du bør prioritere søvn?')).toBe('');
		expect(parseVisionBlock('')).toBe('');
	});
});
