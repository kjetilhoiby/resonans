/**
 * Dagligvarekjøp — rene sammendrag over `grocery_orders`/`grocery_order_lines`
 * (Rema-kvitteringer og Oda-ordrer), lest av `query_groceries`.
 *
 * Ingen db. Serverlaget henter radene og gjør dem om til `Purchase`; alt som
 * regnes, regnes her. Se `docs/changelog/2026-11-13-rema-kvitteringer.md`.
 *
 * Beløpene:
 * - `totalPrice` på en linje er linjebeløpet FØR rabatt, slik Rema oppgir det.
 *   Betalt er `totalPrice − discount`. Oda har ingen rabatt per linje, så der
 *   er de to like.
 * - `total` på kjøpet er det kjeden oppgir for hele kvitteringen. Det er tallet
 *   et «hvor mye handlet vi for» skal summere — linjene kan mangle (avviste
 *   linjer, pant), og da er linjesummen et GULV, ikke svaret.
 *
 * Forbruk telles fortsatt fra banken. Kvitteringene sier HVA som ble kjøpt; et
 * kronetall herfra er summen av de kvitteringene vi har, ikke hele handelen.
 */

import { GROCERY_CATEGORY_META, normalizeGroceryName, type GroceryCategory } from './grocery';

export interface PurchaseLine {
	name: string;
	ean: string | null;
	productGroup: string | null;
	category: string;
	quantity: number | null;
	unitPrice: number | null;
	/** FØR rabatt. */
	totalPrice: number | null;
	discount: number | null;
}

export interface Purchase {
	id: string;
	provider: string;
	storeName: string | null;
	/** Oslo-dato for kjøpet (eller leveringen, for Oda). */
	date: string;
	/** ISO-tidspunkt når kjeden oppgir det (Rema). */
	purchasedAt: string | null;
	weekContext: string;
	total: number | null;
	lines: PurchaseLine[];
}

const PROVIDER_LABEL: Record<string, string> = { rema1000: 'Rema 1000', oda: 'Oda' };

export function providerLabel(provider: string): string {
	return PROVIDER_LABEL[provider] ?? provider;
}

function round2(value: number): number {
	return Math.round(value * 100) / 100;
}

/** Betalt for linja: beløpet minus rabatten. null når beløpet mangler. */
export function linePaid(line: PurchaseLine): number | null {
	if (line.totalPrice == null) return null;
	return round2(line.totalPrice - (line.discount ?? 0));
}

/**
 * Hva kjøpet kostet. Kjedens total når den finnes; ellers summen av linjene,
 * merket som et anslag — en kvittering uten total og med avviste linjer ville
 * ellers sett ut som et fullstendig tall.
 */
export function purchaseAmount(purchase: Purchase): { amount: number; fromLines: boolean } {
	if (purchase.total != null) return { amount: purchase.total, fromLines: false };
	const sum = purchase.lines.reduce((acc, line) => acc + (linePaid(line) ?? 0), 0);
	return { amount: round2(sum), fromLines: true };
}

function categoryLabel(category: string): string {
	return GROCERY_CATEGORY_META[category as GroceryCategory]?.label ?? category;
}

// ─── Sammendrag ───────────────────────────────────────────────

export interface PurchaseSummary {
	purchases: number;
	spent: number;
	/** Kjøp der beløpet er summen av linjene fordi kjeden ikke oppga en total. */
	amountsFromLines: number;
	discount: number;
	averagePerPurchase: number | null;
	byCategory: Array<{ category: string; label: string; spent: number; share: number; lines: number }>;
	byStore: Array<{ store: string; provider: string; visits: number; spent: number }>;
	byPeriod: Array<{ period: string; visits: number; spent: number }>;
}

/**
 * Kategorisplitten regnes av LINJENE (betalt), ikke av kvitteringstotalen: en
 * total kan ikke deles på kategorier. Andelene er derfor andeler av det linjene
 * dekker, og summerer til 1 uavhengig av hull i linjene.
 */
export function summarizePurchases(purchases: Purchase[], groupBy: 'week' | 'month' = 'week'): PurchaseSummary {
	let spent = 0;
	let amountsFromLines = 0;
	let discount = 0;
	const categories = new Map<string, { spent: number; lines: number }>();
	const stores = new Map<string, { store: string; provider: string; visits: number; spent: number }>();
	const periods = new Map<string, { visits: number; spent: number }>();

	for (const purchase of purchases) {
		const { amount, fromLines } = purchaseAmount(purchase);
		spent += amount;
		if (fromLines) amountsFromLines++;

		const storeName = purchase.storeName ?? providerLabel(purchase.provider);
		const store = stores.get(storeName) ?? { store: storeName, provider: purchase.provider, visits: 0, spent: 0 };
		store.visits++;
		store.spent += amount;
		stores.set(storeName, store);

		const periodKey = groupBy === 'month' ? purchase.date.slice(0, 7) : purchase.weekContext;
		const period = periods.get(periodKey) ?? { visits: 0, spent: 0 };
		period.visits++;
		period.spent += amount;
		periods.set(periodKey, period);

		for (const line of purchase.lines) {
			discount += line.discount ?? 0;
			const paid = linePaid(line);
			if (paid == null) continue;
			const entry = categories.get(line.category) ?? { spent: 0, lines: 0 };
			entry.spent += paid;
			entry.lines++;
			categories.set(line.category, entry);
		}
	}

	const categoryTotal = [...categories.values()].reduce((acc, c) => acc + c.spent, 0);

	return {
		purchases: purchases.length,
		spent: round2(spent),
		amountsFromLines,
		discount: round2(discount),
		averagePerPurchase: purchases.length ? round2(spent / purchases.length) : null,
		byCategory: [...categories.entries()]
			.map(([category, c]) => ({
				category,
				label: categoryLabel(category),
				spent: round2(c.spent),
				share: categoryTotal > 0 ? Math.round((c.spent / categoryTotal) * 1000) / 1000 : 0,
				lines: c.lines
			}))
			.sort((a, b) => b.spent - a.spent),
		byStore: [...stores.values()]
			.map((s) => ({ ...s, spent: round2(s.spent) }))
			.sort((a, b) => b.visits - a.visits || b.spent - a.spent),
		byPeriod: [...periods.entries()]
			.map(([period, p]) => ({ period, visits: p.visits, spent: round2(p.spent) }))
			.sort((a, b) => a.period.localeCompare(b.period))
	};
}

// ─── Produkter ────────────────────────────────────────────────

/**
 * Nøkkelen for «samme vare». EAN når den finnes — kvitteringsnavnet er
 * forkortet og varierer («NORVEGIA 1KG» / «Norvegia 26% 1kg») — ellers det
 * normaliserte navnet. Oda har ingen EAN, så en vare kjøpt både hos Oda og Rema
 * blir to rader; det er en kjent rest, ikke noe vi gjetter oss forbi.
 */
export function productKey(line: Pick<PurchaseLine, 'ean' | 'name'>): string {
	return line.ean ? `ean:${line.ean}` : `navn:${normalizeGroceryName(line.name) || line.name.toLowerCase()}`;
}

/**
 * Søket treffer navnet (store/små bokstaver og norsk normalisering likegyldig)
 * eller EAN eksakt. Alle ordene i søket må finnes i navnet, så «melk lett»
 * treffer «Lettmelk 1L»-varianter uten å kreve rekkefølge.
 */
export function lineMatchesSearch(line: Pick<PurchaseLine, 'ean' | 'name'>, search: string): boolean {
	const query = search.trim().toLowerCase();
	if (!query) return true;
	if (/^\d{8,14}$/.test(query)) return line.ean === query;
	const haystack = `${line.name.toLowerCase()} ${normalizeGroceryName(line.name)}`;
	return query.split(/\s+/).every((word) => haystack.includes(word));
}

export interface ProductAggregate {
	key: string;
	name: string;
	ean: string | null;
	category: string;
	productGroup: string | null;
	timesBought: number;
	/** Sum av kjente antall; null når ingen av kjøpene hadde et antall (vektvarer). */
	totalQuantity: number | null;
	spent: number;
	discount: number;
	averageUnitPrice: number | null;
	lastUnitPrice: number | null;
	firstBought: string;
	lastBought: string;
}

interface ProductAccumulator extends Omit<ProductAggregate, 'averageUnitPrice' | 'lastUnitPrice'> {
	unitPrices: Array<{ date: string; price: number }>;
	quantityKnown: boolean;
}

function unitPriceOf(line: PurchaseLine): number | null {
	if (line.unitPrice != null && line.unitPrice > 0) return line.unitPrice;
	return null;
}

/** Linjene gruppert per vare, i kronologisk rekkefølge innad. */
function collectProducts(purchases: Purchase[], search?: string): Map<string, ProductAccumulator> {
	const products = new Map<string, ProductAccumulator>();
	const chronological = [...purchases].sort((a, b) => a.date.localeCompare(b.date));
	for (const purchase of chronological) {
		for (const line of purchase.lines) {
			if (search && !lineMatchesSearch(line, search)) continue;
			const key = productKey(line);
			const entry: ProductAccumulator = products.get(key) ?? {
				key,
				name: line.name,
				ean: line.ean,
				category: line.category,
				productGroup: line.productGroup,
				timesBought: 0,
				totalQuantity: null,
				spent: 0,
				discount: 0,
				firstBought: purchase.date,
				lastBought: purchase.date,
				unitPrices: [],
				quantityKnown: false
			};
			entry.timesBought++;
			// Siste navn vinner: det er navnet brukeren sist så på kvitteringen.
			entry.name = line.name;
			entry.lastBought = purchase.date;
			if (line.quantity != null) {
				entry.totalQuantity = (entry.totalQuantity ?? 0) + line.quantity;
				entry.quantityKnown = true;
			}
			entry.spent += linePaid(line) ?? 0;
			entry.discount += line.discount ?? 0;
			const price = unitPriceOf(line);
			if (price != null) entry.unitPrices.push({ date: purchase.date, price });
			products.set(key, entry);
		}
	}
	return products;
}

function finishProduct(entry: ProductAccumulator): ProductAggregate {
	const { unitPrices, quantityKnown, ...rest } = entry;
	return {
		...rest,
		totalQuantity: quantityKnown ? round2(entry.totalQuantity ?? 0) : null,
		spent: round2(entry.spent),
		discount: round2(entry.discount),
		averageUnitPrice: unitPrices.length
			? round2(unitPrices.reduce((acc, p) => acc + p.price, 0) / unitPrices.length)
			: null,
		lastUnitPrice: unitPrices.length ? unitPrices[unitPrices.length - 1].price : null
	};
}

export function aggregateProducts(
	purchases: Purchase[],
	options: { search?: string; sort?: 'count' | 'spent' | 'recent'; limit?: number } = {}
): { products: ProductAggregate[]; distinctProducts: number } {
	const all = [...collectProducts(purchases, options.search).values()].map(finishProduct);
	const sort = options.sort ?? 'count';
	all.sort((a, b) =>
		sort === 'spent'
			? b.spent - a.spent
			: sort === 'recent'
				? b.lastBought.localeCompare(a.lastBought)
				: b.timesBought - a.timesBought || b.spent - a.spent
	);
	return { products: all.slice(0, Math.max(1, options.limit ?? 30)), distinctProducts: all.length };
}

// ─── Prishistorikk for én vare ────────────────────────────────

export interface ProductHistory {
	key: string;
	name: string;
	ean: string | null;
	timesBought: number;
	purchases: Array<{
		date: string;
		store: string;
		quantity: number | null;
		unitPrice: number | null;
		paid: number | null;
		discount: number | null;
	}>;
	/**
	 * Første mot siste kjente enhetspris. Ordinær pris, før rabatt — en
	 * tilbudsuke skal ikke se ut som et prisfall.
	 */
	unitPriceChange: { from: number; to: number; fromDate: string; toDate: string; changePct: number } | null;
}

/**
 * Kjøpene av varene som treffer søket, en historikk per vare. Treffer søket
 * flere varer, kommer de mest kjøpte først — «melk» er flere varer, og å slå
 * dem sammen ville gjort en prisendring til et bytte av vare.
 */
export function productHistories(
	purchases: Purchase[],
	search: string,
	options: { maxProducts?: number } = {}
): { matches: ProductHistory[]; totalMatches: number } {
	const histories = new Map<string, ProductHistory>();
	const chronological = [...purchases].sort((a, b) => a.date.localeCompare(b.date));

	for (const purchase of chronological) {
		const store = purchase.storeName ?? providerLabel(purchase.provider);
		for (const line of purchase.lines) {
			const key = productKey(line);
			if (!lineMatchesSearch(line, search)) continue;
			const history = histories.get(key) ?? {
				key,
				name: line.name,
				ean: line.ean,
				timesBought: 0,
				purchases: [],
				unitPriceChange: null
			};
			history.name = line.name;
			history.timesBought++;
			history.purchases.push({
				date: purchase.date,
				store,
				quantity: line.quantity,
				unitPrice: unitPriceOf(line),
				paid: linePaid(line),
				discount: line.discount
			});
			histories.set(key, history);
		}
	}

	const all = [...histories.values()].map((history) => {
		const priced = history.purchases.filter((p) => p.unitPrice != null);
		if (priced.length >= 2) {
			const first = priced[0];
			const last = priced[priced.length - 1];
			history.unitPriceChange = {
				from: first.unitPrice!,
				to: last.unitPrice!,
				fromDate: first.date,
				toDate: last.date,
				changePct: Math.round(((last.unitPrice! - first.unitPrice!) / first.unitPrice!) * 1000) / 10
			};
		}
		return history;
	});
	all.sort((a, b) => b.timesBought - a.timesBought);
	return { matches: all.slice(0, Math.max(1, options.maxProducts ?? 5)), totalMatches: all.length };
}
