import { describe, it, expect } from 'vitest';
import {
	RECON_TOLERANCE_NOK,
	reconcileBalances,
	significantDiffTotal,
	type BalanceAnchor,
	type ReconTx
} from './balance-reconciliation';

const anchors: BalanceAnchor[] = [
	{ date: '2026-06-30', balance: 10_000 },
	{ date: '2026-07-31', balance: 12_000 }
];

describe('reconcileBalances — grunntilfellet', () => {
	it('stemmer når transaksjonene forklarer saldoendringen', () => {
		const txs: ReconTx[] = [
			{ date: '2026-07-05', amount: 5000 },
			{ date: '2026-07-20', amount: -3000 }
		];

		const [interval] = reconcileBalances(anchors, txs);

		expect(interval.balanceChange).toBe(2000);
		expect(interval.transactionSum).toBe(2000);
		expect(interval.diff).toBe(0);
		expect(interval.significant).toBe(false);
		expect(interval.txCount).toBe(2);
	});

	// Prod-tilfellet i miniatyr: én overføring på 27 000 bokført tre ganger.
	it('avslører at vi teller for mye', () => {
		const txs: ReconTx[] = [
			{ date: '2026-07-23', amount: 27_000 },
			{ date: '2026-07-23', amount: 27_000 },
			{ date: '2026-07-23', amount: 27_000 },
			{ date: '2026-07-24', amount: -25_000 }
		];

		const [interval] = reconcileBalances(anchors, txs);

		// Kontoen fikk 2 000; vi har bokført 56 000.
		expect(interval.balanceChange).toBe(2000);
		expect(interval.transactionSum).toBe(56_000);
		expect(interval.diff).toBe(54_000);
		expect(interval.significant).toBe(true);
	});

	it('avslører også at vi teller for lite', () => {
		const [interval] = reconcileBalances(anchors, [{ date: '2026-07-05', amount: 500 }]);
		expect(interval.diff).toBe(-1500);
		expect(interval.significant).toBe(true);
	});
});

describe('reconcileBalances — grensetilfellene den ikke later som den vet', () => {
	// En saldo observert 31. juli kommer før et kjøp senere samme dag, men canonical_date har
	// bare dagsoppløsning. Da skal avviket ikke kalles et funn.
	it('teller ankerdagene for seg og demper signifikans', () => {
		const txs: ReconTx[] = [
			{ date: '2026-07-31', amount: 3000 } // på sluttankeret
		];

		const [interval] = reconcileBalances(anchors, txs);

		expect(interval.boundaryAmount).toBe(3000);
		// Sluttdagen tas MED i summen — dagen er som regel omme når saldoen observeres — men
		// den telles i `boundaryAmount`, så usikkerheten demper signifikansen.
		expect(interval.transactionSum).toBe(3000);
		expect(interval.diff).toBe(1000);
		// |1000| < 3000 + toleranse → grensetilfellet forklarer avviket.
		expect(interval.significant).toBe(false);
	});

	it('utelater transaksjoner PÅ startankeret fra summen', () => {
		const txs: ReconTx[] = [
			{ date: '2026-06-30', amount: 9999 }, // startankeret — allerede i fromBalance
			{ date: '2026-07-05', amount: 2000 }
		];

		const [interval] = reconcileBalances(anchors, txs);

		expect(interval.transactionSum).toBe(2000);
		expect(interval.diff).toBe(0);
	});

	it('lar små avvik stå — renter og gebyrer bokføres ikke alltid', () => {
		const [interval] = reconcileBalances(anchors, [
			{ date: '2026-07-05', amount: 2000 + RECON_TOLERANCE_NOK - 1 }
		]);
		expect(interval.significant).toBe(false);
	});
});

describe('reconcileBalances — intervallene', () => {
	// Overlappende intervaller ville tellt samme transaksjon flere ganger — samme
	// mange-til-mange-feil som har truffet dette domenet to ganger før.
	it('bruker PÅFØLGENDE par, aldri overlappende', () => {
		const three: BalanceAnchor[] = [
			{ date: '2026-06-30', balance: 0 },
			{ date: '2026-07-31', balance: 100 },
			{ date: '2026-08-31', balance: 300 }
		];
		const txs: ReconTx[] = [
			{ date: '2026-07-10', amount: 100 },
			{ date: '2026-08-10', amount: 200 }
		];

		const intervals = reconcileBalances(three, txs);

		expect(intervals).toHaveLength(2);
		expect(intervals[0]).toMatchObject({ transactionSum: 100, diff: 0 });
		expect(intervals[1]).toMatchObject({ transactionSum: 200, diff: 0 });
	});

	it('sorterer ankerne selv', () => {
		const reversed = [...anchors].reverse();
		expect(reconcileBalances(reversed, [{ date: '2026-07-05', amount: 2000 }])[0].diff).toBe(0);
	});

	it('beholder siste observasjon per dag', () => {
		const sameDay: BalanceAnchor[] = [
			{ date: '2026-06-30', balance: 999 },
			{ date: '2026-06-30', balance: 10_000 },
			{ date: '2026-07-31', balance: 12_000 }
		];

		const intervals = reconcileBalances(sameDay, [{ date: '2026-07-05', amount: 2000 }]);

		expect(intervals).toHaveLength(1);
		expect(intervals[0].fromBalance).toBe(10_000);
	});

	it('gir ingen intervaller med færre enn to ankere', () => {
		expect(reconcileBalances([anchors[0]], [])).toEqual([]);
		expect(reconcileBalances([], [])).toEqual([]);
	});

	it('ignorerer ugyldige ankere', () => {
		const messy: BalanceAnchor[] = [
			{ date: 'tull', balance: 5 },
			{ date: '2026-06-30', balance: Number.NaN },
			{ date: '2026-06-30', balance: 10_000 },
			{ date: '2026-07-31', balance: 12_000 }
		];
		expect(reconcileBalances(messy, [])).toHaveLength(1);
	});
});

describe('significantDiffTotal', () => {
	it('summerer bare de reelle avvikene', () => {
		const intervals = reconcileBalances(
			[
				{ date: '2026-06-30', balance: 0 },
				{ date: '2026-07-31', balance: 0 },
				{ date: '2026-08-31', balance: 0 }
			],
			[
				{ date: '2026-07-10', amount: 10_000 }, // reelt avvik
				{ date: '2026-08-10', amount: 10 } // under toleransen
			]
		);

		expect(significantDiffTotal(intervals)).toBe(10_000);
	});

	it('er 0 uten intervaller', () => {
		expect(significantDiffTotal([])).toBe(0);
	});
});
