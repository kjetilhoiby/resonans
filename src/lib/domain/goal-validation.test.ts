import { describe, it, expect } from 'vitest';
import {
	goalHorizon,
	isGoalExpired,
	isMetaGoalTitle,
	isRunningGoalReached,
	isWeightGoalReached
} from './goal-validation';

describe('isMetaGoalTitle', () => {
	it('blokkerer rene meta-titler', () => {
		expect(isMetaGoalTitle('Planlegging')).toBe(true);
		expect(isMetaGoalTitle('Bedre struktur')).toBe(true);
		expect(isMetaGoalTitle('Rutiner i hverdagen')).toBe(true);
		expect(isMetaGoalTitle('Organisering')).toBe(true);
		expect(isMetaGoalTitle('  ')).toBe(true);
	});

	it('slipper gjennom konkrete livsmål', () => {
		expect(isMetaGoalTitle('Planlegge bryllupet')).toBe(false);
		expect(isMetaGoalTitle('Løpe 600 km i år')).toBe(false);
		expect(isMetaGoalTitle('Redusere vekt til 85 kg')).toBe(false);
		expect(isMetaGoalTitle('Lese 20 bøker')).toBe(false);
		expect(isMetaGoalTitle('Styrketrening to ganger i uka')).toBe(false);
	});
});

describe('goalHorizon', () => {
	const naa = new Date('2026-07-17T12:00:00Z');

	it('frist innen ~3 måneder → kort sikt', () => {
		expect(goalHorizon('2026-07-31', naa)).toBe('kort');
		expect(goalHorizon('2026-10-01', naa)).toBe('kort');
	});

	it('frist lenger unna → lang sikt', () => {
		expect(goalHorizon('2026-12-31', naa)).toBe('lang');
		expect(goalHorizon('2031-12-31', naa)).toBe('lang');
	});

	it('ingen eller ugyldig frist → kort sikt (pågående nå)', () => {
		expect(goalHorizon(null, naa)).toBe('kort');
		expect(goalHorizon(undefined, naa)).toBe('kort');
		expect(goalHorizon('ikke-en-dato', naa)).toBe('kort');
	});
});

describe('isGoalExpired', () => {
	const naa = new Date('2026-07-17T12:00:00Z');

	it('passert frist → utløpt', () => {
		expect(isGoalExpired('2026-06-30', naa)).toBe(true);
	});

	it('fremtidig, manglende eller ugyldig frist → ikke utløpt', () => {
		expect(isGoalExpired('2026-08-01', naa)).toBe(false);
		expect(isGoalExpired(null, naa)).toBe(false);
		expect(isGoalExpired('tull', naa)).toBe(false);
	});
});

describe('isWeightGoalReached', () => {
	it('nedgangsmål: nådd når vekten har krysset target nedover', () => {
		expect(isWeightGoalReached(105, 98, 100)).toBe(true);
		expect(isWeightGoalReached(105, 100, 100)).toBe(true);
		expect(isWeightGoalReached(105, 101.5, 100)).toBe(false);
	});

	it('oppgangsmål: nådd når vekten har krysset target oppover', () => {
		expect(isWeightGoalReached(70, 75, 74)).toBe(true);
		expect(isWeightGoalReached(70, 73, 74)).toBe(false);
	});
});

describe('isRunningGoalReached', () => {
	it('nådd når akkumulert km ≥ target', () => {
		expect(isRunningGoalReached(150.2, 150)).toBe(true);
		expect(isRunningGoalReached(149.9, 150)).toBe(false);
	});

	it('mål uten positiv target regnes aldri som nådd', () => {
		expect(isRunningGoalReached(50, 0)).toBe(false);
	});
});
