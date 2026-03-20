/**
 * Rule-based transaction categorizer for Norwegian bank transactions.
 * Uses keyword matching on description + SB1 typeText/category fields.
 */

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

type Rule = {
	keywords: string[];
	category: CategoryId;
	fixed?: boolean; // override defaultFixed if set
};

const RULES: Rule[] = [
	// Inntekter
	{ keywords: ['lønn', 'lonn', 'salary', 'arbeidsgiver', 'folktrygd', 'nav '], category: 'lønn' },

	// Lån og avdrag — must come before bolig/transport so huslån/billån matcher først
	{
		keywords: [
			'terminkrav', 'avdrag laan', 'avdrag lån', 'lånerenter', 'lånekasse',
			'statens lånekasse', 'husbanken', 'bufetat lån', 'refinansier',
			'huslån', 'billån', 'boliglån', 'forbrukslån', 'rammelån',
			'annuitetslån', 'serielån'
		],
		category: 'lån', fixed: true
	},

	// Sparing og investering
	{ keywords: ['sparekonto', 'spareavtale', 'aksjesparekonto', 'ask ', 'fond', 'nordnet', 'kron.no', 'kron '], category: 'sparing', fixed: true },

	// Bolig
	{
		keywords: [
			'husleie', 'leie av', 'borettslag', 'sameie', 'obos', 'usbl ',
			'felleskostnader', 'felleskostn', 'strøm', 'fjernvarme', 'nettleie',
			'eiendomsskatt', 'kommunale', 'renovasjon', 'vann og avløp',
			'lys og varme', 'hafslund', 'lyse nett', 'agder energi', 'tibber', 'fortum'
		],
		category: 'bolig', fixed: true
	},

	// Forsikring
	{
		keywords: ['forsikring', 'gjensidige', 'tryg ', 'if forsikring', 'storebrand forsikring', 'fremtind', 'codan', 'frende', 'sb1 forsikring', 'sparebank 1 forsikring'],
		category: 'forsikring', fixed: true
	},

	// Abonnementer (faste)
	{
		keywords: ['netflix', 'spotify', 'viaplay', 'tv 2 play', 'tv2 play', 'discovery+', 'hbo', 'max ', 'disney+', 'nrk', 'apple.com', 'itunes', 'google play', 'youtube premium', 'microsoft 365', 'adobe', 'telia ', 'telenor', 'ice.net', 'chili mobil', 'onlyfans', 'dropbox', 'github'],
		category: 'abonnement', fixed: true
	},

	// Dagligvare
	{
		keywords: [
			'rema 1000', 'rema1000', 'kiwi ', 'coop ', 'meny ', 'spar ', 'bunnpris',
			'extra ', 'joker ', 'obs ', 'aldi ', 'lidl ', 'nærbutikk', 'kolonial',
			'marked ', 'dagligvare', 'matbutikk', 'matvarer', 'grocery',
			'willys', 'ica ', 'hakon gruppen',
			// Netthandel dagligvare
			'oda ', 'oda.com', 'oda as',
			'adams matkasse', 'adamsmatkasse',
			'godtlevert',
			'hverdagsmat',
			'matmesteren',
		],
		category: 'dagligvare'
	},

	// Mat ute og take-away
	{
		keywords: ['mcdonalds', 'mcdonald', 'burger king', 'kfc ', 'pizza', 'sushi', 'thai ', 'indian ', 'restaurant', 'café', 'cafe ', 'kafe ', 'kafé', 'bar ', ' pub ', 'foodora', 'wolt', 'just eat', 'dominos', 'subway ', 'starbucks', 'waynes coffee', 'espresso house', 'deli', 'bakeri', 'kantine', 'kebab', 'pølse'],
		category: 'mat'
	},

	// Barn og familie — faste utgifter (bhg, aks, svømmekurs osv.)
	{
		keywords: [
			'barnehage', 'bhg ', ' bhg', 'barnehageplass',
			'aktivitetsskole', ' aks ', 'aks-', '-aks', 'aks etter',
			' sfo ', 'skolefritidsordning',
			'svømmekurs', 'svømmeopplæring', 'svømmeskole', 'svømmeklubben',
			'korpsavgift', 'fotballavgift', 'håndballavgift', 'treningsavgift',
			'idrettslag', 'musikkorps', 'kulturskole',
			'skolepenger', 'lekesett', 'leker', 'toys',
			'klær barn', 'barneklær', 'jollyroom', 'babyworld', 'mothercare', 'babysam'
		],
		category: 'barn', fixed: true
	},

	// Transport
	{
		keywords: ['ruter ', 'vy ', 'nsb ', 'flytoget', 'norwegian.no', 'norwegian air', 'sas ', 'widerøe', 'flyr ', 'tripcom', 'booking.com', 'parkering', 'apcoa', 'europark', 'bompenger', 'autopass', 'passeringsgebyr', 'ferjeleie', 'atb ', 'kolumbus', 'skyss ', 'uber ', 'bolt ', 'taxi', 'cabonline', 'norgesbuss', 'valdresekspressen'],
		category: 'transport'
	},

	// Bil
	{
		keywords: ['bensinstasjon', 'circle k', 'uno-x', 'esso ', 'shell ', 'st1 ', 'neste ', 'drivstoff', 'elbil', 'lading', 'recharge ', 'mer charging', 'tesla ', 'bilverksted', 'dekk', 'bilservice', 'biltema', 'bil service', 'verksted', 'elbilforeningen', 'naf ', 'vianett', 'autopass'],
		category: 'transport', fixed: false
	},

	// Helse
	{
		keywords: ['apotek', 'vitusapotek', 'boots apotek', 'apotek1', 'lege ', 'fastlege', 'tannlege', 'sykehus', 'legevakt', 'helsestasjon', 'fysioterapi', 'kiropraktor', 'psykolog', 'psykiater', 'optiker', 'brilleland', 'synsam', 'specsavers'],
		category: 'helse'
	},

	// Trening / underholdning (NB: svømmekurs er under barn ovenfor)
	{
		keywords: ['sats ', 'elixia', 'evo fitness', 'treningssenter', 'gym ', 'svømmehall', 'kino ', 'oslo kino', 'nordisk film kino', 'billetservice', 'ticketmaster', 'konsert', 'teater', 'museum', 'steam ', 'playstation', 'xbox', 'nintendo', 'gaming', 'sport 1', 'g-sport', 'intersport'],
		category: 'underholdning'
	},

	// Shopping / klær
	{
		keywords: ['h&m ', 'hm.com', 'zara ', 'cubus ', 'dressman', 'lindex ', 'mango ', 'weekday', 'zalando', 'boozt', 'nelly.com', 'nike ', 'adidas ', 'stadium ', 'xxl ', 'jula ', 'elkjøp', 'apple store', 'power ', 'komplett.no', 'amazon', 'ebay ', 'wish ', 'temu ', 'ikea', 'jysk', 'biltema', 'byggmakker', 'obs bygg', 'maxbo'],
		category: 'shopping'
	},

	// Overføringer
	{
		keywords: ['vipps', 'overføring', 'betaling til', 'betaling fra', 'ovf.', 'til konto', 'fra konto', 'portefølje', 'internoverføring'],
		category: 'overføring'
	},
];

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
 */
export function categorizeTransaction(
	description: string | null,
	typeText: string | null,
	amount: number,
	mappings?: MerchantMappingCache
): CategorizeResult {
	const text = [description ?? '', typeText ?? ''].join(' ').toLowerCase();

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

	for (const rule of RULES) {
		if (rule.keywords.some((kw) => text.includes(kw.toLowerCase()))) {
			const cat = CATEGORIES[rule.category];
			return {
				category: cat.id,
				label: cat.label,
				emoji: cat.emoji,
				isFixed: rule.fixed !== undefined ? rule.fixed : cat.defaultFixed,
			};
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
