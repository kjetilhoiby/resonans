import { describe, it, expect } from 'vitest';
import {
	recurringKeyFor,
	summarizeSpending,
	type SummarizableTransaction
} from './spending-summary';
import type { CategoryId } from '$lib/integrations/transaction-categories-client';

function tx(
	amount: number,
	category: CategoryId,
	overrides: Partial<SummarizableTransaction> = {}
): SummarizableTransaction {
	return {
		amount,
		description: overrides.description ?? 'REMA BØLER',
		category,
		isFixed: overrides.isFixed ?? false,
		isInternalTransfer: overrides.isInternalTransfer ?? false
	};
}

describe('summarizeSpending', () => {
	it('summerer forbruk per kategori, høyeste først', () => {
		const summary = summarizeSpending([
			tx(-100, 'dagligvarer'),
			tx(-300, 'kafe_og_restaurant'),
			tx(-50, 'dagligvarer')
		]);

		expect(summary.totalSpending).toBe(450);
		expect(summary.categories.map((c) => [c.category, c.amount, c.count])).toEqual([
			['kafe_og_restaurant', 300, 1],
			['dagligvarer', 150, 2]
		]);
	});

	it('holder interne overføringer utenfor forbruket', () => {
		const summary = summarizeSpending([
			tx(-100, 'dagligvarer'),
			tx(-5000, 'sparing', { isInternalTransfer: true })
		]);

		expect(summary.totalSpending).toBe(100);
		expect(summary.internalTransferTotal).toBe(5000);
		expect(summary.categories.map((c) => c.category)).toEqual(['dagligvarer']);
	});

	it('teller bare utgående side av en overføring, ellers dobles beløpet', () => {
		const summary = summarizeSpending([
			tx(-5000, 'sparing', { isInternalTransfer: true }),
			tx(5000, 'innskudd', { isInternalTransfer: true })
		]);

		expect(summary.internalTransferTotal).toBe(5000);
		expect(summary.totalSpending).toBe(0);
		expect(summary.totalIncome).toBe(0);
	});

	it('lar ikke en intern overføring blåse opp inntekten', () => {
		// Dette var den doble feilen: samme flytting økte både forbruk og inntekt.
		const summary = summarizeSpending([
			tx(45000, 'innskudd', { description: 'LØNN' }),
			tx(-5000, 'sparing', { isInternalTransfer: true }),
			tx(5000, 'innskudd', { isInternalTransfer: true })
		]);

		expect(summary.totalIncome).toBe(45000);
	});

	it('splitter fast og variabelt', () => {
		const summary = summarizeSpending([
			tx(-1200, 'faste_boutgifter', { isFixed: true }),
			tx(-400, 'dagligvarer')
		]);

		expect(summary.totalFixed).toBe(1200);
		expect(summary.totalVariable).toBe(400);
		expect(summary.totalSpending).toBe(1600);
	});

	it('lar recurringKeys gjøre en ellers variabel rad fast', () => {
		const row = tx(-219, 'medier_og_underholdning', { description: 'SPOTIFYSE' });
		const keys = new Set([recurringKeyFor(row)]);

		const without = summarizeSpending([row]);
		const withKeys = summarizeSpending([row], { recurringKeys: keys });

		expect(without.totalFixed).toBe(0);
		expect(withKeys.totalFixed).toBe(219);
		expect(withKeys.totalVariable).toBe(0);
	});

	it('en kategori er fast bare når alt i den er fast', () => {
		const summary = summarizeSpending([
			tx(-219, 'medier_og_underholdning', { isFixed: true }),
			tx(-95, 'medier_og_underholdning', { isFixed: false })
		]);

		expect(summary.categories).toHaveLength(1);
		expect(summary.categories[0].isFixed).toBe(false);
	});

	it('faller tilbake på ukategorisert-definisjonen for en ukjent kategori', () => {
		const summary = summarizeSpending([tx(-10, 'tullball' as CategoryId)]);

		expect(summary.categories[0].label).toBe(CATEGORIES_UKATEGORISERT_LABEL);
	});

	it('tomt inn gir nuller, ikke NaN', () => {
		const summary = summarizeSpending([]);

		expect(summary).toMatchObject({
			totalSpending: 0,
			totalFixed: 0,
			totalVariable: 0,
			totalIncome: 0,
			internalTransferTotal: 0,
			categories: []
		});
	});
});

const CATEGORIES_UKATEGORISERT_LABEL = 'Ukategorisert';

describe('recurringKeyFor', () => {
	it('runder beløpet til nærmeste tier, så små prisøkninger ikke bryter nøkkelen', () => {
		expect(recurringKeyFor({ description: 'SPOTIFY', amount: -219 })).toBe(
			recurringKeyFor({ description: 'SPOTIFY', amount: -221 })
		);
	});

	it('er ufølsom for store/små bokstaver og mellomrom', () => {
		expect(recurringKeyFor({ description: '  Spotify  ', amount: -219 })).toBe(
			recurringKeyFor({ description: 'SPOTIFY', amount: -219 })
		);
	});
});
