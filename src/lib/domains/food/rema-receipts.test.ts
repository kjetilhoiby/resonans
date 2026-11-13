import { describe, expect, it } from 'vitest';
import {
	REMA_REDIRECT_URI,
	buildRemaAuthorizeUrl,
	describeRowsShape,
	parseRemaCallbackInput,
	parseTransactionHeads,
	parseTransactionRows,
	selectTransactionsToFetch
} from './rema-receipts';

describe('buildRemaAuthorizeUrl', () => {
	it('bygger PKCE-adressen mot Æ-klienten', () => {
		const url = new URL(buildRemaAuthorizeUrl({ codeChallenge: 'abc', state: 'Xyz123' }));
		expect(url.origin + url.pathname).toBe('https://id.rema.no/authorization');
		expect(url.searchParams.get('client_id')).toBe('android-251010');
		expect(url.searchParams.get('redirect_uri')).toBe(REMA_REDIRECT_URI);
		expect(url.searchParams.get('code_challenge_method')).toBe('S256');
		expect(url.searchParams.get('scope')).toBe('all');
		expect(url.searchParams.get('state')).toBe('Xyz123');
	});

	it('nekter en state redirect-siden ville avvist', () => {
		expect(() => buildRemaAuthorizeUrl({ codeChallenge: 'abc', state: 'a-b' })).toThrow(/alfanumerisk/);
	});
});

describe('parseRemaCallbackInput', () => {
	it('leser koden fra appspot-adressen', () => {
		expect(
			parseRemaCallbackInput(`${REMA_REDIRECT_URI}?code=KODE42&state=S1`)
		).toEqual({ ok: true, code: 'KODE42', state: 'S1' });
	});

	it('leser koden fra deep-linken', () => {
		expect(parseRemaCallbackInput(' bella://authorize?code=K&state=S ')).toEqual({
			ok: true,
			code: 'K',
			state: 'S'
		});
	});

	it('godtar bare koden', () => {
		expect(parseRemaCallbackInput('abcDEF-123')).toEqual({ ok: true, code: 'abcDEF-123', state: null });
	});

	it('sier Remas egen feil framfor «ugyldig kode»', () => {
		const result = parseRemaCallbackInput('bella://authorize?error=WrongState');
		expect(result).toEqual({ ok: false, reason: 'Rema avviste innloggingen: WrongState' });
	});

	it('avviser en adresse uten kode', () => {
		expect(parseRemaCallbackInput(`${REMA_REDIRECT_URI}?state=S`).ok).toBe(false);
		expect(parseRemaCallbackInput('   ').ok).toBe(false);
	});
});

describe('parseTransactionHeads', () => {
	it('leser feltene og regner Oslo-dagen', () => {
		const { heads, rejected } = parseTransactionHeads({
			transactions: [
				{
					// 2026-11-12T23:30:00Z er 13. november i Oslo
					purchaseDate: Date.UTC(2026, 10, 12, 23, 30),
					storeId: '7080',
					amount: 249.9,
					storeName: 'Rema 1000 Storgate',
					id: 11223344556,
					receiptNbr: '2009210000123123123123123',
					ukjentFelt: 'skal ikke med'
				}
			]
		});
		expect(rejected).toBe(0);
		expect(heads).toEqual([
			{
				id: '11223344556',
				purchasedAt: new Date(Date.UTC(2026, 10, 12, 23, 30)),
				purchaseDay: '2026-11-13',
				storeId: '7080',
				storeName: 'Rema 1000 Storgate',
				amount: 249.9,
				receiptNbr: '2009210000123123123123123'
			}
		]);
	});

	it('avviser sekunder lest som millisekunder og id-er som ikke er heltall', () => {
		const { heads, rejected } = parseTransactionHeads({
			transactions: [
				{ id: 1, purchaseDate: 1600695669 }, // sekunder → 1970
				{ id: 1.5, purchaseDate: 1600695669000 },
				{ id: 2 ** 60, purchaseDate: 1600695669000 },
				null
			]
		});
		expect(heads).toEqual([]);
		expect(rejected).toBe(4);
	});

	it('kaster på et svar uten liste, så en endret kontrakt ikke ser ut som «ingen kjøp»', () => {
		expect(() => parseTransactionHeads({ purchaseTotal: 10 })).toThrow(/transactions/);
	});
});

describe('selectTransactionsToFetch', () => {
	const head = (id: string, day: number) => ({
		id,
		purchasedAt: new Date(Date.UTC(2026, 10, day)),
		purchaseDay: `2026-11-${String(day).padStart(2, '0')}`,
		storeId: null,
		storeName: null,
		amount: null,
		receiptNbr: null
	});

	it('hopper over importerte og tar de nyeste først', () => {
		const { toFetch, remaining } = selectTransactionsToFetch(
			[head('a', 1), head('b', 3), head('c', 2), head('d', 4)],
			new Set(['d']),
			2
		);
		expect(toFetch.map((h) => h.id)).toEqual(['b', 'c']);
		expect(remaining).toBe(1);
	});
});

describe('parseTransactionRows', () => {
	it('mapper en varelinje med EAN, rabatt og kategori fra varegruppa', () => {
		const { lines, rejected } = parseTransactionRows([
			{
				prodtxt1: 'NORVEGIA 1KG',
				prodtxt2: '',
				prodtxt3: '7038010009457',
				productCode: '109457',
				productDescription: 'Norvegia 26% 1kg',
				productGroupDescription: 'Ost',
				unitPrice: 109.9,
				amount: 109.9,
				discount: 20,
				usedOffers: []
			}
		]);
		expect(rejected).toBe(0);
		expect(lines).toEqual([
			{
				name: 'Norvegia 26% 1kg',
				ean: '7038010009457',
				productGroup: 'Ost',
				quantity: 1,
				unitPrice: 109.9,
				totalPrice: 109.9,
				discount: 20,
				category: 'meieri'
			}
		]);
	});

	it('regner antall bare når forholdet er et helt tall', () => {
		const { lines } = parseTransactionRows([
			{ prodtxt1: 'BANAN', unitPrice: 24.9, amount: 30.63 }, // vektvare
			{ prodtxt1: 'MELK', unitPrice: 21.5, amount: 64.5 },
			{ prodtxt1: 'POSE', quantity: 2, unitPrice: 2, amount: 4 }
		]);
		expect(lines.map((l) => l.quantity)).toEqual([null, 3, 2]);
	});

	it('faller tilbake på kvitteringsnavnet og forkaster linjer uten navn og ugyldig EAN', () => {
		const { lines, rejected } = parseTransactionRows([
			{ prodtxt1: 'KJØTTDEIG 400G', prodtxt3: 'ikke-ean', amount: 49.9 },
			{ amount: 10 }
		]);
		expect(rejected).toBe(1);
		expect(lines[0]).toMatchObject({ name: 'KJØTTDEIG 400G', ean: null, category: 'kjott_fisk', discount: null });
	});

	it('navngir feltene på avviste linjer, aldri verdiene', () => {
		const { rejectedFields } = parseTransactionRows({
			rows: [{ prodtxt1: 'MELK', amount: 20 }, { amount: 2, pantType: 'flaske' }, { discount: 5 }]
		});
		expect(rejectedFields).toEqual(['amount', 'discount', 'pantType']);
	});
});

describe('describeRowsShape', () => {
	it('ser gjennom innpakningen — Rema pakker lista i et objekt', () => {
		expect(describeRowsShape({ rows: [{ prodtxt1: 'X', amount: 1 }], total: 1 })).toEqual({
			wrapperKeys: ['rows', 'total'],
			rowKeys: ['amount', 'prodtxt1']
		});
	});

	it('sier at det ikke finnes innpakning når svaret er en ren liste', () => {
		expect(describeRowsShape([{ b: 1, a: 2 }])).toEqual({ wrapperKeys: null, rowKeys: ['a', 'b'] });
	});
});
