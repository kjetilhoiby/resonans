import { describe, it, expect } from 'vitest';
import {
	macroPctWarning,
	validateTargetField,
	DEFAULT_MACRO_SPLIT,
	TARGET_FIELDS,
	TARGET_LIMITS
} from './target-settings';

describe('validateTargetField', () => {
	it('godtar null som «fjern målet»', () => {
		for (const field of TARGET_FIELDS) {
			expect(validateTargetField(field, null)).toBeNull();
		}
	});

	it('godtar verdier innenfor spennet, inkludert grensene', () => {
		for (const field of TARGET_FIELDS) {
			const [min, max] = TARGET_LIMITS[field];
			expect(validateTargetField(field, min)).toBeNull();
			expect(validateTargetField(field, max)).toBeNull();
			expect(validateTargetField(field, (min + max) / 2)).toBeNull();
		}
	});

	it('fanger den sannsynlige tastefeilen', () => {
		// 260 er 2 600 uten siste siffer.
		expect(validateTargetField('kcalTarget', 260)).toBe('Kalorimål må være mellom 800 og 6000.');
		expect(validateTargetField('proteinTarget', 1800)).toBe(
			'Proteinmål må være mellom 30 og 400.'
		);
	});

	it('avviser ikke-tall med feltets eget navn', () => {
		expect(validateTargetField('proteinPct', '30')).toBe('Proteinandel må være et tall.');
		expect(validateTargetField('fatPct', Number.NaN)).toBe('Fettandel må være et tall.');
		expect(validateTargetField('carbsPct', undefined)).toBe('Karboandel må være et tall.');
	});
});

describe('macroPctWarning', () => {
	it('sier ingenting når summen er nær 100', () => {
		expect(macroPctWarning(DEFAULT_MACRO_SPLIT)).toBeNull();
		expect(macroPctWarning({ proteinPct: 35, carbsPct: 35, fatPct: 35 })).toBeNull();
	});

	it('sier fra når de tre ikke kan nås samtidig', () => {
		expect(macroPctWarning({ proteinPct: 20, carbsPct: 20, fatPct: 20 })).toMatch(
			/summerer til 60 %/
		);
		expect(macroPctWarning({ proteinPct: 50, carbsPct: 50, fatPct: 40 })).toMatch(
			/summerer til 140 %/
		);
	});

	it('holder kjeft under tre andeler', () => {
		// Har man satt bare protein, er de to andre usatte — ikke 0 %.
		expect(macroPctWarning({ proteinPct: 30 })).toBeNull();
		expect(macroPctWarning({ proteinPct: 30, carbsPct: 40 })).toBeNull();
		expect(macroPctWarning({})).toBeNull();
		expect(macroPctWarning({ proteinPct: 30, carbsPct: 40, fatPct: null })).toBeNull();
	});

	it('teller 90 og 110 som greit', () => {
		expect(macroPctWarning({ proteinPct: 30, carbsPct: 30, fatPct: 30 })).toBeNull();
		expect(macroPctWarning({ proteinPct: 40, carbsPct: 40, fatPct: 30 })).toBeNull();
		expect(macroPctWarning({ proteinPct: 40, carbsPct: 40, fatPct: 31 })).toMatch(/111 %/);
	});
});

describe('DEFAULT_MACRO_SPLIT', () => {
	it('summerer til 100, ellers ville forslaget selv utløst advarselen', () => {
		const { proteinPct, carbsPct, fatPct } = DEFAULT_MACRO_SPLIT;
		expect(proteinPct + carbsPct + fatPct).toBe(100);
	});

	it('ligger innenfor de gyldige spennene', () => {
		expect(validateTargetField('proteinPct', DEFAULT_MACRO_SPLIT.proteinPct)).toBeNull();
		expect(validateTargetField('carbsPct', DEFAULT_MACRO_SPLIT.carbsPct)).toBeNull();
		expect(validateTargetField('fatPct', DEFAULT_MACRO_SPLIT.fatPct)).toBeNull();
	});
});
