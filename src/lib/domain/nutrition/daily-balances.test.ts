import { describe, it, expect } from 'vitest';
import { buildDailyBalances } from './daily-balances';
import type { LoggedEntry } from './day-summary';

function entry(timestamp: string, kcal: number): LoggedEntry {
	return {
		id: `e-${timestamp}-${kcal}`,
		timestamp,
		label: 'mat',
		macros: { kcal, proteinG: 20, carbsG: 30, fatG: 10 },
		confidence: 0.8,
		imageUrl: null,
		mealSlot: null,
		mealSlotSource: null
	};
}

const TODAY = '2026-08-07';

describe('buildDailyBalances', () => {
	it('regner balanse per dag fra inntak og forbruk', () => {
		const balances = buildDailyBalances({
			entries: [entry('2026-08-05T10:00:00Z', 1800), entry('2026-08-06T10:00:00Z', 2000)],
			targets: {},
			expenditureByDate: { '2026-08-05': 2500, '2026-08-06': 2400 },
			today: TODAY
		});

		expect(balances).toHaveLength(2);
		// Underskudd på 700 og 400 — negativt balansetall.
		expect(balances.find((b) => b.date === '2026-08-05')?.balanceKcal).toBe(-700);
		expect(balances.find((b) => b.date === '2026-08-06')?.balanceKcal).toBe(-400);
	});

	/**
	 * Den viktige: en dag uten aktivitetsrad er en dag vi ikke vet noe om. Ble den 0,
	 * ville hele inntaket blitt et overskudd, og vektkontrollen fått en fantomdag som
	 * trekker `impliedDailyErrorKcal` i grøfta.
	 */
	it('dropper dager uten forbrukstall framfor å regne dem som 0', () => {
		const balances = buildDailyBalances({
			entries: [entry('2026-08-05T10:00:00Z', 1800), entry('2026-08-06T10:00:00Z', 2000)],
			targets: {},
			expenditureByDate: { '2026-08-05': 2500 },
			today: TODAY
		});

		expect(balances.map((b) => b.date)).toEqual(['2026-08-05']);
	});

	it('gir tom liste uten forbrukstall i det hele tatt', () => {
		const balances = buildDailyBalances({
			entries: [entry('2026-08-05T10:00:00Z', 1800)],
			targets: {},
			expenditureByDate: {},
			today: TODAY
		});
		expect(balances).toEqual([]);
	});

	it('tåler en tom logg', () => {
		expect(
			buildDailyBalances({
				entries: [],
				targets: {},
				expenditureByDate: { '2026-08-05': 2500 },
				today: TODAY
			})
		).toEqual([]);
	});

	/**
	 * I dag er den ene dagen som fortsatt vokser. Merkes alle dagene som delvise,
	 * mister historiske dager underskuddsbegrepet sitt; merkes ingen, påstår vi at
	 * dagens halve inntak er et helt døgns underskudd.
	 */
	it('merker bare i dag som delvis', () => {
		const both = buildDailyBalances({
			entries: [entry('2026-08-06T10:00:00Z', 1000), entry(`${TODAY}T08:00:00Z`, 1000)],
			targets: {},
			expenditureByDate: { '2026-08-06': 2500, [TODAY]: 2500 },
			today: TODAY
		});

		// Begge dagene får et tall — forskjellen ligger i hvordan de skal LESES, og
		// den bæres av partialDay inn i computeEnergyBalance.
		expect(both.map((b) => b.date).sort()).toEqual(['2026-08-06', TODAY]);
	});

	it('summerer flere måltider på samme dag', () => {
		const balances = buildDailyBalances({
			entries: [entry('2026-08-05T08:00:00Z', 600), entry('2026-08-05T18:00:00Z', 900)],
			targets: {},
			expenditureByDate: { '2026-08-05': 2500 },
			today: TODAY
		});

		expect(balances).toHaveLength(1);
		expect(balances[0].balanceKcal).toBe(-1000);
	});
});
