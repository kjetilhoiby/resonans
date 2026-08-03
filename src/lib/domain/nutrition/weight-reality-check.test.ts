import { describe, it, expect } from 'vitest';
import {
	checkAgainstWeight,
	MIN_DAYS_FOR_VERDICT,
	NOISE_FLOOR_KCAL_PER_DAY
} from './weight-reality-check';

/** Balanser med samme verdi hver dag, fra en startdato. */
function balances(from: string, days: number, balanceKcal: number) {
	const start = Date.parse(`${from}T00:00:00Z`);
	return Array.from({ length: days }, (_, i) => ({
		date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
		balanceKcal
	}));
}

describe('checkAgainstWeight', () => {
	it('avslører at et stort underskudd ikke ga vektnedgang', () => {
		// Brukerens innvending, satt i tall: 1 300 kcal underskudd i 21 dager er
		// 27 300 kcal, altså 3,5 kg. Vekta står stille.
		const check = checkAgainstWeight({
			balances: balances('2026-07-14', 21, -1300),
			weights: [
				{ date: '2026-07-14', kg: 88 },
				{ date: '2026-08-03', kg: 88 }
			]
		})!;
		expect(check.predictedKg).toBeCloseTo(-3.55, 1);
		expect(check.observedKg).toBe(0);
		// Feilen er hele underskuddet: ~1 300 kcal per dag.
		expect(check.impliedDailyErrorKcal).toBeGreaterThan(1200);
		expect(check.conclusive).toBe(true);
		expect(check.balanceIsOff).toBe(true);
	});

	it('bekrefter et regnestykke som stemmer', () => {
		// 500 kcal underskudd i 28 dager = 14 000 kcal ≈ 1,8 kg. Og vekta falt 1,8.
		const check = checkAgainstWeight({
			balances: balances('2026-07-06', 28, -500),
			weights: [
				{ date: '2026-07-06', kg: 88 },
				{ date: '2026-08-03', kg: 86.2 }
			]
		})!;
		expect(check.impliedDailyErrorKcal).toBeLessThan(NOISE_FLOOR_KCAL_PER_DAY);
		expect(check.balanceIsOff).toBe(false);
	});

	it('holder tilbake dommen på for kort horisont', () => {
		// Under to uker er vektendring mest vann. Tallene regnes, men konklusjonen
		// holdes tilbake.
		const check = checkAgainstWeight({
			balances: balances('2026-08-01', 3, -1300),
			weights: [
				{ date: '2026-08-01', kg: 88 },
				{ date: '2026-08-03', kg: 88 }
			]
		})!;
		expect(check.days).toBe(3);
		expect(check.conclusive).toBe(false);
		expect(check.balanceIsOff).toBe(false);
		expect(check.impliedDailyErrorKcal).toBeGreaterThan(0);
	});

	it('treffer horisontgrensa', () => {
		const long = checkAgainstWeight({
			balances: balances('2026-07-01', MIN_DAYS_FOR_VERDICT + 1, -1000),
			weights: [
				{ date: '2026-07-01', kg: 88 },
				{
					date: new Date(Date.parse('2026-07-01T00:00:00Z') + MIN_DAYS_FOR_VERDICT * 86_400_000)
						.toISOString()
						.slice(0, 10),
					kg: 88
				}
			]
		})!;
		expect(long.conclusive).toBe(true);
	});

	it('regner feilen per loggede dag, ikke per kalenderdag', () => {
		// Fem loggede dager i et 20-dagers vindu: avviket hører til de fem.
		const check = checkAgainstWeight({
			balances: balances('2026-07-14', 5, -1000),
			weights: [
				{ date: '2026-07-14', kg: 88 },
				{ date: '2026-08-03', kg: 88 }
			]
		})!;
		expect(check.days).toBe(5);
		expect(check.impliedDailyErrorKcal).toBe(1000);
	});

	it('ser bort fra balanser utenfor vektvinduet', () => {
		const check = checkAgainstWeight({
			balances: [
				{ date: '2026-06-01', balanceKcal: -5000 },
				...balances('2026-07-14', 3, -1000)
			],
			weights: [
				{ date: '2026-07-14', kg: 88 },
				{ date: '2026-08-03', kg: 88 }
			]
		})!;
		expect(check.days).toBe(3);
	});

	it('godtar en vektøkning', () => {
		const check = checkAgainstWeight({
			balances: balances('2026-07-01', 30, 300),
			weights: [
				{ date: '2026-07-01', kg: 86 },
				{ date: '2026-07-31', kg: 87.2 }
			]
		})!;
		expect(check.predictedKg).toBeGreaterThan(0);
		expect(check.observedKg).toBe(1.2);
	});

	it('gir null uten nok å regne på', () => {
		expect(checkAgainstWeight({ balances: [], weights: [] })).toBeNull();
		expect(
			checkAgainstWeight({
				balances: balances('2026-08-01', 3, -500),
				weights: [{ date: '2026-08-01', kg: 88 }]
			})
		).toBeNull();
		// Samme dato på begge målingene gir ingen horisont.
		expect(
			checkAgainstWeight({
				balances: balances('2026-08-01', 1, -500),
				weights: [
					{ date: '2026-08-01', kg: 88 },
					{ date: '2026-08-01', kg: 88.2 }
				]
			})
		).toBeNull();
	});
});
