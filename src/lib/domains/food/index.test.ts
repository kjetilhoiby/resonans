import { describe, it, expect } from 'vitest';
import {
	MEAL_TYPE_TO_PREFIX,
	buildMealItemText,
	detectMealPrefix,
	ALL_MEAL_TYPES
} from './index';

describe('buildMealItemText', () => {
	it('bygger middagsprefiks', () => {
		expect(buildMealItemText('dinner', 'Taco')).toBe('middag: Taco');
	});

	it('trimmer tittelen', () => {
		expect(buildMealItemText('lunch', '  Matpakke med ost ')).toBe('lunsj: Matpakke med ost');
	});

	it('round-trip mot detectMealPrefix for alle måltidstyper', () => {
		for (const mealType of ALL_MEAL_TYPES) {
			const text = buildMealItemText(mealType, 'Fiskegrateng');
			const detected = detectMealPrefix(text);
			expect(detected, `prefiks '${MEAL_TYPE_TO_PREFIX[mealType]}' skal detekteres`).not.toBeNull();
			expect(detected!.mealType).toBe(mealType);
			expect(detected!.cleanTitle).toBe('Fiskegrateng');
		}
	});
});
