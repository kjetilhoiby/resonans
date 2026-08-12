/**
 * Rule-based transaction categorizer for Norwegian bank transactions.
 * Uses keyword matching on description + SB1 typeText/category fields.
 */

import {
	buildTransactionFingerprint,
	getOverrideCategory,
	getOverrideSubcategory,
	type ClassificationOverrideCache,
	loadTransactionMatchingRules,
	type TransactionMatchingRule
} from '$lib/server/classification-overrides';
import { CATEGORIES, normalizeCategoryId } from '$lib/integrations/transaction-categories-client';
import type { CategoryId, Category } from '$lib/integrations/transaction-categories-client';

// Re-export types for external consumers
export type { CategoryId, Category };
export { CATEGORIES };

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
		const overrideSubcategory = getOverrideSubcategory(overrides, fingerprint);
		return {
			category: cat.id,
			label: cat.label,
			emoji: cat.emoji,
			isFixed: cat.defaultFixed,
			subcategory: overrideSubcategory ?? undefined
		};
	}

	// --- Fast path: check per-user LLM-generated mappings first ---
	//
	// **Kategorien normaliseres, den castes ikke.** `merchant_mappings.category` ble skrevet
	// med LLM-ens rå output, og modellen svarte iblant med et BUTIKKNAVN der den skulle
	// svart med en CategoryId. Siden merchant-mappings har nest høyeste prioritet,
	// overstyrte den alle reglene: i prod august 2026 sto «OpenAI» som en egen kategori på
	// 15 153 kr, der bare 61 kr faktisk var OpenAI — resten var Nettgiro, eFaktura og en
	// intern overføring som havnet der fordi mappingen deres bar samme ugyldige kategori.
	//
	// En ugyldig mapping er verre enn ingen mapping. Treffer den ikke en kjent kategori,
	// faller vi gjennom til reglene framfor å bruke navnet som kategori. Labelen beholdes
	// bare når kategorien holder.
	if (mappings && description) {
		const key = description.toLowerCase().trim();
		const m = mappings.get(key);
		if (m) {
			const normalized = normalizeCategoryId(m.category);
			const mappingCategoryIsReal = m.category?.trim().toLowerCase() in CATEGORIES ||
				normalized !== 'ukategorisert';
			if (mappingCategoryIsReal) {
				const cat = CATEGORIES[normalized];
				return {
					category: normalized,
					label: m.label,
					emoji: m.emoji ?? cat.emoji,
					isFixed: m.isFixed,
					subcategory: m.subcategory
				};
			}
			// Faller gjennom til reglene under.
		}
	}

	// --- Keyword matching from database rules ---
	if (rules) {
		for (const rule of rules) {
			if (rule.keywords.some((kw) => text.includes(kw.toLowerCase()))) {
				const catId = normalizeCategoryId(rule.category);
				const cat = CATEGORIES[catId];
				if (!cat) continue; // Should never hit this after normalization, but guard anyway
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
		'mat og drikke': 'dagligvarer',
		'dagligvarer': 'dagligvarer',
		'restaurant': 'kafe_og_restaurant',
		'kafe': 'kafe_og_restaurant',
		'transport': 'bil_og_transport',
		'reise': 'reise',
		'flyreise': 'reise',
		'helse': 'helse_og_velvaere',
		'underholdning': 'medier_og_underholdning',
		'shopping': 'klaer_og_utstyr',
		'klær': 'klaer_og_utstyr',
		'lønn': 'innskudd',
		'overføring': 'diverse',
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
		const cat = CATEGORIES['innskudd'];
		return { category: 'innskudd', label: cat.label, emoji: cat.emoji, isFixed: false };
	}

	const cat = CATEGORIES['ukategorisert'];
	return { category: 'ukategorisert', label: cat.label, emoji: cat.emoji, isFixed: false };
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
