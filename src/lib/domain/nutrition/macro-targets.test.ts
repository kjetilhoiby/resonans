import { describe, it, expect } from 'vitest';
import {
	evaluateMacroTargets,
	MEANINGFUL_GAP_G,
	suggestedProteinTarget
} from './macro-targets';

/** Tallene fra 3. august kl. 15:57, altså midt i sultkrisa. */
const AT_1557 = { kcal: 634, proteinG: 31.2, carbsG: 50.9, fatG: 32.1 };

describe('suggestedProteinTarget', () => {
	it('foreslår midt i det anbefalte spennet', () => {
		// 100 kg × 1,8 g/kg = 180 g.
		expect(suggestedProteinTarget(100)).toBe(180);
	});

	it('gjetter ikke uten vekt', () => {
		expect(suggestedProteinTarget(null)).toBeNull();
		expect(suggestedProteinTarget(12)).toBeNull();
	});
});

describe('evaluateMacroTargets', () => {
	it('finner proteingapet i gram, ikke i prosentpoeng', () => {
		// «Du mangler 149 g protein» er handlingsrettet. «Du mangler 8
		// prosentpoeng» er det ikke.
		const result = evaluateMacroTargets({
			totals: AT_1557,
			targets: { kcal: 2600, proteinG: 180 }
		});
		const protein = result.macros.find((m) => m.key === 'protein')!;
		expect(protein.targetG).toBe(180);
		expect(protein.gapG).toBe(149);
		expect(result.biggestGap?.key).toBe('protein');
	});

	it('utleder gram-mål fra andel når bare andelen er satt', () => {
		// 30 % av 2 600 kcal er 780 kcal protein, altså 195 g.
		const result = evaluateMacroTargets({
			totals: AT_1557,
			targets: { kcal: 2600, proteinPct: 30, carbsPct: 40, fatPct: 30 }
		});
		expect(result.macros.find((m) => m.key === 'protein')!.targetG).toBe(195);
		// Fett: 30 % av 2 600 = 780 kcal, men 9 kcal/g → 87 g.
		expect(result.macros.find((m) => m.key === 'fat')!.targetG).toBe(87);
	});

	it('lar det absolutte proteinmålet vinne over andelen', () => {
		// Protein settes per kg kroppsvekt og er mer presist enn en andel.
		const result = evaluateMacroTargets({
			totals: AT_1557,
			targets: { kcal: 2600, proteinG: 180, proteinPct: 30 }
		});
		expect(result.macros.find((m) => m.key === 'protein')!.targetG).toBe(180);
	});

	it('gir ingen gram-mål fra andel uten kcal-mål', () => {
		// 30 % av ingenting er ingenting.
		const result = evaluateMacroTargets({
			totals: AT_1557,
			targets: { proteinPct: 30, carbsPct: 40, fatPct: 30 }
		});
		expect(result.macros.every((m) => m.targetG === null)).toBe(true);
		expect(result.kcalGap).toBeNull();
	});

	it('regner dagens andeler av makro-energien', () => {
		const result = evaluateMacroTargets({ totals: AT_1557, targets: {} });
		const sum = result.macros.reduce((acc, m) => acc + m.currentPct, 0);
		// Runder til hele prosent, så 99–101 er innafor.
		expect(sum).toBeGreaterThanOrEqual(99);
		expect(sum).toBeLessThanOrEqual(101);
		// Fett er største energikilde tross minst gram.
		expect(result.macros.find((m) => m.key === 'fat')!.currentPct).toBeGreaterThan(
			result.macros.find((m) => m.key === 'carbs')!.currentPct
		);
	});

	it('ser bort fra bagateller når den peker på største gap', () => {
		const result = evaluateMacroTargets({
			totals: { kcal: 2000, proteinG: 175, carbsG: 200, fatG: 60 },
			targets: { kcal: 2100, proteinG: 180 }
		});
		// 5 g under målet er under terskelen på 10.
		expect(MEANINGFUL_GAP_G).toBe(10);
		expect(result.biggestGap).toBeNull();
	});

	it('viser overskudd som negativt gap', () => {
		const result = evaluateMacroTargets({
			totals: { kcal: 2800, proteinG: 200, carbsG: 300, fatG: 100 },
			targets: { kcal: 2600, proteinG: 180 }
		});
		expect(result.macros.find((m) => m.key === 'protein')!.gapG).toBe(-20);
		expect(result.kcalGap).toBe(-200);
	});

	it('sier fra når ingen mål er satt', () => {
		expect(evaluateMacroTargets({ totals: AT_1557, targets: {} }).noTargets).toBe(true);
		expect(
			evaluateMacroTargets({ totals: AT_1557, targets: { kcal: 2600 } }).noTargets
		).toBe(false);
	});

	it('tåler en tom dag', () => {
		const result = evaluateMacroTargets({
			totals: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
			targets: { kcal: 2600, proteinG: 180 }
		});
		expect(result.macros.every((m) => m.currentPct === 0)).toBe(true);
		expect(result.macros.find((m) => m.key === 'protein')!.gapG).toBe(180);
	});
});
