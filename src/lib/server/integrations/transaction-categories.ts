/**
 * Rule-based transaction categorizer for Norwegian bank transactions.
 * Uses keyword matching on description + SB1 typeText/category fields.
 */

import {
	buildTransactionFingerprint,
	getOverrideCategory,
	type ClassificationOverrideCache,
	loadTransactionMatchingRules,
	type TransactionMatchingRule
} from '$lib/server/classification-overrides';
import type { CategoryId, Category } from '$lib/integrations/transaction-categories-client';

// Re-export types for external consumers
export type { CategoryId, Category };

export const CATEGORIES: Record<CategoryId, Category> = {
	dagligvare:    { id: 'dagligvare',   label: 'Dagligvare',            emoji: '🛒', defaultFixed: false },
	mat:           { id: 'mat',          label: 'Mat og drikke',          emoji: '🍽️', defaultFixed: false },
	bolig:         { id: 'bolig',        label: 'Bolig',                  emoji: '🏠', defaultFixed: true  },
	lån:           { id: 'lån',          label: 'Lån og avdrag',          emoji: '🏦', defaultFixed: true  },
	transport:     { id: 'transport',    label: 'Transport',              emoji: '🚗', defaultFixed: false },
	helse:         { id: 'helse',        label: 'Helse',                  emoji: '💊', defaultFixed: false },
	abonnement:    { id: 'abonnement',   label: 'Abonnementer',           emoji: '📱', defaultFixed: true  },
	underholdning: { id: 'underholdning',label: 'Underholdning',          emoji: '🎉', defaultFixed: false },
	shopping:      { id: 'shopping',     label: 'Shopping',               emoji: '🛍️', defaultFixed: false },
	barn:          { id: 'barn',         label: 'Barn og familie',        emoji: '👶', defaultFixed: true  },
	forsikring:    { id: 'forsikring',   label: 'Forsikring',             emoji: '🛡️', defaultFixed: true  },
	sparing:       { id: 'sparing',      label: 'Sparing',                emoji: '💰', defaultFixed: true  },
	overføring:    { id: 'overføring',   label: 'Overføringer',           emoji: '🔄', defaultFixed: false },
	lønn:          { id: 'lønn',         label: 'Lønn og inntekt',        emoji: '💵', defaultFixed: false },
	annet:         { id: 'annet',        label: 'Annet',                  emoji: '📦', defaultFixed: false },
};

/**
 * Transaction matching rules have been moved to database table: transaction_matching_rules
 * Load them using loadTransactionMatchingRules() from classification-overrides.ts
 * See seed-transaction-rules.mjs for the default rules.
 */

export type CategorizeResult = {
	category: CategoryId;
	label: string;
	emoji: string;
	isFixed: boolean;
	subcategory?: string | null;
};

/** Mapping loaded from merchant_mappings table */
export type MerchantMappingCache = Map<
	string,
	{ category: string; subcategory: string | null; label: string; emoji: string | null; isFixed: boolean }
>;

/**
 * Categorize a single transaction.
 * @param description - cleanedDescription from SB1
 * @param typeText    - typeText/category field from SB1 (e.g. "MAT OG DRIKKE")
 * @param amount      - transaction amount (negative = spending)
 * @param mappings    - optional per-user merchant mappings (checked first, fast path)
 * @param overrides   - optional per-user manual category overrides
 * @param rules       - transaction matching rules from database (load via loadTransactionMatchingRules)
 */
export function categorizeTransaction(
	description: string | null,
	typeText: string | null,
	amount: number,
	mappings?: MerchantMappingCache,
	overrides?: ClassificationOverrideCache,
	rules?: TransactionMatchingRule[]
): CategorizeResult {
	const text = [description ?? '', typeText ?? ''].join(' ').toLowerCase();

	// --- Highest priority: explicit user override by fingerprint ---
	const fingerprint = buildTransactionFingerprint(description, typeText, amount);
	const overrideCategory = getOverrideCategory(overrides, fingerprint);
	if (overrideCategory && CATEGORIES[overrideCategory as CategoryId]) {
		const cat = CATEGORIES[overrideCategory as CategoryId];
		return {
			category: cat.id,
			label: cat.label,
			emoji: cat.emoji,
			isFixed: cat.defaultFixed
		};
	}

	// --- Fast path: check per-user LLM-generated mappings first ---
	if (mappings && description) {
		const key = description.toLowerCase().trim();
		const m = mappings.get(key);
		if (m) {
			return {
				category: m.category as CategoryId,
				label: m.label,
				emoji: m.emoji ?? '📦',
				isFixed: m.isFixed,
				subcategory: m.subcategory
			};
		}
	}

	// --- Keyword matching from database rules ---
	if (rules) {
		for (const rule of rules) {
			if (rule.keywords.some((kw) => text.includes(kw.toLowerCase()))) {
				const cat = CATEGORIES[rule.category as CategoryId];
				if (!cat) continue; // Skip if category not defined
				return {
					category: cat.id,
					label: cat.label,
					emoji: cat.emoji,
					isFixed: rule.fixed !== null ? rule.fixed : cat.defaultFixed,
				};
			}
		}
	}

	// SB1 typeText fallback mapping
	const sb1Map: Record<string, CategoryId> = {
		'mat og drikke': 'dagligvare',
		'dagligvarer': 'dagligvare',
		'restaurant': 'mat',
		'transport': 'transport',
		'reise': 'transport',
		'flyreise': 'transport',
		'helse': 'helse',
		'underholdning': 'underholdning',
		'shopping': 'shopping',
		'klær': 'shopping',
		'lønn': 'lønn',
		'overføring': 'overføring',
		'sparing': 'sparing',
		'forsikring': 'forsikring',
	};

	const typeNorm = (typeText ?? '').toLowerCase().trim();
	for (const [key, catId] of Object.entries(sb1Map)) {
		if (typeNorm.includes(key)) {
			const cat = CATEGORIES[catId];
			return { category: cat.id, label: cat.label, emoji: cat.emoji, isFixed: cat.defaultFixed };
		}
	}

	// Income fallback
	if (amount > 0) {
		const cat = CATEGORIES['lønn'];
		return { category: 'lønn', label: cat.label, emoji: cat.emoji, isFixed: false };
	}

	const cat = CATEGORIES['annet'];
	return { category: 'annet', label: cat.label, emoji: cat.emoji, isFixed: false };
}

/**
 * Detect recurring (fixed) transactions by looking at same merchant
 * appearing ≥ 2 months in a row with similar amounts (±20%).
 * Returns a Set of "description|roundedAmount" keys that are recurring.
 */
export function detectRecurring(
	transactions: { description: string | null; amount: number; month: string }[]
): Set<string> {
	// Group: merchant → months with amounts
	const merchantMonths = new Map<string, Map<string, number[]>>();

	for (const tx of transactions) {
		if (!tx.description || tx.amount >= 0) continue;
		const key = tx.description.toLowerCase().trim();
		if (!merchantMonths.has(key)) merchantMonths.set(key, new Map());
		const monthMap = merchantMonths.get(key)!;
		const existing = monthMap.get(tx.month) ?? [];
		existing.push(tx.amount);
		monthMap.set(tx.month, existing);
	}

	const recurring = new Set<string>();

	for (const [merchant, monthMap] of merchantMonths) {
		if (monthMap.size < 2) continue;

		// Calculate median amount per month for this merchant
		const monthAmounts: number[] = [];
		for (const amounts of monthMap.values()) {
			monthAmounts.push(amounts.reduce((a, b) => a + b, 0) / amounts.length);
		}
		const medianAmt = monthAmounts.reduce((a, b) => a + b, 0) / monthAmounts.length;

		// Check if amounts are all within ±30% of median (allows for small price increases)
		const consistent = monthAmounts.every(
			(a) => Math.abs(a - medianAmt) / Math.max(Math.abs(medianAmt), 1) < 0.30
		);

		if (consistent) {
			const roundedAmt = Math.round(medianAmt / 10) * 10;
			recurring.add(`${merchant}|${roundedAmt}`);
		}
	}

	return recurring;
}
