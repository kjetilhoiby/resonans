import { describe, it, expect } from 'vitest';
import {
	buildPaydayComparison,
	daysBetweenKeys,
	isMonotonicComparison,
	type ComparisonTx
} from './payday-comparison';

function tx(date: string, amount: number, isGrocery = false): ComparisonTx {
	return { date, amount, isGrocery };
}

describe('daysBetweenKeys', () => {
	it('teller hele dager', () => {
		expect(daysBetweenKeys('2026-08-01', '2026-08-01')).toBe(0);
		expect(daysBetweenKeys('2026-08-01', '2026-08-31')).toBe(30);
	});

	// Midt på dagen, så en sommertidsovergang ikke gir ±1.
	it('tåler sommertidsovergangen', () => {
		expect(daysBetweenKeys('2026-03-28', '2026-03-30')).toBe(2);
		expect(daysBetweenKeys('2026-10-24', '2026-10-26')).toBe(2);
	});
});

describe('buildPaydayComparison — invarianten', () => {
	// DETTE er feilen brukeren fant. Tre korte perioder med høyt forbruk og én lang med lavt:
	// snittet over en krympende populasjon falt idet de tre korte tok slutt.
	it('synker ALDRI når periodene har ulik lengde', () => {
		const spend: ComparisonTx[] = [
			// Tre perioder på 10 dager, 1 000 kr på dag 1 i hver
			tx('2026-05-01', 1000),
			tx('2026-05-11', 1000),
			tx('2026-05-21', 1000),
			// Én periode på 30 dager, 100 kr på dag 1
			tx('2026-05-31', 100)
		];
		const paydayKeys = [
			'2026-06-30', // inneværende start (grense for den lange perioden)
			'2026-05-31', // 30 dager
			'2026-05-21', // 10 dager
			'2026-05-11', // 10 dager
			'2026-05-01' // 10 dager
		];

		const result = buildPaydayComparison(spend, paydayKeys);

		expect(result.periodsUsed).toBe(4);
		expect(isMonotonicComparison(result.points)).toBe(true);
		// Kappet ved den korteste perioden — det er det som holder populasjonen konstant.
		expect(result.comparisonDays).toBe(10);
		expect(result.points).toHaveLength(10);
	});

	it('rapporterer periodelengdene, så en slått sammen periode er synlig', () => {
		const paydayKeys = ['2026-08-01', '2026-07-01', '2026-05-01', '2026-04-01'];
		const result = buildPaydayComparison([], paydayKeys);

		expect(result.periodLengths).toEqual([31, 61, 30]);
		// 61 dager er to perioder slått sammen — en lønnsdato som ikke ble kjent igjen.
		expect(result.longestPeriodDays).toBe(61);
		expect(result.comparisonDays).toBe(30);
	});

	// Generativ sjekk: uansett hvordan utleggene fordeler seg, skal kurven ikke synke.
	it('er monoton for vilkårlige utlegg over ulike periodelengder', () => {
		const paydayKeys = ['2026-07-20', '2026-06-20', '2026-06-01', '2026-05-02', '2026-04-01'];
		const spend: ComparisonTx[] = [];
		for (let day = 0; day < 110; day += 1) {
			const d = new Date(Date.UTC(2026, 3, 1) + day * 86400000).toISOString().slice(0, 10);
			// Varierende beløp, inkludert dager uten utlegg.
			if (day % 3 !== 0) spend.push(tx(d, ((day * 137) % 900) + 50, day % 5 === 0));
		}

		const result = buildPaydayComparison(spend, paydayKeys);

		expect(result.points.length).toBeGreaterThan(0);
		expect(isMonotonicComparison(result.points)).toBe(true);
	});
});

describe('buildPaydayComparison — snittet', () => {
	it('deler på antall perioder, ikke på antall utlegg', () => {
		const spend = [tx('2026-06-01', 300), tx('2026-07-01', 100)];
		const paydayKeys = ['2026-08-01', '2026-07-01', '2026-06-01'];

		const result = buildPaydayComparison(spend, paydayKeys);

		expect(result.periodsUsed).toBe(2);
		// Dag 1: (100 + 300) / 2 = 200
		expect(result.points[0].total).toBe(200);
	});

	it('skiller dagligvarer fra totalen', () => {
		const spend = [tx('2026-06-01', 300, true), tx('2026-06-02', 200, false)];
		const paydayKeys = ['2026-07-01', '2026-06-01'];

		const result = buildPaydayComparison(spend, paydayKeys);

		expect(result.points[0]).toMatchObject({ day: 1, total: 300, grocery: 300 });
		expect(result.points[1]).toMatchObject({ day: 2, total: 500, grocery: 300 });
	});

	it('bærer forrige verdi videre på dager uten utlegg', () => {
		const spend = [tx('2026-06-01', 500)];
		const paydayKeys = ['2026-06-04', '2026-06-01'];

		const result = buildPaydayComparison(spend, paydayKeys);

		expect(result.points.map((p) => p.total)).toEqual([500, 500, 500]);
	});

	it('holder utlegg utenfor perioden ute', () => {
		const spend = [
			tx('2026-05-31', 9999), // før
			tx('2026-06-01', 100),
			tx('2026-06-04', 9999) // på grensen = neste periode
		];
		const paydayKeys = ['2026-06-04', '2026-06-01'];

		const result = buildPaydayComparison(spend, paydayKeys);

		expect(result.points.at(-1)?.total).toBe(100);
	});

	it('bruker absoluttverdi, så fortegnskonvensjonen ikke kan velte kurven', () => {
		const a = buildPaydayComparison([tx('2026-06-01', -250)], ['2026-06-03', '2026-06-01']);
		const b = buildPaydayComparison([tx('2026-06-01', 250)], ['2026-06-03', '2026-06-01']);
		expect(a.points).toEqual(b.points);
	});
});

describe('buildPaydayComparison — tomme og degenererte tilfeller', () => {
	it('gir tom serie uten en hel tidligere periode', () => {
		expect(buildPaydayComparison([], ['2026-08-01'])).toMatchObject({
			points: [],
			periodsUsed: 0,
			comparisonDays: 0
		});
		expect(buildPaydayComparison([], [])).toMatchObject({ points: [], periodsUsed: 0 });
	});

	it('hopper over en periode med ugyldig lengde', () => {
		// To lønnsdatoer på samme dag gir lengde 0 — den kan ikke inngå.
		const result = buildPaydayComparison([], ['2026-07-01', '2026-07-01', '2026-06-01']);
		expect(result.periodsUsed).toBe(1);
		expect(result.periodLengths).toEqual([30]);
	});

	it('respekterer maxPeriods', () => {
		const keys = ['2026-08-01', '2026-07-01', '2026-06-01', '2026-05-01', '2026-04-01', '2026-03-01'];
		expect(buildPaydayComparison([], keys, { maxPeriods: 2 }).periodsUsed).toBe(2);
		expect(buildPaydayComparison([], keys).periodsUsed).toBe(4);
	});
});

describe('isMonotonicComparison', () => {
	it('kjenner igjen et fall', () => {
		expect(
			isMonotonicComparison([
				{ day: 1, total: 100, grocery: 0 },
				{ day: 2, total: 50, grocery: 0 }
			])
		).toBe(false);
	});

	it('ser også på dagligvarekurven', () => {
		expect(
			isMonotonicComparison([
				{ day: 1, total: 100, grocery: 100 },
				{ day: 2, total: 200, grocery: 40 }
			])
		).toBe(false);
	});

	it('tåler flyttallsstøy fra divisjonen', () => {
		expect(
			isMonotonicComparison([
				{ day: 1, total: 100, grocery: 0 },
				{ day: 2, total: 99.9999999, grocery: 0 }
			])
		).toBe(true);
	});

	it('er sann for tom og ettpunkts serie', () => {
		expect(isMonotonicComparison([])).toBe(true);
		expect(isMonotonicComparison([{ day: 1, total: 5, grocery: 5 }])).toBe(true);
	});
});
