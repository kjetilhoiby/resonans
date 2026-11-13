import { describe, expect, it } from 'vitest';
import {
	aggregateProducts,
	linePaid,
	lineMatchesSearch,
	productHistories,
	productKey,
	purchaseAmount,
	summarizePurchases,
	type Purchase,
	type PurchaseLine
} from './grocery-purchases';

function line(partial: Partial<PurchaseLine> & { name: string }): PurchaseLine {
	return {
		ean: null,
		productGroup: null,
		category: 'annet',
		quantity: null,
		unitPrice: null,
		totalPrice: null,
		discount: null,
		...partial
	};
}

function purchase(partial: Partial<Purchase> & { id: string; date: string; lines: PurchaseLine[] }): Purchase {
	return {
		provider: 'rema1000',
		storeName: 'Rema 1000 Storgata',
		purchasedAt: null,
		weekContext: '2026-W46',
		total: null,
		...partial
	};
}

const melk = (unitPrice: number, discount: number | null = null) =>
	line({
		name: 'Tine Lettmelk 1L',
		ean: '7038010000737',
		category: 'meieri',
		quantity: 2,
		unitPrice,
		totalPrice: unitPrice * 2,
		discount
	});

describe('linePaid og purchaseAmount', () => {
	it('trekker rabatten fra linjebeløpet', () => {
		expect(linePaid(melk(21.9, 5))).toBe(38.8);
		expect(linePaid(line({ name: 'X' }))).toBeNull();
	});

	it('bruker kjedens total, og sier fra når den må summere linjene', () => {
		expect(purchaseAmount(purchase({ id: 'a', date: '2026-11-10', total: 250, lines: [melk(21.9)] }))).toEqual({
			amount: 250,
			fromLines: false
		});
		expect(purchaseAmount(purchase({ id: 'b', date: '2026-11-10', lines: [melk(20, 4)] }))).toEqual({
			amount: 36,
			fromLines: true
		});
	});
});

describe('summarizePurchases', () => {
	const purchases = [
		purchase({
			id: '1',
			date: '2026-11-03',
			weekContext: '2026-W45',
			total: 100,
			lines: [melk(20), line({ name: 'Banan', category: 'frukt_gront', totalPrice: 60 })]
		}),
		purchase({
			id: '2',
			date: '2026-11-10',
			weekContext: '2026-W46',
			provider: 'oda',
			storeName: null,
			total: 300,
			lines: [line({ name: 'Kjøttdeig', category: 'kjott_fisk', totalPrice: 300 })]
		})
	];

	it('summerer totaler, butikker, uker og kategoriandeler', () => {
		const summary = summarizePurchases(purchases);
		expect(summary).toMatchObject({ purchases: 2, spent: 400, averagePerPurchase: 200, amountsFromLines: 0 });
		expect(summary.byStore.map((s) => s.store)).toEqual(['Oda', 'Rema 1000 Storgata']); // like mange besøk: mest handlet først
		expect(summary.byPeriod).toEqual([
			{ period: '2026-W45', visits: 1, spent: 100 },
			{ period: '2026-W46', visits: 1, spent: 300 }
		]);
		expect(summary.byCategory[0]).toMatchObject({ category: 'kjott_fisk', label: 'Kjøtt og fisk', share: 0.75 });
		expect(summary.byCategory.reduce((acc, c) => acc + c.share, 0)).toBeCloseTo(1, 2);
	});

	it('grupperer på måned når det bes om', () => {
		expect(summarizePurchases(purchases, 'month').byPeriod).toEqual([{ period: '2026-11', visits: 2, spent: 400 }]);
	});
});

describe('produktnøkkel og søk', () => {
	it('bruker EAN når den finnes, ellers navnet', () => {
		expect(productKey({ ean: '123456789012', name: 'X' })).toBe('ean:123456789012');
		expect(productKey({ ean: null, name: 'Banan' }).startsWith('navn:')).toBe(true);
	});

	it('krever alle ordene, i vilkårlig rekkefølge, og EAN eksakt', () => {
		expect(lineMatchesSearch({ ean: null, name: 'TINE LETTMELK 1L' }, 'lettmelk tine')).toBe(true);
		expect(lineMatchesSearch({ ean: null, name: 'TINE LETTMELK 1L' }, 'lettmelk q')).toBe(false);
		expect(lineMatchesSearch({ ean: '7038010000737', name: 'Melk' }, '7038010000737')).toBe(true);
		expect(lineMatchesSearch({ ean: '7038010000737', name: 'Melk' }, '7038010000738')).toBe(false);
	});
});

describe('aggregateProducts', () => {
	const purchases = [
		purchase({ id: '1', date: '2026-10-01', lines: [melk(19.9), line({ name: 'Banan', totalPrice: 30 })] }),
		purchase({ id: '2', date: '2026-11-01', lines: [melk(21.9, 4)] })
	];

	it('slår sammen samme vare og teller kjøp, antall og betalt', () => {
		const { products, distinctProducts } = aggregateProducts(purchases);
		expect(distinctProducts).toBe(2);
		expect(products[0]).toMatchObject({
			name: 'Tine Lettmelk 1L',
			timesBought: 2,
			totalQuantity: 4,
			spent: 79.6,
			discount: 4,
			averageUnitPrice: 20.9,
			lastUnitPrice: 21.9,
			firstBought: '2026-10-01',
			lastBought: '2026-11-01'
		});
	});

	it('lar antallet stå tomt for varer uten antall framfor å påstå 0', () => {
		const banan = aggregateProducts(purchases).products.find((p) => p.name === 'Banan');
		expect(banan?.totalQuantity).toBeNull();
	});
});

describe('productHistories', () => {
	it('viser prisutviklingen på ordinær pris, ikke på tilbudet', () => {
		const purchases = [
			purchase({ id: '1', date: '2026-01-05', lines: [melk(19.9)] }),
			purchase({ id: '2', date: '2026-06-05', lines: [melk(21.9, 10)] })
		];
		const { matches, totalMatches } = productHistories(purchases, 'lettmelk');
		expect(totalMatches).toBe(1);
		expect(matches[0].purchases.map((p) => p.date)).toEqual(['2026-01-05', '2026-06-05']);
		expect(matches[0].unitPriceChange).toEqual({
			from: 19.9,
			to: 21.9,
			fromDate: '2026-01-05',
			toDate: '2026-06-05',
			changePct: 10.1
		});
	});

	it('holder ulike varer som treffer samme søk fra hverandre', () => {
		const purchases = [
			purchase({
				id: '1',
				date: '2026-01-05',
				lines: [melk(19.9), line({ name: 'Tine Helmelk 1L', ean: '7038010000720', unitPrice: 22 })]
			})
		];
		const { matches } = productHistories(purchases, 'melk');
		expect(matches).toHaveLength(2);
		expect(matches.every((m) => m.unitPriceChange === null)).toBe(true);
	});
});
