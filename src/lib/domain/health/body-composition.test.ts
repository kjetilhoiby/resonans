import { describe, it, expect } from 'vitest';
import {
	describeCompositionChange,
	normalizeBodyComposition,
	type BodyComposition
} from './body-composition';

describe('normalizeBodyComposition', () => {
	it('bruker målt fettmasse i kg når den finnes', () => {
		const result = normalizeBodyComposition({ weightKg: 82, fatMassKg: 18.2, fatRatio: 22.2 });
		expect(result.fatMassKg).toBe(18.2);
		expect(result.fatMassSource).toBe('measured');
		expect(result.fatRatio).toBe(22.2);
	});

	it('regner kilo fra prosent når kiloverdien mangler', () => {
		// 82 kg × 22 % = 18,04 kg
		const result = normalizeBodyComposition({ weightKg: 82, fatRatio: 22 });
		expect(result.fatMassKg).toBe(18);
		expect(result.fatMassSource).toBe('derived');
	});

	it('retter legacy-feilen: data.fatMass var en PROSENT', () => {
		// Dette er buggen. Type 6 er fettprosent, men ble lagret som «fatMass» og
		// lest som kg — 22 i stedet for 18 for en person på 82 kg.
		const result = normalizeBodyComposition({ weightKg: 82, legacyFatMass: 22 });
		expect(result.fatRatio).toBe(22);
		expect(result.fatMassKg).toBe(18);
		expect(result.fatMassSource).toBe('derived');
	});

	it('lar målt kilo vinne over legacy-prosenten', () => {
		const result = normalizeBodyComposition({ weightKg: 82, fatMassKg: 18.2, legacyFatMass: 22 });
		expect(result.fatMassKg).toBe(18.2);
		expect(result.fatMassSource).toBe('measured');
	});

	it('avviser en «prosent» som ikke kan være en prosent', () => {
		// Er verdien 80, er den ikke en fettprosent. Da regner vi ingenting.
		const result = normalizeBodyComposition({ weightKg: 82, legacyFatMass: 80 });
		expect(result.fatRatio).toBeNull();
		expect(result.fatMassKg).toBeNull();
	});

	it('kan ikke regne kilo uten vekt', () => {
		const result = normalizeBodyComposition({ fatRatio: 22 });
		expect(result.fatRatio).toBe(22);
		expect(result.fatMassKg).toBeNull();
		expect(result.fatMassSource).toBeNull();
	});

	it('tar muskelmasse rett fra type 76 — den var alltid i kg', () => {
		expect(normalizeBodyComposition({ muscleMassKg: 61.44 }).muscleMassKg).toBe(61.4);
	});

	it('utleder fettfri masse fra vekt minus fett', () => {
		const result = normalizeBodyComposition({ weightKg: 82, fatMassKg: 18 });
		expect(result.fatFreeMassKg).toBe(64);
	});

	it('foretrekker målt fettfri masse over den utledede', () => {
		const result = normalizeBodyComposition({ weightKg: 82, fatMassKg: 18, fatFreeMassKg: 63.5 });
		expect(result.fatFreeMassKg).toBe(63.5);
	});

	it('tar med beinmasse og hydrering', () => {
		const result = normalizeBodyComposition({ boneMassKg: 3.42, hydrationKg: 44.8 });
		expect(result.boneMassKg).toBe(3.4);
		expect(result.hydrationKg).toBe(44.8);
	});

	it('gir null overalt for tomt inn', () => {
		expect(normalizeBodyComposition({})).toEqual({
			fatMassKg: null,
			fatRatio: null,
			muscleMassKg: null,
			fatFreeMassKg: null,
			boneMassKg: null,
			hydrationKg: null,
			fatMassSource: null
		});
	});

	it('ignorerer nuller og negative verdier', () => {
		const result = normalizeBodyComposition({ weightKg: 0, fatMassKg: -5, muscleMassKg: 0 });
		expect(result.fatMassKg).toBeNull();
		expect(result.muscleMassKg).toBeNull();
	});
});

describe('describeCompositionChange', () => {
	function comp(overrides: Partial<BodyComposition> = {}): BodyComposition {
		return {
			fatMassKg: null,
			fatRatio: null,
			muscleMassKg: null,
			fatFreeMassKg: null,
			boneMassKg: null,
			hydrationKg: null,
			fatMassSource: null,
			...overrides
		};
	}

	it('skiller fettnedgang fra muskelnedgang', () => {
		// Hele poenget: «ned 1,4 kg» og «ned 1,4 kg hvorav 0,9 er muskel» er
		// to helt ulike beskjeder.
		const change = describeCompositionChange(
			{ weightKg: 83.4, composition: comp({ fatMassKg: 19, muscleMassKg: 61 }) },
			{ weightKg: 82, composition: comp({ fatMassKg: 18.5, muscleMassKg: 60.1 }) }
		);
		expect(change!.weightKg).toBe(-1.4);
		expect(change!.fatMassKg).toBe(-0.5);
		expect(change!.muscleMassKg).toBe(-0.9);
		expect(change!.sentence).toBe('−1,4 kg — −0,5 kg fett, −0,9 kg muskel');
	});

	it('regner andelen av vektendringen som er fett', () => {
		const change = describeCompositionChange(
			{ weightKg: 83.4, composition: comp({ fatMassKg: 19 }) },
			{ weightKg: 82, composition: comp({ fatMassKg: 18.5 }) }
		);
		// 0,5 av 1,4 ≈ 36 %
		expect(change!.fatShare).toBe(0.36);
	});

	it('formaterer oppgang med plusstegn', () => {
		const change = describeCompositionChange(
			{ weightKg: 82, composition: comp({ muscleMassKg: 60 }) },
			{ weightKg: 82.8, composition: comp({ muscleMassKg: 60.7 }) }
		);
		expect(change!.sentence).toBe('+0,8 kg — +0,7 kg muskel');
	});

	it('klarer seg med bare vekt', () => {
		const change = describeCompositionChange(
			{ weightKg: 83, composition: comp() },
			{ weightKg: 82, composition: comp() }
		);
		expect(change!.sentence).toBe('−1,0 kg');
		expect(change!.fatShare).toBeNull();
	});

	it('deler ikke på en vektendring nær null', () => {
		const change = describeCompositionChange(
			{ weightKg: 82, composition: comp({ fatMassKg: 19 }) },
			{ weightKg: 82, composition: comp({ fatMassKg: 18.5 }) }
		);
		expect(change!.fatShare).toBeNull();
		expect(Number.isFinite(change!.fatMassKg!)).toBe(true);
	});

	it('gir null når ingenting har endret seg', () => {
		expect(
			describeCompositionChange(
				{ weightKg: 82, composition: comp() },
				{ weightKg: 82, composition: comp() }
			)
		).toBeNull();
	});
});
