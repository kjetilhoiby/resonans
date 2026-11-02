import { describe, it, expect } from 'vitest';
import {
	checklistStateForStatus,
	isFavoriteMeal,
	isMealPlanStatus,
	isTakeawayMeal,
	readMealStatus,
	statusFromChecklistItem,
	summarizeMealHistory,
	validateStatusForDate,
	withTag,
	type MealLogEntry
} from './meal-log';

const TODAY = '2026-11-02';

function entry(partial: Partial<MealLogEntry> & Pick<MealLogEntry, 'date'>): MealLogEntry {
	return {
		mealType: 'dinner',
		mealId: 'm-ramen',
		title: 'Ramen',
		status: 'eaten',
		takeaway: false,
		...partial
	};
}

describe('status', () => {
	it('kjenner bare de tre statusene', () => {
		expect(isMealPlanStatus('eaten')).toBe(true);
		expect(isMealPlanStatus('spist')).toBe(false);
		expect(isMealPlanStatus(null)).toBe(false);
	});

	it('avkrysset dag-punkt er spist, hoppet over er droppet', () => {
		expect(statusFromChecklistItem({ checked: true, skippedAt: null })).toBe('eaten');
		expect(statusFromChecklistItem({ checked: false, skippedAt: new Date() })).toBe('skipped');
		expect(statusFromChecklistItem({ checked: false, skippedAt: null })).toBe('planned');
	});

	it('et utsatt punkt er ikke droppet — planen flytter seg med det', () => {
		expect(
			statusFromChecklistItem({ checked: false, skippedAt: new Date(), snoozedToDate: '2026-11-04' })
		).toBe('planned');
	});

	it('speilet går begge veier uten tap', () => {
		for (const status of ['planned', 'eaten', 'skipped'] as const) {
			const state = checklistStateForStatus(status);
			expect(
				statusFromChecklistItem({ checked: state.checked, skippedAt: state.skipped ? new Date() : null })
			).toBe(status);
		}
	});
});

describe('validateStatusForDate', () => {
	it('avviser spist på en framtidig dag', () => {
		expect(validateStatusForDate('eaten', '2026-11-03', TODAY)).toMatch(/kan ikke være spist/);
	});

	it('godtar spist i dag og bakover', () => {
		expect(validateStatusForDate('eaten', TODAY, TODAY)).toBeNull();
		expect(validateStatusForDate('eaten', '2026-10-30', TODAY)).toBeNull();
	});

	it('planlagt og droppet er lov hvor som helst', () => {
		expect(validateStatusForDate('planned', '2026-12-24', TODAY)).toBeNull();
		expect(validateStatusForDate('skipped', '2026-11-05', TODAY)).toBeNull();
	});
});

describe('readMealStatus', () => {
	it('en plan på en dag som har vært er ubekreftet, ikke spist', () => {
		expect(readMealStatus('planned', '2026-11-01', TODAY)).toBe('unconfirmed');
	});

	it('dagens plan er fortsatt bare planlagt — middagen er kanskje ikke laget ennå', () => {
		expect(readMealStatus('planned', TODAY, TODAY)).toBe('planned');
	});

	it('bekreftede statuser leses som de står', () => {
		expect(readMealStatus('eaten', '2026-10-01', TODAY)).toBe('eaten');
		expect(readMealStatus('skipped', '2026-10-01', TODAY)).toBe('skipped');
	});
});

describe('tagger', () => {
	it('favoritt kjennes igjen uansett variant og store bokstaver', () => {
		expect(isFavoriteMeal(['Favoritt'])).toBe(true);
		expect(isFavoriteMeal(['slager'])).toBe(true);
		expect(isFavoriteMeal(['rask'])).toBe(false);
		expect(isFavoriteMeal(null)).toBe(false);
	});

	it('withTag legger til uten å røre andre tagger', () => {
		expect(withTag(['rask'], 'favoritt', true)).toEqual(['rask', 'favoritt']);
	});

	it('withTag fjerner alle favorittvarianter, ellers står retten fortsatt som favoritt', () => {
		const tags = withTag(['Favorite', 'rask', 'slager'], 'favoritt', false);
		expect(tags).toEqual(['rask']);
		expect(isFavoriteMeal(tags)).toBe(false);
	});

	it('withTag gir ikke duplikater når taggen alt finnes', () => {
		expect(withTag(['favoritt'], 'favoritt', true)).toEqual(['favoritt']);
	});

	it('takeaway er en tagg på retten', () => {
		expect(isTakeawayMeal(['Takeaway'])).toBe(true);
		expect(isTakeawayMeal(withTag([], 'takeaway', true))).toBe(true);
	});
});

describe('summarizeMealHistory', () => {
	it('teller bare bekreftede middager som spist', () => {
		const summary = summarizeMealHistory(
			[
				entry({ date: '2026-10-28' }),
				entry({ date: '2026-10-29', status: 'planned', mealId: 'm-taco', title: 'Taco' }),
				entry({ date: '2026-10-30', status: 'skipped', mealId: 'm-fisk', title: 'Fisk' })
			],
			TODAY
		);
		expect(summary.eaten).toBe(1);
		expect(summary.skipped).toBe(1);
		expect(summary.unconfirmed).toBe(1);
		expect(summary.note).toMatch(/Ikke tell dem som spist/);
	});

	it('rangerer mest spiste først, og sist spist ved likt antall', () => {
		const summary = summarizeMealHistory(
			[
				entry({ date: '2026-10-01', mealId: 'm-taco', title: 'Taco' }),
				entry({ date: '2026-10-05' }),
				entry({ date: '2026-10-20' }),
				entry({ date: '2026-10-25', mealId: 'm-taco', title: 'Taco' }),
				entry({ date: '2026-10-27', mealId: 'm-suppe', title: 'Suppe' })
			],
			TODAY
		);
		expect(summary.mostEaten.map((s) => [s.title, s.timesEaten, s.lastEaten])).toEqual([
			['Taco', 2, '2026-10-25'],
			['Ramen', 2, '2026-10-20'],
			['Suppe', 1, '2026-10-27']
		]);
	});

	it('en droppet plan er ikke bruk av retten', () => {
		const summary = summarizeMealHistory([entry({ date: '2026-10-30', status: 'skipped' })], TODAY);
		expect(summary.mostEaten).toEqual([]);
	});

	it('framtidige planer er ikke historikk', () => {
		const summary = summarizeMealHistory([entry({ date: '2026-11-05', status: 'planned' })], TODAY);
		expect(summary.eaten + summary.skipped + summary.unconfirmed).toBe(0);
		expect(summary.confirmedShare).toBeNull();
	});

	it('teller takeaway blant de spiste', () => {
		const summary = summarizeMealHistory(
			[entry({ date: '2026-10-31', mealId: 'm-peppes', title: 'Peppes pizza', takeaway: true }), entry({ date: '2026-11-01' })],
			TODAY
		);
		expect(summary.takeaway).toBe(1);
		expect(summary.mostEaten.find((s) => s.title === 'Peppes pizza')?.takeaway).toBe(true);
	});

	it('andelen bekreftet sier hvor mye historikken er verdt', () => {
		const summary = summarizeMealHistory(
			[entry({ date: '2026-10-30' }), entry({ date: '2026-10-31', status: 'planned' })],
			TODAY
		);
		expect(summary.confirmedShare).toBe(0.5);
	});
});
