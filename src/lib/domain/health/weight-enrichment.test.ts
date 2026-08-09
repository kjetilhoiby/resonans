import { describe, it, expect } from 'vitest';
import {
	decideEnrichment,
	planEnrichment,
	ENRICHABLE_FIELDS,
	type IncomingMeasurement,
	type StoredWeightRow
} from './weight-enrichment';

const FULL = {
	weight: 82.4,
	fatRatio: 22.2,
	fatMassKg: 18.3,
	fatFreeMass: 64.1,
	muscleMass: 60.8,
	boneMass: 3.3,
	hydration: 44.2,
	restingHeartRate: 58
};

describe('decideEnrichment', () => {
	it('fyller hullene i en vekt-bare rad', () => {
		const decision = decideEnrichment({ weight: 82.4 }, FULL);
		expect(decision).not.toBeNull();
		expect(decision!.added.sort()).toEqual([...ENRICHABLE_FIELDS].sort());
		expect(decision!.data.fatRatio).toBe(22.2);
		expect(decision!.data.weight).toBe(82.4);
	});

	it('lar raden være når alt allerede finnes', () => {
		expect(decideEnrichment(FULL, FULL)).toBeNull();
	});

	it('overskriver aldri en verdi som finnes', () => {
		// En manuell retting i basen skal ikke spises av neste kjøring.
		const decision = decideEnrichment({ weight: 82.4, fatRatio: 19.0 }, FULL);
		expect(decision!.data.fatRatio).toBe(19.0);
		expect(decision!.added).not.toContain('fatRatio');
	});

	it('fjerner aldri et felt målingen ikke har', () => {
		const decision = decideEnrichment({ weight: 82.4, muscleMass: 60.1 }, { fatRatio: 22.2 });
		expect(decision!.data.muscleMass).toBe(60.1);
	});

	it('lar legacy-feltet fatMass stå når fatRatio legges til', () => {
		// `fatMass` er en PROSENT tross navnet. normalizeBodyComposition
		// foretrekker fatRatio, så den gamle verdien er uskadelig — og å slette
		// den ville brutt «aldri fjerne» uten å vinne noe.
		const decision = decideEnrichment({ weight: 82.4, fatMass: 22.2 }, FULL);
		expect(decision!.data.fatMass).toBe(22.2);
		expect(decision!.data.fatRatio).toBe(22.2);
	});

	it('behandler 0 som fravær, ikke som en måling', () => {
		// Withings har skrevet 0 der sensoren ikke fikk kontakt. Respekterte vi
		// den, ville hullet aldri blitt fylt.
		const decision = decideEnrichment({ weight: 82.4, muscleMass: 0 }, FULL);
		expect(decision!.added).toContain('muscleMass');
		expect(decision!.data.muscleMass).toBe(60.8);
	});

	it('avviser en fettprosent som ikke er menneskelig', () => {
		// 82 i type 6 er en kiloverdi på avveie, ikke en prosent.
		const decision = decideEnrichment({ weight: 82.4 }, { fatRatio: 82, muscleMass: 60.8 });
		expect(decision!.added).toEqual(['muscleMass']);
	});

	it('rører ikke vekta, uansett hva målingen sier', () => {
		// Berikelsen skal utvide en måling, ikke revidere den.
		const decision = decideEnrichment({ weight: 82.4 }, { weight: 99.9, fatRatio: 22.2 });
		expect(decision!.data.weight).toBe(82.4);
	});

	it('tåler en rad uten data i det hele tatt', () => {
		const decision = decideEnrichment(null, FULL);
		expect(decision!.data.fatRatio).toBe(22.2);
	});
});

describe('planEnrichment', () => {
	function row(id: string, ms: number, data: Record<string, unknown> | null): StoredWeightRow {
		return { id, timestampMs: ms, data };
	}
	function meas(ms: number, data: Record<string, unknown>): IncomingMeasurement {
		return { timestampMs: ms, data };
	}

	it('matcher på eksakt tidsstempel', () => {
		const plan = planEnrichment(
			[row('a', 1000, { weight: 82 })],
			[meas(1000, FULL)]
		);
		expect(plan.updates).toHaveLength(1);
		expect(plan.updates[0].id).toBe('a');
	});

	it('teller en måling uten lagret rad som unmatched framfor å gjette', () => {
		const plan = planEnrichment(
			[row('a', 1000, { weight: 82 })],
			[meas(1001, FULL)]
		);
		expect(plan.updates).toHaveLength(0);
		expect(plan.unmatched).toBe(1);
	});

	it('skiller «alt på plass» fra «ingen måling»', () => {
		const plan = planEnrichment(
			[row('a', 1000, FULL), row('b', 2000, { weight: 82 })],
			[meas(1000, FULL)]
		);
		expect(plan.alreadyComplete).toBe(1);
		expect(plan.unvisited).toBe(1);
		expect(plan.updates).toHaveLength(0);
	});

	it('er tom andre gang den kjøres på sitt eget resultat', () => {
		const rows = [row('a', 1000, { weight: 82 })];
		const first = planEnrichment(rows, [meas(1000, FULL)]);
		expect(first.updates).toHaveLength(1);

		const after = [row('a', 1000, first.updates[0].data)];
		const second = planEnrichment(after, [meas(1000, FULL)]);
		expect(second.updates).toHaveLength(0);
		expect(second.alreadyComplete).toBe(1);
	});

	it('teller hvert felt som ble fylt inn', () => {
		const plan = planEnrichment(
			[row('a', 1000, { weight: 82 }), row('b', 2000, { weight: 81 })],
			[meas(1000, { fatRatio: 22.2 }), meas(2000, { fatRatio: 21.8, muscleMass: 60 })]
		);
		expect(plan.fieldCounts.fatRatio).toBe(2);
		expect(plan.fieldCounts.muscleMass).toBe(1);
	});

	it('gir en tom plan uten målinger', () => {
		const plan = planEnrichment([row('a', 1000, { weight: 82 })], []);
		expect(plan.updates).toHaveLength(0);
		expect(plan.unvisited).toBe(1);
	});
});
