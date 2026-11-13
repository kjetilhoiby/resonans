import { z } from 'zod';
import { addDaysIso, osloTodayIso } from '$lib/server/iso-week';
import { groceryCoverage, loadGroceryPurchases } from '$lib/server/food/grocery-purchases';
import {
	aggregateProducts,
	linePaid,
	productHistories,
	providerLabel,
	purchaseAmount,
	summarizePurchases
} from '$lib/domains/food/grocery-purchases';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_DAYS: Record<QueryType, number> = {
	summary: 90,
	receipts: 30,
	products: 90,
	product_history: 3650
};
const MAX_RECEIPTS = 100;
const MAX_PRODUCTS = 200;

type QueryType = 'summary' | 'receipts' | 'products' | 'product_history';

function osloTime(iso: string | null): string | null {
	if (!iso) return null;
	return new Date(iso).toLocaleTimeString('nb-NO', { timeZone: 'Europe/Oslo', hour: '2-digit', minute: '2-digit' });
}

/**
 * Dagligvarekjøpene med varelinjer — Rema 1000-kvitteringene fra Æ-appen og
 * Oda-ordrene fra e-post. Bare lesing. Se docs/mcp.md («Dagligvarekjøp») og
 * `$lib/domains/food/grocery-purchases.ts`.
 */
export const queryGroceriesTool = {
	name: 'query_groceries',
	description: `Les brukerens dagligvarekjøp med varelinjer: Rema 1000-kvitteringer (fra Æ-appen, med EAN, pris og rabatt) og Oda-ordrer. Svarer på HVA som ble kjøpt, hvor ofte, hvor, og hva det kostet.

queryType:
- summary: antall handler, sum, snitt per handel, fordeling per kategori, butikk og uke/måned (groupBy). Standard siste 90 dager.
- receipts: kvitteringene, nyeste først, med butikk, tidspunkt og sum. includeLines=true gir varelinjene. Standard siste 30 dager.
- products: varene, samlet per vare (EAN, ellers navn): antall kjøp, mengde, betalt, rabatt, snittpris, sist kjøpt. search filtrerer, sort velger rekkefølge. Standard siste 90 dager.
- product_history: hvert kjøp av varene som treffer search (påkrevd), med enhetspris over tid og endring fra første til siste kjøp. Standard hele historikken.

Om tallene:
- Beløpet per kvittering er kjedens egen total. På varelinjene er totalPrice FØR rabatt og paid ETTER. Prisendringer regnes på ordinær enhetspris, så et tilbud ikke ser ut som et prisfall.
- Kategoriene er utledet av varegruppe og navn, og er omtrentlige.
- Dette er summen av kvitteringene vi har, ikke hele dagligvareforbruket: kjøp i andre kjeder finnes ikke her. Totalt forbruk leses fra banken med query_economics. Si hvilken kilde et kronetall kommer fra.
- coverage sier hvor langt tilbake dataene rekker per kilde. Et tomt svar før den datoen betyr «ikke hentet», ikke «ikke kjøpt».
- Søket må treffe alle ordene i varenavnet («lettmelk tine»), eller en EAN eksakt. Varenavnene er kjedens forkortelser, så prøv et kortere ord om et søk ikke gir treff.`,
	parameters: z.object({
		userId: z.string(),
		queryType: z.enum(['summary', 'receipts', 'products', 'product_history']),
		fromDate: z.string().optional().describe('Fra og med dato, YYYY-MM-DD.'),
		toDate: z.string().optional().describe('Til og med dato, YYYY-MM-DD. Standard i dag.'),
		search: z.string().optional().describe('Varenavn (alle ordene må finnes) eller EAN. Påkrevd for product_history.'),
		provider: z.enum(['rema1000', 'oda']).optional().describe('Bare én kilde. Standard begge.'),
		groupBy: z.enum(['week', 'month']).optional().describe('summary: periodene i byPeriod. Standard week.'),
		sort: z.enum(['count', 'spent', 'recent']).optional().describe('products: rekkefølge. Standard count.'),
		includeLines: z.boolean().optional().describe('receipts: ta med varelinjene. Standard false.'),
		limit: z.number().int().optional().describe(`Maks antall kvitteringer (≤${MAX_RECEIPTS}) eller varer (≤${MAX_PRODUCTS}).`)
	}),
	execute: async (args: {
		userId: string;
		queryType: QueryType;
		fromDate?: string;
		toDate?: string;
		search?: string;
		provider?: 'rema1000' | 'oda';
		groupBy?: 'week' | 'month';
		sort?: 'count' | 'spent' | 'recent';
		includeLines?: boolean;
		limit?: number;
	}) => {
		for (const [field, value] of [['fromDate', args.fromDate], ['toDate', args.toDate]] as const) {
			if (value != null && !ISO_DATE.test(value)) {
				return { error: `${field} må være YYYY-MM-DD`, code: 'invalid_argument' };
			}
		}
		const search = args.search?.trim();
		if (args.queryType === 'product_history' && !search) {
			return { error: 'product_history krever search (varenavn eller EAN)', code: 'invalid_argument' };
		}

		const toDate = args.toDate ?? osloTodayIso();
		const fromDate = args.fromDate ?? addDaysIso(toDate, -(DEFAULT_DAYS[args.queryType] - 1));
		if (fromDate > toDate) return { error: 'fromDate er etter toDate', code: 'invalid_argument' };

		const [purchases, coverage] = await Promise.all([
			loadGroceryPurchases(args.userId, { fromDate, toDate, provider: args.provider }),
			groceryCoverage(args.userId)
		]);
		const period = { fromDate, toDate };
		const sources = coverage.map((c) => ({ ...c, label: providerLabel(c.provider) }));

		if (coverage.length === 0) {
			return {
				period,
				coverage: [],
				note: 'Ingen dagligvarekjøp er hentet. Rema 1000 kobles til under Kilder i appen; Oda kommer fra e-post.'
			};
		}

		switch (args.queryType) {
			case 'summary':
				return { period, coverage: sources, ...summarizePurchases(purchases, args.groupBy ?? 'week') };

			case 'receipts': {
				const limit = Math.max(1, Math.min(MAX_RECEIPTS, Math.trunc(args.limit ?? 20)));
				const sorted = [...purchases].sort(
					(a, b) => b.date.localeCompare(a.date) || (b.purchasedAt ?? '').localeCompare(a.purchasedAt ?? '')
				);
				return {
					period,
					coverage: sources,
					totalReceipts: sorted.length,
					receipts: sorted.slice(0, limit).map((p) => {
						const { amount, fromLines } = purchaseAmount(p);
						return {
							id: p.id,
							date: p.date,
							time: osloTime(p.purchasedAt),
							store: p.storeName ?? providerLabel(p.provider),
							source: providerLabel(p.provider),
							amount,
							...(fromLines ? { amountIsLineSum: true } : {}),
							discount: Math.round(p.lines.reduce((acc, l) => acc + (l.discount ?? 0), 0) * 100) / 100,
							lineCount: p.lines.length,
							...(args.includeLines
								? {
										lines: p.lines.map((l) => ({
											name: l.name,
											ean: l.ean,
											category: l.category,
											quantity: l.quantity,
											unitPrice: l.unitPrice,
											paid: linePaid(l),
											discount: l.discount
										}))
									}
								: {})
						};
					})
				};
			}

			case 'products': {
				const limit = Math.max(1, Math.min(MAX_PRODUCTS, Math.trunc(args.limit ?? 30)));
				return {
					period,
					coverage: sources,
					purchasesInPeriod: purchases.length,
					...aggregateProducts(purchases, { search, sort: args.sort, limit })
				};
			}

			case 'product_history': {
				const result = productHistories(purchases, search!);
				return {
					period,
					coverage: sources,
					...result,
					...(result.totalMatches === 0
						? { note: 'Ingen varer traff søket. Varenavnene er kjedens forkortelser — prøv et kortere ord.' }
						: {})
				};
			}
		}
	}
};
