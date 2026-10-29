import { describe, it, expect } from 'vitest';
import {
	quarterPeriodKey,
	daysIntoQuarter,
	isInQuarterWindow,
	parseVisionBlock,
	isValidQuarterKey,
	quarterKeyFromIsoDate,
	compareQuarterKeys,
	sameTranscript,
	DIRECTION_CONVERSATION_METHOD
} from './retning-kvartal';
import { FLOWS } from './registry';

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

describe('kvartalsnøkler for MCP', () => {
	it('godtar bare formen 2026-Q4', () => {
		expect(isValidQuarterKey('2026-Q4')).toBe(true);
		expect(isValidQuarterKey('2026-Q5')).toBe(false);
		expect(isValidQuarterKey('2026-q4')).toBe(false);
		expect(isValidQuarterKey('Q4')).toBe(false);
		expect(isValidQuarterKey(undefined)).toBe(false);
	});

	it('tar kvartalet av datoen, også på grensene', () => {
		expect(quarterKeyFromIsoDate('2026-01-01')).toBe('2026-Q1');
		expect(quarterKeyFromIsoDate('2026-03-31')).toBe('2026-Q1');
		expect(quarterKeyFromIsoDate('2026-10-01')).toBe('2026-Q4');
		expect(quarterKeyFromIsoDate('2026-12-31')).toBe('2026-Q4');
	});

	it('sammenligner over årsskiftet', () => {
		expect(compareQuarterKeys('2026-Q4', '2027-Q1')).toBeLessThan(0);
		expect(compareQuarterKeys('2027-Q1', '2026-Q4')).toBeGreaterThan(0);
		expect(compareQuarterKeys('2026-Q3', '2026-Q3')).toBe(0);
	});
});

describe('sameTranscript', () => {
	it('ser bort fra mellomrom og linjeskift i kantene og inni', () => {
		expect(sameTranscript('Du: hei\n\nResonans: hallo ', ' Du: hei Resonans:  hallo')).toBe(true);
		expect(sameTranscript('Du: hei', 'Du: Hei')).toBe(false);
	});
});

describe('retningssamtalen i appen', () => {
	it('bruker den delte arbeidsmåten, som MCP-verktøyet også sender', () => {
		const step = FLOWS.retning_kvartal.steps![0] as unknown as { buildPrompts: (d: Record<string, unknown>) => { systemPrompt: string } };
		expect(step.buildPrompts({}).systemPrompt).toContain(DIRECTION_CONVERSATION_METHOD);
	});
});
