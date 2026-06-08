import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/db', () => ({ db: {}, sql: () => {} }));

import { categorizeTransaction, detectRecurring } from './transaction-categories';
import type { MerchantMappingCache } from './transaction-categories';
import type {
	ClassificationOverrideCache,
	TransactionMatchingRule
} from '$lib/server/classification-overrides';

describe('categorizeTransaction', () => {
	it('positive amount without caches → innskudd', () => {
		const result = categorizeTransaction(null, null, 5000);
		expect(result.category).toBe('innskudd');
	});

	it('negative amount without caches → ukategorisert', () => {
		const result = categorizeTransaction('random shop', null, -200);
		expect(result.category).toBe('ukategorisert');
	});

	it('typeText "MAT OG DRIKKE" → dagligvarer', () => {
		const result = categorizeTransaction('Rema 1000', 'MAT OG DRIKKE', -350);
		expect(result.category).toBe('dagligvarer');
	});

	it('typeText "restaurant" → kafe_og_restaurant', () => {
		const result = categorizeTransaction('Peppes Pizza', 'restaurant', -450);
		expect(result.category).toBe('kafe_og_restaurant');
	});

	it('keyword rule matches correct category', () => {
		const rules: TransactionMatchingRule[] = [
			{ category: 'dagligvarer', keywords: ['rema', 'kiwi', 'meny'], fixed: false }
		];
		const result = categorizeTransaction('REMA 1000 OSLO', null, -250, undefined, undefined, rules);
		expect(result.category).toBe('dagligvarer');
		expect(result.isFixed).toBe(false);
	});

	it('rules take priority over typeText', () => {
		const rules: TransactionMatchingRule[] = [
			{ category: 'hobby_og_fritid', keywords: ['peppes'], fixed: false }
		];
		// typeText would give kafe_og_restaurant, but the rule should win
		const result = categorizeTransaction('Peppes Pizza', 'restaurant', -450, undefined, undefined, rules);
		expect(result.category).toBe('hobby_og_fritid');
	});

	it('mappings take priority over rules', () => {
		const mappings: MerchantMappingCache = new Map([
			[
				'spotify',
				{
					category: 'medier_og_underholdning',
					subcategory: 'strommetjenester',
					label: 'Medier og underholdning',
					emoji: '📱',
					isFixed: true
				}
			]
		]);
		const rules: TransactionMatchingRule[] = [
			{ category: 'hobby_og_fritid', keywords: ['spotify'], fixed: false }
		];
		const result = categorizeTransaction('Spotify', null, -119, mappings, undefined, rules);
		expect(result.category).toBe('medier_og_underholdning');
		expect(result.isFixed).toBe(true);
		expect(result.subcategory).toBe('strommetjenester');
	});

	it('overrides take priority over everything', () => {
		const overrides: ClassificationOverrideCache = new Map([
			[
				'spotify|out',
				{ correctedCategory: 'hobby_og_fritid', correctedSubcategory: 'trening', weight: 3 }
			]
		]);
		const mappings: MerchantMappingCache = new Map([
			[
				'spotify',
				{
					category: 'medier_og_underholdning',
					subcategory: 'strommetjenester',
					label: 'Medier og underholdning',
					emoji: '📱',
					isFixed: true
				}
			]
		]);
		const rules: TransactionMatchingRule[] = [
			{ category: 'dagligvarer', keywords: ['spotify'], fixed: false }
		];
		const result = categorizeTransaction('Spotify', null, -119, mappings, overrides, rules);
		expect(result.category).toBe('hobby_og_fritid');
		expect(result.subcategory).toBe('trening');
	});
});

describe('detectRecurring', () => {
	it('same merchant in 2 months with similar amounts → recurring', () => {
		const transactions = [
			{ description: 'Netflix', amount: -149, month: '2024-01' },
			{ description: 'Netflix', amount: -149, month: '2024-02' }
		];
		const result = detectRecurring(transactions);
		expect(result.size).toBe(1);
		expect(result.has('netflix|-150')).toBe(true);
	});

	it('same merchant but wildly different amounts → not recurring', () => {
		const transactions = [
			{ description: 'Vipps', amount: -50, month: '2024-01' },
			{ description: 'Vipps', amount: -500, month: '2024-02' }
		];
		const result = detectRecurring(transactions);
		expect(result.size).toBe(0);
	});

	it('only 1 month → not recurring', () => {
		const transactions = [
			{ description: 'Netflix', amount: -149, month: '2024-01' },
			{ description: 'Netflix', amount: -149, month: '2024-01' }
		];
		const result = detectRecurring(transactions);
		expect(result.size).toBe(0);
	});

	it('positive amounts are ignored', () => {
		const transactions = [
			{ description: 'Employer AS', amount: 50000, month: '2024-01' },
			{ description: 'Employer AS', amount: 50000, month: '2024-02' }
		];
		const result = detectRecurring(transactions);
		expect(result.size).toBe(0);
	});

	it('returns correctly formatted key "merchant|roundedAmount"', () => {
		const transactions = [
			{ description: 'Spotify AB', amount: -119, month: '2024-01' },
			{ description: 'Spotify AB', amount: -119, month: '2024-02' },
			{ description: 'Spotify AB', amount: -119, month: '2024-03' }
		];
		const result = detectRecurring(transactions);
		expect(result.size).toBe(1);
		const key = [...result][0];
		expect(key).toBe('spotify ab|-120');
	});
});
