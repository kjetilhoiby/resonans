import { describe, it, expect } from 'vitest';
import {
	classifyPrefix,
	extractPrefix,
	findBookedDuplicates,
	hasCurrencyCodePrefix,
	summarizeBookedDuplicates,
	summarizeForeignByMonth,
	type BookedDuplicateRow
} from './booked-duplicates';

function row(
	id: string,
	date: string,
	amount: number,
	description: string,
	extra: Partial<BookedDuplicateRow> = {}
): BookedDuplicateRow {
	return { id, accountId: 'a1', date, amount, description, status: 'booked', ...extra };
}

describe('extractPrefix', () => {
	it('finner valutaprefikset', () => {
		expect(extractPrefix('USD OPENAI', 'OPENAI')).toEqual({ prefix: 'usd', longer: 'usd openai' });
		expect(extractPrefix('OPENAI', 'USD OPENAI')).toEqual({ prefix: 'usd', longer: 'usd openai' });
	});

	it('finner datoprefikset', () => {
		expect(extractPrefix('02.07 SPORT 1 RINDAL', 'SPORT 1 RINDAL')?.prefix).toBe('02.07');
	});

	it('finner navneprefikset', () => {
		expect(extractPrefix('Lars Terje Husbyn FPL-fee Tollgaarden', 'FPL-fee Tollgaarden')?.prefix).toBe(
			'lars terje husbyn'
		);
	});

	// Uten ordskillet ville «NORDEA»/«EA» gitt prefikset «nord», altså to urelaterte
	// betalinger paret på en tilfeldig delstreng.
	it('krever ordskille, ikke bare delstreng', () => {
		expect(extractPrefix('NORDEA', 'EA')).toBeNull();
		expect(extractPrefix('KIWI STORGATA', 'GATA')).toBeNull();
	});

	it('gir null for identiske og tomme', () => {
		expect(extractPrefix('OPENAI', 'OPENAI')).toBeNull();
		expect(extractPrefix('  openai ', 'OPENAI')).toBeNull();
		expect(extractPrefix('', 'OPENAI')).toBeNull();
	});
});

describe('classifyPrefix', () => {
	it('kjenner valutakodene fra prod', () => {
		for (const code of ['DKK', 'USD', 'SEK', 'EUR']) {
			expect(classifyPrefix(code)).toBe('currency');
		}
	});

	it('kjenner datoformatet', () => {
		expect(classifyPrefix('02.07')).toBe('date');
		expect(classifyPrefix('7.6')).toBe('date');
	});

	it('gir «other» for personnavn og ukjente ord', () => {
		expect(classifyPrefix('lars terje husbyn')).toBe('other');
		expect(classifyPrefix('betaling av')).toBe('other');
	});
});

describe('findBookedDuplicates', () => {
	it('parer valutaprefiks på samme dag og beløp', () => {
		const pairs = findBookedDuplicates([
			row('r1', '2026-08-02', -244, 'USD OPENAI CHATGPT SUBSCR', { currency: 'USD' }),
			row('r2', '2026-08-02', -244, 'OPENAI CHATGPT SUBSCR')
		]);

		expect(pairs).toHaveLength(1);
		expect(pairs[0].prefixKind).toBe('currency');
		expect(pairs[0].confidence).toBe('high');
		expect(pairs[0].currencyConfirms).toBe(true);
		// Raden MED prefikset fjernes: «USD OPENAI» kategoriserer dårligere enn «OPENAI».
		expect(pairs[0].redundantId).toBe('r1');
		expect(pairs[0].keptId).toBe('r2');
	});

	it('graderer personnavn som medium, ikke high', () => {
		const [pair] = findBookedDuplicates([
			row('r1', '2026-08-13', -250, 'Lars Terje Husbyn FPL-fee Tollgaarden'),
			row('r2', '2026-08-13', -250, 'FPL-fee Tollgaarden')
		]);

		expect(pair.prefixKind).toBe('other');
		expect(pair.confidence).toBe('medium');
	});

	// Dette er hele risikoen ved motoren: et gjentatt kjøp har identisk beskrivelse, og
	// ingenting i radene skiller det fra et duplikat.
	it('rører ALDRI identiske beskrivelser', () => {
		expect(
			findBookedDuplicates([
				row('r1', '2026-06-18', -85, 'Ruter'),
				row('r2', '2026-06-18', -85, 'Ruter')
			])
		).toEqual([]);
	});

	it('krever samme dag — to trikkebilletter er ikke ett kjøp', () => {
		expect(
			findBookedDuplicates([
				row('r1', '2026-06-07', -41, 'USD Ruter'),
				row('r2', '2026-06-09', -41, 'Ruter')
			])
		).toEqual([]);
	});

	it('krever eksakt beløp — et avvik er den andre motorens jobb', () => {
		expect(
			findBookedDuplicates([
				row('r1', '2026-08-11', -1703.5, 'USD Oda.com'),
				row('r2', '2026-08-11', -1740.2, 'Oda.com')
			])
		).toEqual([]);
	});

	it('krever at BEGGE sider er bokført', () => {
		expect(
			findBookedDuplicates([
				row('r1', '2026-08-02', -244, 'USD OPENAI', { status: 'pending' }),
				row('r2', '2026-08-02', -244, 'OPENAI')
			])
		).toEqual([]);

		expect(
			findBookedDuplicates([
				row('r1', '2026-08-02', -244, 'USD OPENAI', { status: 'unknown' }),
				row('r2', '2026-08-02', -244, 'OPENAI')
			])
		).toEqual([]);
	});

	it('holder interne overføringer utenfor', () => {
		expect(
			findBookedDuplicates([
				row('r1', '2026-08-02', -950, 'Betaling av restskatt', { isInternalTransfer: true }),
				row('r2', '2026-08-02', -950, 'restskatt')
			])
		).toEqual([]);
	});

	it('krever samme konto og samme fortegn', () => {
		expect(
			findBookedDuplicates([
				row('r1', '2026-08-02', -244, 'USD OPENAI'),
				row('r2', '2026-08-02', -244, 'OPENAI', { accountId: 'annen' })
			])
		).toEqual([]);

		expect(
			findBookedDuplicates([
				row('r1', '2026-08-02', -244, 'USD OPENAI'),
				row('r2', '2026-08-02', 244, 'OPENAI')
			])
		).toEqual([]);
	});

	// Én-til-én. Uten det pekte alle tre USD-radene på den samme plain-raden, og to ekte
	// kjøp ville blitt deaktivert — samme feil som LATERAL-joinen gjorde.
	it('lar en beholdt rad absorbere bare ETT duplikat', () => {
		const pairs = findBookedDuplicates([
			row('r1', '2026-08-02', -244, 'USD OPENAI'),
			row('r2', '2026-08-02', -244, 'USD OPENAI'),
			row('r3', '2026-08-02', -244, 'OPENAI')
		]);

		expect(pairs).toHaveLength(1);
		const touched = [pairs[0].redundantId, pairs[0].keptId];
		expect(new Set(touched).size).toBe(2);
	});

	it('er deterministisk uansett radrekkefølge', () => {
		const rows = [
			row('r3', '2026-08-02', -244, 'OPENAI'),
			row('r1', '2026-08-02', -244, 'USD OPENAI')
		];
		const forward = findBookedDuplicates(rows);
		const reversed = findBookedDuplicates([...rows].reverse());

		expect(forward).toEqual(reversed);
	});

	it('sorterer de største først', () => {
		const pairs = findBookedDuplicates([
			row('a1', '2026-06-23', -100, 'DKK SMÅ'),
			row('b1', '2026-06-23', -100, 'SMÅ'),
			row('a2', '2026-06-23', -3277, 'DKK DANSK CAMPING UNION'),
			row('b2', '2026-06-23', -3277, 'DANSK CAMPING UNION')
		]);

		expect(pairs.map((p) => p.amount)).toEqual([3277, 100]);
	});
});

describe('summarizeBookedDuplicates', () => {
	it('grupperer på prefikstype og tillit', () => {
		const pairs = findBookedDuplicates([
			row('a1', '2026-08-02', -244, 'USD OPENAI'),
			row('b1', '2026-08-02', -244, 'OPENAI'),
			row('a2', '2026-08-13', -250, 'Lars Terje Husbyn FPL-fee'),
			row('b2', '2026-08-13', -250, 'FPL-fee')
		]);

		expect(summarizeBookedDuplicates(pairs)).toEqual([
			{ prefixKind: 'other', confidence: 'medium', pairs: 1, nok: 250 },
			{ prefixKind: 'currency', confidence: 'high', pairs: 1, nok: 244 }
		]);
	});

	it('gir tom liste uten par', () => {
		expect(summarizeBookedDuplicates([])).toEqual([]);
	});
});

describe('hasCurrencyCodePrefix', () => {
	it('kjenner valutakode som første ord', () => {
		expect(hasCurrencyCodePrefix('USD OPENAI')).toBe(true);
		expect(hasCurrencyCodePrefix('  dkk  dansk camping union ')).toBe(true);
	});

	it('krever at koden er FØRSTE ord', () => {
		expect(hasCurrencyCodePrefix('OPENAI USD')).toBe(false);
		expect(hasCurrencyCodePrefix('USDA KJØTT')).toBe(false);
		expect(hasCurrencyCodePrefix('OPENAI')).toBe(false);
		expect(hasCurrencyCodePrefix('')).toBe(false);
	});
});

describe('summarizeForeignByMonth', () => {
	// Testen som skiller «banken endret seg» fra «utvalget endret seg». Et upar-et
	// valutaprefiks i en tidlig måned betyr at banken skrev bare én variant den gangen.
	it('skiller uparede valutaprefikser fra fravær av utenlandskjøp', () => {
		const summary = summarizeForeignByMonth(
			[
				// April: ett utenlandskjøp, ingen partner
				{ id: 'apr1', date: '2026-04-10', description: 'USD OPENAI', currency: 'USD' },
				{ id: 'apr2', date: '2026-04-11', description: 'KIWI', currency: 'NOK' },
				// Mai: ingen utenlandskjøp i det hele tatt
				{ id: 'mai1', date: '2026-05-04', description: 'REMA 1000', currency: 'NOK' },
				// Juli: et par
				{ id: 'jul1', date: '2026-07-02', description: 'USD OPENAI', currency: 'USD' },
				{ id: 'jul2', date: '2026-07-02', description: 'OPENAI', currency: 'NOK' }
			],
			new Set(['jul1', 'jul2'])
		);

		expect(summary).toEqual([
			{
				month: '2026-04',
				rows: 2,
				foreignCurrency: 1,
				currencyPrefix: 1,
				currencyPrefixUnpaired: 1
			},
			{ month: '2026-05', rows: 1, foreignCurrency: 0, currencyPrefix: 0, currencyPrefixUnpaired: 0 },
			{
				month: '2026-07',
				rows: 2,
				foreignCurrency: 1,
				currencyPrefix: 1,
				currencyPrefixUnpaired: 0
			}
		]);
	});

	it('sorterer kronologisk', () => {
		const summary = summarizeForeignByMonth(
			[
				{ id: 'b', date: '2026-08-01', description: 'KIWI' },
				{ id: 'a', date: '2026-03-01', description: 'KIWI' }
			],
			new Set()
		);
		expect(summary.map((m) => m.month)).toEqual(['2026-03', '2026-08']);
	});

	it('gir tom liste uten rader', () => {
		expect(summarizeForeignByMonth([], new Set())).toEqual([]);
	});
});
