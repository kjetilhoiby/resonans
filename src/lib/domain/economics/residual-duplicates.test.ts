import { describe, it, expect } from 'vitest';
import {
	findResidualDuplicateSuspects,
	hasPrefixDrift,
	summarizeSkipReasons,
	type ResidualRow
} from './residual-duplicates';

function row(
	id: string,
	date: string,
	amount: number,
	description: string,
	status: ResidualRow['status'] = 'booked',
	extra: Partial<ResidualRow> = {}
): ResidualRow {
	return { id, accountId: 'a1', date, amount, description, status, ...extra };
}

describe('hasPrefixDrift', () => {
	// De faktiske parene fra prod 2026-08-16.
	it('kjenner igjen valutakode foran', () => {
		expect(hasPrefixDrift('DKK OERESUNDSLINJEN HOER', 'OERESUNDSLINJEN HOER')).toBe(true);
		expect(hasPrefixDrift('USD OPENAI CHATGPT SUBSCR', 'OPENAI CHATGPT SUBSCR')).toBe(true);
		expect(hasPrefixDrift('SEK TYCHO BRAHE', 'TYCHO BRAHE')).toBe(true);
	});

	// Den fjerde hadde et PERSONNAVN foran, ikke en valuta. Derfor sjekkes suffiks-forhold
	// framfor en liste over valutakoder — en slik liste ville dekket tre av fire og sett ut
	// som en løsning.
	it('kjenner igjen personnavn foran', () => {
		expect(hasPrefixDrift('Lars Terje Husbyn FPL-fee Tollgaarden', 'FPL-fee Tollgaarden')).toBe(
			true
		);
	});

	it('er retningsuavhengig', () => {
		expect(hasPrefixDrift('TYCHO BRAHE', 'SEK TYCHO BRAHE')).toBe(true);
	});

	it('sier nei til to ulike steder', () => {
		expect(hasPrefixDrift('KIWI BØLERL', 'REMA BØLER')).toBe(false);
	});

	it('sier nei til identiske beskrivelser', () => {
		// Identisk er ikke DRIFT. De håndteres som «samme beskrivelse» et annet sted.
		expect(hasPrefixDrift('KIWI BØLERL', 'kiwi bolerl ')).toBe(false);
		expect(hasPrefixDrift('KIWI BØLERL', 'KIWI BØLERL')).toBe(false);
	});

	it('lar ikke et felles suffiks-ORD alene være nok', () => {
		// «BØLER» er suffiks i begge, men ingen av dem er den andre pluss et prefiks.
		expect(hasPrefixDrift('KIWI BØLER', 'REMA BØLER')).toBe(false);
	});
});

describe('findResidualDuplicateSuspects', () => {
	it('finner paret og sier at BEGGE er bokført', () => {
		const suspects = findResidualDuplicateSuspects([
			row('a', '2026-08-02', -729, 'DKK OERESUNDSLINJEN HOER', 'booked'),
			row('b', '2026-08-02', -729, 'OERESUNDSLINJEN HOER', 'booked')
		]);

		expect(suspects).toHaveLength(1);
		expect(suspects[0].reason).toBe('begge-bokfort');
		expect(suspects[0].prefixDrift).toBe(true);
		expect(suspects[0].amountDeltaPct).toBe(0);
	});

	// Hypotese 2: valutakursen endret seg mellom reservasjon og bokføring, og lista viser
	// avrundede kroner så de ser identiske ut.
	it('finner paret og sier at beløpet er ulikt', () => {
		const suspects = findResidualDuplicateSuspects([
			row('a', '2026-08-02', -728.63, 'USD OPENAI CHATGPT SUBSCR', 'pending'),
			row('b', '2026-08-02', -729.14, 'OPENAI CHATGPT SUBSCR', 'booked')
		]);

		expect(suspects[0].reason).toBe('ulikt-belop');
		expect(suspects[0].amountDeltaPct).toBeGreaterThan(0);
		// Konservativt: det minste av de to beløpene.
		expect(suspects[0].amountNok).toBeCloseTo(728.63);
	});

	it('sier «skulle blitt fanget» når paret er matchbart', () => {
		const suspects = findResidualDuplicateSuspects([
			row('a', '2026-08-02', -729, 'DKK OERESUNDSLINJEN HOER', 'pending'),
			row('b', '2026-08-03', -729, 'OERESUNDSLINJEN HOER', 'booked')
		]);

		expect(suspects[0].reason).toBe('skulle-blitt-fanget');
	});

	it('peker på ukjent status når én side mangler den', () => {
		const suspects = findResidualDuplicateSuspects([
			row('a', '2026-08-02', -729, 'DKK OERESUNDSLINJEN HOER', 'unknown'),
			row('b', '2026-08-02', -729, 'OERESUNDSLINJEN HOER', 'booked')
		]);

		expect(suspects[0].reason).toBe('ukjent-status');
	});

	it('peker på overføring når én side er merket det', () => {
		const suspects = findResidualDuplicateSuspects([
			row('a', '2026-08-02', -2500, 'Overføring', 'pending', { isInternalTransfer: true }),
			row('b', '2026-08-02', -2500, 'Overføring', 'booked')
		]);

		expect(suspects[0].reason).toBe('overforing');
	});

	it('krever at beskrivelsen peker på samme kjøp', () => {
		// To ekte kjøp på nesten samme beløp samme dag skal IKKE rapporteres.
		const suspects = findResidualDuplicateSuspects([
			row('a', '2026-08-02', -729, 'KIWI BØLERL'),
			row('b', '2026-08-02', -729, 'REMA BØLER')
		]);

		expect(suspects).toHaveLength(0);
	});

	it('krysser ikke kontogrenser', () => {
		const suspects = findResidualDuplicateSuspects([
			row('a', '2026-08-02', -729, 'DKK OERESUNDSLINJEN HOER'),
			{ ...row('b', '2026-08-02', -729, 'OERESUNDSLINJEN HOER'), accountId: 'a2' }
		]);

		expect(suspects).toHaveLength(0);
	});

	it('parrer ikke en utbetaling med et innskudd', () => {
		const suspects = findResidualDuplicateSuspects([
			row('a', '2026-08-02', -729, 'DKK OERESUNDSLINJEN HOER'),
			row('b', '2026-08-02', 729, 'OERESUNDSLINJEN HOER')
		]);

		expect(suspects).toHaveLength(0);
	});

	it('er én-til-én — tre like rader gir ett par, ikke tre', () => {
		const suspects = findResidualDuplicateSuspects([
			row('a', '2026-08-02', -236, 'SEK TYCHO BRAHE'),
			row('b', '2026-08-02', -236, 'TYCHO BRAHE'),
			row('c', '2026-08-02', -236, 'TYCHO BRAHE')
		]);

		expect(suspects).toHaveLength(1);
	});

	it('respekterer datovinduet', () => {
		const suspects = findResidualDuplicateSuspects([
			row('a', '2026-08-02', -729, 'DKK OERESUNDSLINJEN HOER'),
			row('b', '2026-08-20', -729, 'OERESUNDSLINJEN HOER')
		]);

		expect(suspects).toHaveLength(0);
	});

	it('sorterer de største først', () => {
		const suspects = findResidualDuplicateSuspects([
			row('a1', '2026-08-02', -100, 'DKK SMÅ'),
			row('b1', '2026-08-02', -100, 'SMÅ'),
			row('a2', '2026-08-02', -900, 'DKK STOR'),
			row('b2', '2026-08-02', -900, 'STOR')
		]);

		expect(suspects.map((s) => s.amountNok)).toEqual([900, 100]);
	});
});

describe('summarizeSkipReasons', () => {
	it('grupperer par og kroner per årsak', () => {
		const suspects = findResidualDuplicateSuspects([
			row('a1', '2026-08-02', -729, 'DKK OERESUNDSLINJEN', 'booked'),
			row('b1', '2026-08-02', -729, 'OERESUNDSLINJEN', 'booked'),
			row('a2', '2026-08-02', -236, 'SEK TYCHO', 'booked'),
			row('b2', '2026-08-02', -236, 'TYCHO', 'booked')
		]);

		expect(summarizeSkipReasons(suspects)).toEqual([
			{ reason: 'begge-bokfort', pairs: 2, nok: 965 }
		]);
	});

	it('gir tom liste uten mistenkte', () => {
		expect(summarizeSkipReasons([])).toEqual([]);
	});
});
