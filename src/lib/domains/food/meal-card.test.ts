import { describe, it, expect } from 'vitest';
import {
	buildMealCardHistory,
	familyIngredients,
	findDuplicateGroups,
	mergeMealFields,
	normalizeMealTitle,
	type MergeableMeal
} from './meal-card';

const TODAY = '2026-11-24';

function mergeable(partial: Partial<MergeableMeal>): MergeableMeal {
	return {
		title: 'Ramen',
		description: null,
		ingredients: [],
		instructions: [],
		prepTimeMin: null,
		cookTimeMin: null,
		servings: 4,
		tags: [],
		mainProtein: null,
		mainCarb: null,
		greens: null,
		wantMore: false,
		effortLevel: null,
		imageUrl: null,
		sourceUrl: null,
		nutritionEstimate: null,
		...partial
	};
}

describe('duplikater', () => {
	it('samme rett med ulik skrivemåte er en duplikat', () => {
		expect(normalizeMealTitle('  Taco-fredag! ')).toBe(normalizeMealTitle('taco fredag'));
	});

	it('en variant er ikke en duplikat', () => {
		expect(normalizeMealTitle('Ramen')).not.toBe(normalizeMealTitle('Ramen med egg'));
	});

	it('grupperer duplikater med den eldste først', () => {
		const groups = findDuplicateGroups([
			{ id: 'b', title: 'ramen', createdAt: '2026-11-02' },
			{ id: 'a', title: 'Ramen', createdAt: '2026-10-01' },
			{ id: 'c', title: 'Taco' }
		]);
		expect(groups.map((g) => g.map((m) => m.id))).toEqual([['a', 'b']]);
	});
});

describe('familyIngredients', () => {
	it('skalerer oppskriften til familiens porsjoner', () => {
		expect(
			familyIngredients([{ name: 'Kjøttdeig', quantity: 400, unit: 'g' }, { name: 'Løk', quantity: 1 }, { name: 'Salt' }], 4, 5)
		).toEqual([
			{ name: 'Kjøttdeig', quantity: 500, unit: 'g' },
			{ name: 'Løk', quantity: 1.5 },
			{ name: 'Salt', quantity: null }
		]);
	});
});

describe('buildMealCardHistory', () => {
	const plans = [
		{ id: 'p1', date: '2026-10-01', status: 'eaten' as const, notes: 'Doblet porsjonen', servings: 5 },
		{ id: 'p2', date: '2026-11-10', status: 'skipped' as const, notes: null, servings: 5 },
		{ id: 'p3', date: '2026-11-20', status: 'planned' as const, notes: null, servings: 5 },
		{ id: 'p4', date: '2026-11-27', status: 'planned' as const, notes: null, servings: 5 }
	];

	it('teller bare bekreftede middager som spist', () => {
		const history = buildMealCardHistory(plans, TODAY);
		expect(history.timesEaten).toBe(1);
		expect(history.timesSkipped).toBe(1);
		expect(history.lastEaten).toBe('2026-10-01');
		expect(history.nextPlanned).toBe('2026-11-27');
	});

	it('en plan på en dag som har vært står som ubekreftet', () => {
		const history = buildMealCardHistory(plans, TODAY);
		expect(history.occurrences.find((o) => o.planId === 'p3')?.reading).toBe('unconfirmed');
	});

	it('erfaringene er notatene med dato, nyeste først', () => {
		expect(buildMealCardHistory(plans, TODAY).experiences).toEqual([
			{ planId: 'p1', date: '2026-10-01', text: 'Doblet porsjonen' }
		]);
	});
});

describe('mergeMealFields', () => {
	it('den beholdte vinner der den har noe, den andre fyller hullene', () => {
		const merged = mergeMealFields(
			mergeable({ description: null, cookTimeMin: 20, tags: ['favoritt'] }),
			mergeable({ description: 'Japansk nudelsuppe', cookTimeMin: 40, tags: ['Favoritt', 'rask'], wantMore: true })
		);
		expect(merged).toMatchObject({
			description: 'Japansk nudelsuppe',
			cookTimeMin: 20,
			tags: ['favoritt', 'rask'],
			wantMore: true
		});
	});

	it('ingredienslister flettes ikke — den tomme får den andres hele, med porsjonene', () => {
		const other = [{ name: 'Nudler', quantity: 400, unit: 'g' }];
		const merged = mergeMealFields(mergeable({ ingredients: [], servings: 2 }), mergeable({ ingredients: other, servings: 4 }));
		expect(merged.ingredients).toEqual(other);
		expect(merged.servings).toBe(4);

		const kept = [{ name: 'Nudler', quantity: 300, unit: 'g' }];
		const both = mergeMealFields(mergeable({ ingredients: kept, servings: 2 }), mergeable({ ingredients: other, servings: 4 }));
		expect(both.ingredients).toEqual(kept);
		expect(both.servings).toBe(2);
	});
});
