// Dagligvare-hjelpere — normalisering, kategorisering og plan-vs-kjøp-matching
// for Oda-ordrer. Rene funksjoner uten db; deles av e-postprosessor, API og UI.

import { normalizeIngredientName } from './oda';

export type GroceryCategory =
	| 'frukt_gront'
	| 'meieri'
	| 'brod'
	| 'kjott_fisk'
	| 'torrvarer'
	| 'frys'
	| 'drikke'
	| 'snacks'
	| 'husholdning'
	| 'pant_gebyr'
	| 'annet';

export const GROCERY_CATEGORY_META: Record<GroceryCategory, { label: string; emoji: string }> = {
	frukt_gront: { label: 'Frukt og grønt', emoji: '🥦' },
	meieri: { label: 'Meieri', emoji: '🥛' },
	brod: { label: 'Brød og bakevarer', emoji: '🍞' },
	kjott_fisk: { label: 'Kjøtt og fisk', emoji: '🥩' },
	torrvarer: { label: 'Tørrvarer', emoji: '🥫' },
	frys: { label: 'Frysevarer', emoji: '🧊' },
	drikke: { label: 'Drikke', emoji: '🧃' },
	snacks: { label: 'Snacks', emoji: '🍫' },
	husholdning: { label: 'Husholdning', emoji: '🧼' },
	pant_gebyr: { label: 'Pant og gebyr', emoji: '🧾' },
	annet: { label: 'Annet', emoji: '🛒' }
};

/** Normalisert varenavn for matching: fjerner merkevare-/mengde-støy. */
export function normalizeGroceryName(name: string): string {
	return normalizeIngredientName(name)
		.replace(/\b\d+([.,]\d+)?\s*(g|kg|dl|cl|l|ml|stk|pk|pack|boks|pose|x\s*\d+)\b/g, ' ')
		.replace(/\b\d+([.,]\d+)?\s*%/g, ' ') // «lettmelk 1,0 %»
		.replace(/\s+/g, ' ')
		.trim();
}

const CATEGORY_KEYWORDS: Array<[GroceryCategory, RegExp]> = [
	[
		'pant_gebyr',
		/\bpant\b|levering(sgebyr)?|gebyr|frakt|poseavgift|bærepose/
	],
	[
		'frukt_gront',
		/eple|banan|appelsin|klementin|pære|drue|jordbær|blåbær|bringebær|melon|kiwi|mango|avokado|tomat|agurk|paprika|salat|gulrot|brokkoli|blomkål|løk|hvitløk|potet|squash|spinat|sopp|mais|frukt|grønnsak/
	],
	[
		'meieri',
		/melk|fløte|rømme|yoghurt|smør(?!brød)|ost(?!ekaker)|brunost|hvitost|kesam|cottage|crème|creme fraiche|egg\b/
	],
	['brod', /brød|rundstykk|baguett|knekkebrød|lefse|lomper?|bolle|croissant|toast/],
	[
		'kjott_fisk',
		/kjøttdeig|karbonadedeig|kylling|svin|storfe|biff|pølse|bacon|skinke|salami|leverpostei|laks|torsk|sei|makrell|fiskekak|fiskepinn|fiskegrat|reker|kjøtt|fisk/
	],
	['frys', /frossen|frys|iskrem|is\s|pizza\s?grandiosa|grandiosa/],
	['drikke', /juice|saft|brus|cola|solo|farris|vann\b|kaffe|te\b|kakao/],
	['snacks', /sjokolade|chips|godteri|kjeks|snacks|popcorn|nøtter|rosiner/],
	[
		'husholdning',
		/tørkerull|toalettpapir|zalo|oppvask|vaskemiddel|såpe|sjampo|tannkrem|bleie|folie|matpapir|pose[rn]?\b|batterier/
	],
	[
		'torrvarer',
		/mel\b|sukker|ris\b|pasta|spaghetti|makaroni|havregryn|müsli|musli|korn\b|linser|bønner|hermetisk|boks\b|tomatpuré|krydder|salt\b|pepper|olje|eddik|taco|saus|suppe|buljong|syltetøy|honning|peanøttsmør|knekkebrød/
	]
];

/** Gjett kategori fra varenavn — fallback når LLM ikke setter kategori. */
export function guessCategory(name: string): GroceryCategory {
	const normalized = name.toLowerCase();
	for (const [category, pattern] of CATEGORY_KEYWORDS) {
		if (pattern.test(normalized)) return category;
	}
	return 'annet';
}

/** Gjett pantry-lokasjon fra kategori/navn. null = ikke en lagerført matvare. */
export function guessPantryLocation(
	category: GroceryCategory,
	name: string
): 'pantry' | 'fridge' | 'freezer' | null {
	if (category === 'pant_gebyr' || category === 'husholdning') return null;
	if (category === 'frys' || /frossen|frys/i.test(name)) return 'freezer';
	if (category === 'meieri' || category === 'kjott_fisk') return 'fridge';
	if (category === 'frukt_gront') return 'fridge';
	if (category === 'torrvarer' || category === 'brod' || category === 'snacks' || category === 'drikke')
		return 'pantry';
	return null;
}

/** Er dette en matvare som hører hjemme i lageret (ikke pant/gebyr/husholdning)? */
export function isFoodLine(line: { name: string; category?: string | null }): boolean {
	const category = (line.category as GroceryCategory) || guessCategory(line.name);
	return category !== 'pant_gebyr' && category !== 'husholdning';
}

// Ord uten betydning for varematching («norsk», «økologisk», pakningsord osv.)
const STOPWORDS = new Set([
	'norsk',
	'norske',
	'økologisk',
	'økologiske',
	'fersk',
	'ferske',
	'original',
	'stor',
	'liten',
	'pk',
	'pakke',
	'boks',
	'pose',
	'flaske',
	'beger',
	'first',
	'price',
	'tine',
	'gilde',
	'prior',
	'mills',
	'toro',
	'freia',
	'stabburet',
	'i',
	'med',
	'og',
	'uten'
]);

function meaningfulTokens(name: string): string[] {
	return normalizeGroceryName(name)
		.split(/[\s,\-/]+/)
		.filter((token) => token.length >= 3 && !STOPWORDS.has(token) && !/^\d+$/.test(token));
}

function tokensOverlap(a: string[], b: string[]): boolean {
	return a.some((tokenA) =>
		b.some(
			(tokenB) =>
				tokenA === tokenB ||
				(tokenA.length >= 4 && tokenB.includes(tokenA)) ||
				(tokenB.length >= 4 && tokenA.includes(tokenB))
		)
	);
}

export type PlanVsPurchase = {
	bought: Array<{ planned: string; purchased: string }>;
	missing: string[]; // på handlelista, ikke på kvitteringen
	impulse: string[]; // på kvitteringen, ikke på handlelista (kun matvarer)
};

/**
 * Sammenlign ukas handleliste mot kvitteringens varelinjer.
 * Token-overlapp på normaliserte navn — «kjøttdeig (400 g)» matcher «Kjøttdeig av storfe 14% 400g».
 */
export function compareShoppingListToOrder(
	shoppingItems: Array<{ text: string }>,
	lines: Array<{ name: string; category?: string | null }>
): PlanVsPurchase {
	const lineTokens = lines.map((line) => ({ line, tokens: meaningfulTokens(line.name) }));
	const matchedLines = new Set<number>();

	const bought: PlanVsPurchase['bought'] = [];
	const missing: string[] = [];

	for (const item of shoppingItems) {
		const itemTokens = meaningfulTokens(item.text);
		const matchIndex = lineTokens.findIndex(
			({ tokens }, index) => !matchedLines.has(index) && tokensOverlap(itemTokens, tokens)
		);
		if (matchIndex >= 0) {
			matchedLines.add(matchIndex);
			bought.push({ planned: item.text, purchased: lineTokens[matchIndex].line.name });
		} else {
			missing.push(item.text);
		}
	}

	const impulse = lineTokens
		.filter(({ line }, index) => !matchedLines.has(index) && isFoodLine(line))
		.map(({ line }) => line.name);

	return { bought, missing, impulse };
}

/** ISO-ukenøkkel («2026-W31») for en ISO-dato. Samme algoritme som $lib/server/iso-week. */
export function weekContextForDate(isoDate: string): string {
	const [y, m, d] = isoDate.split('-').map(Number);
	const date = new Date(Date.UTC(y, m - 1, d));
	const dayNum = date.getUTCDay() || 7;
	date.setUTCDate(date.getUTCDate() + 4 - dayNum);
	const year = date.getUTCFullYear();
	const yearStart = new Date(Date.UTC(year, 0, 1));
	const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
	return `${year}-W${String(week).padStart(2, '0')}`;
}
