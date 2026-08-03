import { describe, it, expect } from 'vitest';
import { computeEnergyBalance, KCAL_PER_KG_FAT, weeklyWeightTrend } from './energy-balance';

describe('computeEnergyBalance', () => {
	it('regner underskudd', () => {
		const balance = computeEnergyBalance({ intakeKcal: 2100, expenditureKcal: 2600 });
		expect(balance!.balanceKcal).toBe(-500);
		expect(balance!.sentence).toContain('500 kcal underskudd');
	});

	it('regner overskudd', () => {
		const balance = computeEnergyBalance({ intakeKcal: 2900, expenditureKcal: 2600 });
		expect(balance!.balanceKcal).toBe(300);
		expect(balance!.sentence).toContain('300 kcal overskudd');
	});

	it('sier «i balanse» ved null', () => {
		const balance = computeEnergyBalance({ intakeKcal: 2600, expenditureKcal: 2600 });
		expect(balance!.balanceKcal).toBe(0);
		// NB: nb-NO gir hardt mellomrom (U+00A0) som tusenskille, ikke vanlig
		// mellomrom — derfor regex og ikke en strengsammenligning.
		expect(balance!.sentence).toMatch(/^2\s?600 kcal spist, 2\s?600 kcal forbrent — i balanse\.$/);
	});

	it('gir null når inntaket mangler', () => {
		// Et underskudd på 2 500 fordi man glemte å logge er ikke et underskudd.
		expect(computeEnergyBalance({ intakeKcal: null, expenditureKcal: 2600 })).toBeNull();
		expect(computeEnergyBalance({ intakeKcal: 0, expenditureKcal: 2600 })).toBeNull();
	});

	it('gir null når forbruket mangler', () => {
		// Withings har ikke rapportert dagen ennå. Halve tall er verre enn ingen.
		expect(computeEnergyBalance({ intakeKcal: 2100, expenditureKcal: null })).toBeNull();
		expect(computeEnergyBalance({ intakeKcal: 2100, expenditureKcal: 0 })).toBeNull();
	});

	it('bærer partialDay videre', () => {
		expect(computeEnergyBalance({ intakeKcal: 900, expenditureKcal: 2600 })!.partialDay).toBe(false);
		expect(
			computeEnergyBalance({ intakeKcal: 900, expenditureKcal: 2600, partialDay: true })!.partialDay
		).toBe(true);
	});

	it('bruker norsk tusenskille', () => {
		const balance = computeEnergyBalance({ intakeKcal: 2100, expenditureKcal: 2600 });
		expect(balance!.sentence).toMatch(/2\s?100 kcal spist/);
	});

	it('runder til hele kalorier', () => {
		const balance = computeEnergyBalance({ intakeKcal: 2100.6, expenditureKcal: 2600.2 });
		expect(balance!.intakeKcal).toBe(2101);
		expect(balance!.balanceKcal).toBe(-500);
	});
});

describe('weeklyWeightTrend', () => {
	it('regner om daglig balanse til kilo per uke', () => {
		// 500 kcal underskudd × 7 dager / 7700 ≈ −0,45 kg
		expect(weeklyWeightTrend(-500)).toBe(-0.45);
		expect(weeklyWeightTrend(500)).toBe(0.45);
	});

	it('gir 0 for balanse', () => {
		expect(weeklyWeightTrend(0)).toBe(0);
	});

	it('bruker den vanlige tommelfingerregelen', () => {
		expect(KCAL_PER_KG_FAT).toBe(7700);
		// Et underskudd som tilsvarer nøyaktig én kilo på en uke.
		expect(weeklyWeightTrend(-KCAL_PER_KG_FAT / 7)).toBe(-1);
	});
});
