import { describe, it, expect } from 'vitest';
import { scoreMeal, suggestWeekDinners, type SuggestibleMeal } from './meal-suggestions';

function meal(overrides: Partial<SuggestibleMeal> & { id: string; title: string }): SuggestibleMeal {
	return {
		tags: [],
		prepTimeMin: null,
		cookTimeMin: null,
		ingredients: [],
		lastPlannedDate: null,
		timesPlanned: 0,
		...overrides
	};
}

const REF = { referenceDate: '2026-08-03', expiringPantryNames: [] as string[] };

describe('scoreMeal', () => {
	it('gir favoritt-tag pluss', () => {
		const fav = scoreMeal(meal({ id: '1', title: 'Taco', tags: ['favoritt'] }), REF);
		const plain = scoreMeal(meal({ id: '2', title: 'Suppe' }), REF);
		expect(fav.score).toBeGreaterThan(plain.score);
		expect(fav.reasons).toContain('familiefavoritt');
	});

	it('straffer retter brukt siste 14 dager hardt', () => {
		const recent = scoreMeal(meal({ id: '1', title: 'Taco', lastPlannedDate: '2026-07-28' }), REF);
		const old = scoreMeal(meal({ id: '2', title: 'Taco', lastPlannedDate: '2026-06-01' }), REF);
		expect(recent.score).toBeLessThan(old.score);
	});

	it('belønner ingredienser som går ut snart', () => {
		const withExpiring = scoreMeal(
			meal({ id: '1', title: 'Kyllingform', ingredients: [{ name: 'Kyllingfilet' }] }),
			{ referenceDate: '2026-08-03', expiringPantryNames: ['kyllingfilet'] }
		);
		expect(withExpiring.score).toBeGreaterThanOrEqual(1);
		expect(withExpiring.reasons.some((r) => r.includes('går ut snart'))).toBe(true);
	});

	it('belønner raske retter (tag eller total tid ≤30 min)', () => {
		const quick = scoreMeal(meal({ id: '1', title: 'Omelett', prepTimeMin: 5, cookTimeMin: 10 }), REF);
		expect(quick.reasons.some((r) => r.startsWith('rask'))).toBe(true);
	});

	it('nevner uker siden sist for gamle retter', () => {
		const { reasons } = scoreMeal(meal({ id: '1', title: 'Lasagne', lastPlannedDate: '2026-07-01' }), REF);
		expect(reasons.some((r) => r.includes('uker siden sist'))).toBe(true);
	});
});

describe('suggestWeekDinners', () => {
	const meals = [
		meal({ id: 'a', title: 'Taco', tags: ['favoritt'] }),
		meal({ id: 'b', title: 'Lasagne' }),
		meal({ id: 'c', title: 'Fiskegrateng' }),
		meal({ id: 'd', title: 'Omelett', tags: ['rask'] })
	];

	it('er deterministisk med samme seed', () => {
		const input = { days: ['2026-08-03', '2026-08-04'], meals, expiringPantryNames: [], seed: '2026-W32' };
		expect(suggestWeekDinners(input)).toEqual(suggestWeekDinners(input));
	});

	it('foreslår hver rett maks én gang per uke', () => {
		const result = suggestWeekDinners({
			days: ['2026-08-03', '2026-08-04', '2026-08-05'],
			meals,
			expiringPantryNames: [],
			seed: 'x'
		});
		const ids = result.map((d) => d.suggestion?.mealId).filter(Boolean);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('gir null når kartoteket er tomt for dager til overs', () => {
		const result = suggestWeekDinners({
			days: ['2026-08-03', '2026-08-04', '2026-08-05'],
			meals: meals.slice(0, 2),
			expiringPantryNames: [],
			seed: 'x'
		});
		expect(result[2].suggestion).toBeNull();
	});

	it('tilbyr alternativer som ikke er dagens forslag', () => {
		const result = suggestWeekDinners({
			days: ['2026-08-03'],
			meals,
			expiringPantryNames: [],
			seed: 'x'
		});
		const day = result[0];
		expect(day.alternatives.length).toBeGreaterThan(0);
		for (const alt of day.alternatives) {
			expect(alt.mealId).not.toBe(day.suggestion?.mealId);
		}
	});
});
