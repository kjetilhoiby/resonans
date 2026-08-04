import { describe, it, expect } from 'vitest';
import {
	isHungerLevel,
	predictHunger,
	typicalHungerHour,
	HUNGER_HIGH,
	MIN_HIGH_OBSERVATIONS,
	MIN_OBSERVATIONS,
	WARN_AT_FRACTION,
	type HungerObservation
} from './hunger';

function obs(level: number, gapKcal: number | null, osloHour = 15): HungerObservation {
	return { at: `2026-08-0${(osloHour % 9) + 1}T12:00:00Z`, level, gapKcal, osloHour };
}

describe('isHungerLevel', () => {
	it('godtar bare hele tall 1–5', () => {
		expect(isHungerLevel(1)).toBe(true);
		expect(isHungerLevel(5)).toBe(true);
		expect(isHungerLevel(0)).toBe(false);
		expect(isHungerLevel(6)).toBe(false);
		expect(isHungerLevel(3.5)).toBe(false);
		expect(isHungerLevel('4')).toBe(false);
		expect(isHungerLevel(null)).toBe(false);
	});
});

describe('predictHunger', () => {
	it('holder kjeft under nok meldinger', () => {
		const result = predictHunger({
			history: [obs(5, 1400), obs(4, 1300)],
			gapNowKcal: 1500
		});
		expect(result.ready).toBe(false);
		expect(result.approaching).toBe(false);
		expect(result.thresholdKcal).toBeNull();
		expect(result.notReadyReason).toContain(String(MIN_OBSERVATIONS));
	});

	it('holder kjeft uten høye meldinger, selv med mange lave', () => {
		const result = predictHunger({
			history: [obs(1, 400), obs(2, 500), obs(2, 600), obs(1, 300), obs(3, 700)],
			gapNowKcal: 2000
		});
		expect(result.observations).toBe(5);
		expect(result.ready).toBe(false);
		expect(result.notReadyReason).toContain(String(MIN_HIGH_OBSERVATIONS));
	});

	it('bruker medianen av de høye gapene som terskel', () => {
		const result = predictHunger({
			history: [obs(1, 300), obs(2, 600), obs(4, 1200), obs(5, 1400), obs(4, 1600)],
			gapNowKcal: 0
		});
		expect(result.ready).toBe(true);
		expect(result.thresholdKcal).toBe(1400);
		expect(result.highObservations).toBe(3);
	});

	it('lar ikke én ekstremdag flytte terskelen', () => {
		// Snittet av 1200/1300/1400/5000 er 2 225 — en terskel ingen dag ligger på.
		const result = predictHunger({
			history: [obs(1, 300), obs(4, 1200), obs(4, 1300), obs(5, 1400), obs(5, 5000)],
			gapNowKcal: 0
		});
		expect(result.thresholdKcal).toBe(1350);
	});

	it('varsler før terskelen, ikke først på den', () => {
		const history = [obs(1, 300), obs(2, 600), obs(4, 1400), obs(5, 1400), obs(4, 1400)];
		const threshold = 1400;

		// Rett under varselgrensa: ingenting.
		expect(
			predictHunger({ history, gapNowKcal: threshold * WARN_AT_FRACTION - 10 }).approaching
		).toBe(false);
		// På varselgrensa: si fra, selv om terskelen ikke er nådd.
		expect(predictHunger({ history, gapNowKcal: threshold * WARN_AT_FRACTION }).approaching).toBe(
			true
		);
		expect(predictHunger({ history, gapNowKcal: threshold + 500 }).approaching).toBe(true);
	});

	it('kan ikke sammenligne uten dagens gap', () => {
		const history = [obs(1, 300), obs(2, 600), obs(4, 1400), obs(5, 1400), obs(4, 1400)];
		const result = predictHunger({ history, gapNowKcal: null });
		expect(result.ready).toBe(true);
		expect(result.approaching).toBe(false);
	});

	it('ser bort fra meldinger uten gap bak', () => {
		// Fem meldinger, men bare to har tall — da er vi ikke klare.
		const result = predictHunger({
			history: [obs(4, null), obs(5, null), obs(4, null), obs(5, 1400), obs(4, 1300)],
			gapNowKcal: 1500
		});
		expect(result.observations).toBe(2);
		expect(result.ready).toBe(false);
	});

	it('teller bare nivå fra og med HUNGER_HIGH som høyt', () => {
		const result = predictHunger({
			history: [obs(3, 1000), obs(3, 1100), obs(3, 1200), obs(3, 1300), obs(3, 1400)],
			gapNowKcal: 2000
		});
		expect(result.highObservations).toBe(0);
		expect(HUNGER_HIGH).toBe(4);
	});
});

describe('typicalHungerHour', () => {
	it('finner timen som gjentas', () => {
		expect(
			typicalHungerHour([obs(4, 1400, 15), obs(5, 1500, 15), obs(4, 1300, 11)])
		).toBe(15);
	});

	it('gir null uten flertall', () => {
		expect(typicalHungerHour([obs(4, 1400, 15), obs(5, 1500, 11)])).toBeNull();
		expect(typicalHungerHour([])).toBeNull();
	});

	it('runder ned til hel time', () => {
		expect(
			typicalHungerHour([
				{ at: '2026-08-03T13:00:00Z', level: 4, gapKcal: 1400, osloHour: 15.75 },
				{ at: '2026-08-04T13:00:00Z', level: 5, gapKcal: 1500, osloHour: 15.2 }
			])
		).toBe(15);
	});
});
