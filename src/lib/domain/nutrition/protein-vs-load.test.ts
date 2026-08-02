import { describe, it, expect } from 'vitest';
import {
	evaluateProteinVsLoad,
	proteinTargetPerKg,
	HIGH_EFFORT_WEEK,
	PROTEIN_G_PER_KG_HIGH,
	PROTEIN_G_PER_KG_LOW,
	type ProteinVsLoadInput
} from './protein-vs-load';

function input(overrides: Partial<ProteinVsLoadInput> = {}): ProteinVsLoadInput {
	return {
		proteinPerDay: 120,
		loggedDays: 5,
		weeklyEffort: 400,
		bodyWeightKg: 82,
		...overrides
	};
}

describe('proteinTargetPerKg', () => {
	it('gir lav ende uten trening og høy ende på full belastning', () => {
		expect(proteinTargetPerKg(0)).toBe(PROTEIN_G_PER_KG_LOW);
		expect(proteinTargetPerKg(HIGH_EFFORT_WEEK)).toBe(PROTEIN_G_PER_KG_HIGH);
	});

	it('interpolerer mellom dem', () => {
		// Halv belastning → midt imellom 1,2 og 1,7.
		expect(proteinTargetPerKg(HIGH_EFFORT_WEEK / 2)).toBe(1.5);
	});

	it('klemmer over full belastning til høy ende', () => {
		expect(proteinTargetPerKg(HIGH_EFFORT_WEEK * 3)).toBe(PROTEIN_G_PER_KG_HIGH);
	});

	it('behandler negativ effort som ingen trening', () => {
		expect(proteinTargetPerKg(-50)).toBe(PROTEIN_G_PER_KG_LOW);
	});
});

describe('evaluateProteinVsLoad', () => {
	it('regner mål fra vekt og belastning', () => {
		const result = evaluateProteinVsLoad(input({ proteinPerDay: 100, bodyWeightKg: 80, weeklyEffort: 400 }));
		// 80 kg × 1,7 g/kg = 136 g
		expect(result!.targetPerDay).toBe(136);
		expect(result!.actualPerDay).toBe(100);
		expect(result!.deficit).toBe(36);
	});

	it('sier fra når inntaket dekker behovet', () => {
		const result = evaluateProteinVsLoad(input({ proteinPerDay: 140, bodyWeightKg: 80 }));
		expect(result!.severity).toBe('info');
		expect(result!.deficit).toBeLessThanOrEqual(0);
		expect(result!.message).toContain('nok for belastningen');
	});

	it('graderer på andel, ikke på gram', () => {
		// Samme underskudd i gram, ulik kroppsvekt → ulik alvorlighet.
		const light = evaluateProteinVsLoad(input({ proteinPerDay: 52, bodyWeightKg: 60, weeklyEffort: 0 }));
		const heavy = evaluateProteinVsLoad(input({ proteinPerDay: 92, bodyWeightKg: 100, weeklyEffort: 0 }));
		// 60 × 1,2 = 72 → 52/72 = 0,72 (low). 100 × 1,2 = 120 → 92/120 = 0,77 (low).
		expect(light!.severity).toBe('low');
		expect(heavy!.severity).toBe('low');
		// Men et stort relativt avvik blir medium uansett vekt.
		expect(evaluateProteinVsLoad(input({ proteinPerDay: 40, bodyWeightKg: 80, weeklyEffort: 0 }))!.severity).toBe(
			'medium'
		);
	});

	it('krever nok loggede dager', () => {
		// Én dag logget sier ingenting om kostholdet.
		expect(evaluateProteinVsLoad(input({ loggedDays: 1 }))).toBeNull();
		expect(evaluateProteinVsLoad(input({ loggedDays: 2 }))).toBeNull();
		expect(evaluateProteinVsLoad(input({ loggedDays: 3 }))).not.toBeNull();
	});

	it('krever kjent kroppsvekt', () => {
		// Uten vekt finnes ingen g/kg å regne mot.
		expect(evaluateProteinVsLoad(input({ bodyWeightKg: null }))).toBeNull();
		expect(evaluateProteinVsLoad(input({ bodyWeightKg: 0 }))).toBeNull();
	});

	it('krever faktisk logget protein', () => {
		// «Du spiser 0 g protein» fordi brukeren ikke logget, er verre enn taushet.
		expect(evaluateProteinVsLoad(input({ proteinPerDay: null }))).toBeNull();
		expect(evaluateProteinVsLoad(input({ proteinPerDay: 0 }))).toBeNull();
	});

	it('tåler at ukens effort mangler og regner med lav ende', () => {
		const result = evaluateProteinVsLoad(input({ weeklyEffort: null, bodyWeightKg: 80, proteinPerDay: 100 }));
		expect(result!.gPerKg).toBe(1.2);
		expect(result!.targetPerDay).toBe(96);
		expect(result!.weeklyEffort).toBe(0);
	});

	it('formulerer underskuddet i norsk prosa med gram som mangler', () => {
		const result = evaluateProteinVsLoad(input({ proteinPerDay: 100, bodyWeightKg: 80, weeklyEffort: 400 }));
		expect(result!.message).toContain('100 g protein per dag');
		expect(result!.message).toContain('136 g anbefalt');
		expect(result!.message).toContain('36 g mer per dag');
	});

	it('har andel over 1 når man spiser mer enn målet', () => {
		const result = evaluateProteinVsLoad(input({ proteinPerDay: 200, bodyWeightKg: 80, weeklyEffort: 0 }));
		expect(result!.share).toBeGreaterThan(1);
		expect(result!.severity).toBe('info');
	});
});
