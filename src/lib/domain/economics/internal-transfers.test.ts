import { describe, it, expect } from 'vitest';
import {
	findInternalTransfers,
	internalTransfersForAccount,
	type TransferCandidate
} from './internal-transfers';

function tx(id: string, accountId: string, date: string, amount: number): TransferCandidate {
	return { id, accountId, date, amount };
}

describe('findInternalTransfers', () => {
	it('parrer et uttak med innskuddet på en annen konto samme dag', () => {
		const result = findInternalTransfers([
			tx('a', 'bruks', '2026-08-01', -5000),
			tx('b', 'spare', '2026-08-01', 5000)
		]);

		expect(result.links).toHaveLength(1);
		expect(result.links[0]).toMatchObject({
			outId: 'a',
			inId: 'b',
			outAccountId: 'bruks',
			inAccountId: 'spare',
			amount: 5000
		});
		expect(result.internalIds).toEqual(new Set(['a', 'b']));
		expect(result.counterAccountById.get('a')).toBe('spare');
		expect(result.counterAccountById.get('b')).toBe('bruks');
	});

	it('lar ekte kjøp være i fred', () => {
		const result = findInternalTransfers([
			tx('a', 'bruks', '2026-08-01', -417.15),
			tx('b', 'bruks', '2026-08-01', -923.96)
		]);

		expect(result.links).toHaveLength(0);
		expect(result.internalIds.size).toBe(0);
	});

	it('matcher ikke på tvers av datoer', () => {
		const result = findInternalTransfers([
			tx('a', 'bruks', '2026-08-01', -5000),
			tx('b', 'spare', '2026-08-02', 5000)
		]);

		expect(result.links).toHaveLength(0);
	});

	it('matcher ikke innenfor samme konto', () => {
		// Å få og gi samme beløp samme dag på én konto er to reelle transaksjoner.
		const result = findInternalTransfers([
			tx('a', 'bruks', '2026-08-01', -5000),
			tx('b', 'bruks', '2026-08-01', 5000)
		]);

		expect(result.links).toHaveLength(0);
	});

	it('er én-til-én: tre like uttak spiser ikke det samme innskuddet', () => {
		// Uten én-til-én ville summen blitt 15 000 der den er 5 000, og målingen
		// ville overdrevet hvor mye av «forbruket» som er flytting.
		const result = findInternalTransfers([
			tx('ut1', 'bruks', '2026-08-01', -500),
			tx('ut2', 'bruks', '2026-08-01', -500),
			tx('ut3', 'bruks', '2026-08-01', -500),
			tx('inn', 'spare', '2026-08-01', 500)
		]);

		expect(result.links).toHaveLength(1);
		expect(result.internalIds.size).toBe(2);
	});

	it('parrer flere overføringer samme dag når det finnes motparter til alle', () => {
		const result = findInternalTransfers([
			tx('ut1', 'bruks', '2026-08-01', -500),
			tx('ut2', 'bruks', '2026-08-01', -500),
			tx('inn1', 'spare', '2026-08-01', 500),
			tx('inn2', 'bsu', '2026-08-01', 500)
		]);

		expect(result.links).toHaveLength(2);
		expect(result.internalIds.size).toBe(4);
	});

	it('tåler ørebeløp uten flyttallsfeil', () => {
		const result = findInternalTransfers([
			tx('a', 'bruks', '2026-08-01', -0.3),
			tx('b', 'spare', '2026-08-01', 0.1 + 0.2)
		]);

		expect(result.links).toHaveLength(1);
	});

	it('gir samme resultat uansett rekkefølge inn', () => {
		const rows = [
			tx('ut1', 'bruks', '2026-08-01', -500),
			tx('ut2', 'bruks', '2026-08-01', -500),
			tx('inn1', 'spare', '2026-08-01', 500)
		];

		const forward = findInternalTransfers(rows);
		const reversed = findInternalTransfers([...rows].reverse());

		expect(forward.links).toEqual(reversed.links);
	});
});

describe('internalTransfersForAccount', () => {
	const result = findInternalTransfers([
		// To påfyllinger av sparekontoen
		tx('inn-ut1', 'bruks', '2026-08-01', -5000),
		tx('inn-inn1', 'spare', '2026-08-01', 5000),
		tx('inn-ut2', 'bruks', '2026-07-01', -5000),
		tx('inn-inn2', 'spare', '2026-07-01', 5000),
		// Ett uttak FRA sparekontoen
		tx('ut-ut', 'spare', '2026-08-26', -2000),
		tx('ut-inn', 'bruks', '2026-08-26', 2000)
	]);

	it('skiller uttak fra påfylling sett fra sparekontoen', () => {
		const spare = internalTransfersForAccount(result, 'spare');

		expect(spare.deposits).toHaveLength(2);
		expect(spare.withdrawals).toHaveLength(1);
		expect(spare.net).toBe(8000);
	});

	it('gir speilvendt bilde fra brukskontoen', () => {
		const bruks = internalTransfersForAccount(result, 'bruks');

		expect(bruks.withdrawals).toHaveLength(2);
		expect(bruks.deposits).toHaveLength(1);
		expect(bruks.net).toBe(-8000);
	});

	it('teller frekvens, ikke bare sum — ett stort uttak er ikke tolv små', () => {
		const oneBig = findInternalTransfers([
			tx('a', 'spare', '2026-08-05', -12000),
			tx('b', 'bruks', '2026-08-05', 12000)
		]);
		const manySmall = findInternalTransfers(
			Array.from({ length: 12 }, (_, i) => [
				tx(`ut${i}`, 'spare', `2026-08-${String(i + 1).padStart(2, '0')}`, -1000),
				tx(`inn${i}`, 'bruks', `2026-08-${String(i + 1).padStart(2, '0')}`, 1000)
			]).flat()
		);

		const big = internalTransfersForAccount(oneBig, 'spare');
		const small = internalTransfersForAccount(manySmall, 'spare');

		expect(big.net).toBe(small.net);
		expect(big.withdrawals).toHaveLength(1);
		expect(small.withdrawals).toHaveLength(12);
	});
});
