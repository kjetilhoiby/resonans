import { describe, it, expect } from 'vitest';
import {
	agreementRatio,
	AGREEMENT_TRUSTWORTHY,
	duplicateGroups,
	excessInRange,
	type ExcessTx
} from './duplicate-excess';

describe('duplicateGroups', () => {
	// Prod-signaturen: samme overføring bokført tre ganger.
	it('regner overskuddet som (n − 1) × beløp', () => {
		const txs: ExcessTx[] = [
			{ date: '2026-07-27', amount: 23_000 },
			{ date: '2026-07-27', amount: 23_000 },
			{ date: '2026-07-27', amount: 23_000 }
		];

		expect(duplicateGroups(txs)).toEqual([
			{ date: '2026-07-27', amount: 23_000, count: 3, excess: 46_000 }
		]);
	});

	it('beholder fortegnet i overskuddet', () => {
		const [group] = duplicateGroups([
			{ date: '2026-07-23', amount: -27_000 },
			{ date: '2026-07-23', amount: -27_000 }
		]);
		expect(group.excess).toBe(-27_000);
	});

	// Et uttak på 500 og et innskudd på 500 samme dag er en overføring mellom egne kontoer,
	// ikke to versjoner av det samme.
	it('grupperer ikke på tvers av fortegn', () => {
		expect(
			duplicateGroups([
				{ date: '2026-07-27', amount: 500 },
				{ date: '2026-07-27', amount: -500 }
			])
		).toEqual([]);
	});

	it('utelater grupper med bare én rad', () => {
		expect(duplicateGroups([{ date: '2026-07-27', amount: 100 }])).toEqual([]);
	});

	// 1 703,50 og 1 703,49 er ikke samme transaksjon — den driften hører til en annen motor.
	it('skiller på øre', () => {
		expect(
			duplicateGroups([
				{ date: '2026-08-11', amount: -1703.5 },
				{ date: '2026-08-11', amount: -1703.49 }
			])
		).toEqual([]);
	});

	it('skiller på dato', () => {
		expect(
			duplicateGroups([
				{ date: '2026-07-27', amount: 100 },
				{ date: '2026-07-28', amount: 100 }
			])
		).toEqual([]);
	});

	it('sorterer størst overskudd først', () => {
		const groups = duplicateGroups([
			{ date: '2026-07-01', amount: 100 },
			{ date: '2026-07-01', amount: 100 },
			{ date: '2026-07-02', amount: 9000 },
			{ date: '2026-07-02', amount: 9000 }
		]);
		expect(groups.map((g) => g.excess)).toEqual([9000, 100]);
	});

	it('ignorerer søppel og nullbeløp', () => {
		expect(
			duplicateGroups([
				{ date: 'tull', amount: 100 },
				{ date: 'tull', amount: 100 },
				{ date: '2026-07-01', amount: 0 },
				{ date: '2026-07-01', amount: 0 }
			])
		).toEqual([]);
	});
});

describe('excessInRange', () => {
	const groups = duplicateGroups([
		{ date: '2026-06-30', amount: 1000 },
		{ date: '2026-06-30', amount: 1000 },
		{ date: '2026-07-15', amount: 2000 },
		{ date: '2026-07-15', amount: 2000 },
		{ date: '2026-07-31', amount: 4000 },
		{ date: '2026-07-31', amount: 4000 }
	]);

	// Samme vindusregel som avstemmingen: startdagen ute, sluttdagen inne. Ellers sammenlignes
	// to ulike perioder og avviket betyr ingenting.
	it('utelater startdagen og inkluderer sluttdagen', () => {
		expect(excessInRange(groups, '2026-06-30', '2026-07-31')).toBe(6000);
	});

	it('er 0 for en periode uten grupper', () => {
		expect(excessInRange(groups, '2026-08-01', '2026-08-31')).toBe(0);
	});
});

describe('agreementRatio — kontrollen av saldotallene', () => {
	// Enighet: to beregninger som ikke deler en eneste inngang kan ikke bli enige ved uhell.
	it('gir 1 når overskuddet forklarer avviket presist', () => {
		expect(agreementRatio(46_000, 46_000)).toBe(1);
	});

	it('er høy nok til å stole på ved små sprik', () => {
		const ratio = agreementRatio(46_000, 45_000)!;
		expect(ratio).toBeGreaterThan(AGREEMENT_TRUSTWORTHY);
	});

	it('er lav når duplikatene bare forklarer en brøkdel', () => {
		expect(agreementRatio(100_000, 10_000)).toBeLessThan(AGREEMENT_TRUSTWORTHY);
	});

	// Over 1 betyr at overskuddet forklarer MER enn avviket — da ville en dedup gått for langt,
	// så avstanden fra 1 teller i begge retninger.
	it('straffer overforklaring like mye som underforklaring', () => {
		expect(agreementRatio(10_000, 20_000)).toBe(agreementRatio(20_000, 10_000));
	});

	it('gir 0 når de peker i hver sin retning', () => {
		expect(agreementRatio(46_000, -46_000)).toBe(0);
	});

	// Uten dette ville et avvik på 0,40 kr og et overskudd på 0,10 kr gitt et forholdstall som
	// ser presist ut og bare måler støy.
	it('gir null når det ikke er noe å forklare', () => {
		expect(agreementRatio(0, 0)).toBeNull();
		expect(agreementRatio(0.4, 0.1)).toBeNull();
	});
});
