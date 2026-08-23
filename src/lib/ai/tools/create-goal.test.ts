import { describe, it, expect } from 'vitest';
import { createGoalTool, describeMeasurement } from './create-goal';

/**
 * Kvitteringen etter et vektmål skal bære tallene som BLE LAGRET.
 *
 * Modellen tenker absolutt («fra 100 til 95 kg») og fant tidligere fraverdien selv:
 * skjermdumpen fra 23. august 2026 viser «Fraverdi: 100 kg» til en bruker som veide
 * 98. Baselinen resolves serverside, så svaret må lese den ut av metadataen framfor
 * fra argumentene.
 */
describe('describeMeasurement', () => {
	it('regner målvekta ut av baseline + delta', () => {
		const result = describeMeasurement({
			metricId: 'weight_change',
			startValue: 98.2,
			goalTrack: { targetValue: -3.2, unit: 'kg' }
		});
		expect(result.measurement).toContain('98.2 kg');
		expect(result.measurement).toContain('95 kg');
		expect(result.warning).toBeUndefined();
	});

	it('varsler når vektmålet mangler baseline — det er «uten måling»-tilfellet', () => {
		const result = describeMeasurement({
			metricId: 'weight_change',
			startValue: null,
			goalTrack: { targetValue: -3, unit: 'kg' }
		});
		expect(result.warning).toContain('startvekt');
		expect(result.measurement).toBeUndefined();
	});

	it('varsler når vektmålet mangler målverdi', () => {
		const result = describeMeasurement({
			metricId: 'weight_change',
			startValue: 98,
			goalTrack: null
		});
		expect(result.warning).toBeTruthy();
	});

	it('varsler når målet ikke er koblet til en metrikk', () => {
		expect(describeMeasurement({ metricId: null }).warning).toContain('metrikk');
	});

	it('rapporterer målverdien for andre metrikker', () => {
		const result = describeMeasurement({
			metricId: 'running_distance',
			goalTrack: { targetValue: 150, unit: 'km' }
		});
		expect(result.measurement).toBe('Måles mot 150 km');
	});
});

/**
 * Vektmål: kontrakten er målvekten, og tittelen er kryssjekken.
 *
 * `execute` treffer databasen, så det som testes her er porten foran den — den som
 * avgjør hvilket tall som i det hele tatt sendes videre.
 */
describe('create_goal — vektmålets målverdi', () => {
	it('har en egen parameter for målvekten', () => {
		const shape = (createGoalTool.parameters as unknown as { shape: Record<string, unknown> }).shape;
		expect(shape).toHaveProperty('targetWeightKg');
	});

	it('sier i beskrivelsen at målvekten skal stemme med tittelen', () => {
		expect(createGoalTool.description).toContain('targetWeightKg');
		expect(createGoalTool.description).toContain('tittelen');
	});
});
