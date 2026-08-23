import { describe, it, expect } from 'vitest';
import { resolveWeightGoalNumbers } from './weight-goal';

describe('resolveWeightGoalNumbers', () => {
	it('leser en oppgitt målvekt absolutt og regner deltaet selv', () => {
		const result = resolveWeightGoalNumbers({
			rawTargetValue: 95,
			startValue: 98.2,
			fallbackStartWeight: null
		});
		expect(result).toEqual({
			startWeight: 98.2,
			targetWeight: 95,
			targetDelta: -3.2,
			targetInterpretation: 'absolute',
			startSource: 'oppgitt'
		});
	});

	it('leser et negativt tall som en endring', () => {
		const result = resolveWeightGoalNumbers({
			rawTargetValue: -5,
			startValue: 100,
			fallbackStartWeight: null
		});
		expect(result?.targetWeight).toBe(95);
		expect(result?.targetDelta).toBe(-5);
		expect(result?.targetInterpretation).toBe('delta');
	});

	it('bruker fallback-vekta når baselinen mangler, og sier at den er målt', () => {
		const result = resolveWeightGoalNumbers({
			rawTargetValue: 95,
			startValue: null,
			fallbackStartWeight: 98.4
		});
		expect(result?.startWeight).toBe(98.4);
		expect(result?.startSource).toBe('maalt');
	});

	it('foretrekker en oppgitt baseline over fallback', () => {
		const result = resolveWeightGoalNumbers({
			rawTargetValue: 95,
			startValue: 104,
			fallbackStartWeight: 98
		});
		expect(result?.startWeight).toBe(104);
		expect(result?.targetDelta).toBe(-9);
	});

	it('returnerer null uten baseline — et delta uten fraverdi er ikke et mål', () => {
		expect(
			resolveWeightGoalNumbers({ rawTargetValue: 95, startValue: null, fallbackStartWeight: null })
		).toBeNull();
	});

	it('returnerer null uten målverdi — Number(null) er 0, og 0 er «hold vekta»', () => {
		expect(
			resolveWeightGoalNumbers({ rawTargetValue: null, startValue: 98, fallbackStartWeight: 98 })
		).toBeNull();
		expect(
			resolveWeightGoalNumbers({ rawTargetValue: undefined, startValue: 98, fallbackStartWeight: 98 })
		).toBeNull();
	});

	it('forkaster en baseline som ikke kan være kroppsvekt', () => {
		// 0,98 er sannsynligvis en enhetsfeil, ikke en vekt
		expect(
			resolveWeightGoalNumbers({ rawTargetValue: 95, startValue: 0.98, fallbackStartWeight: null })
		).toBeNull();
	});

	it('tolker et gammelt mål der målvekta ble lagret som delta', () => {
		// Prod: chatten sendte 95 inn i delta-feltet, så målet siktet mot 193 kg
		const result = resolveWeightGoalNumbers({
			rawTargetValue: 95,
			startValue: 98,
			fallbackStartWeight: null
		});
		expect(result?.targetWeight).toBe(95);
		expect(result?.targetWeight).not.toBe(193);
	});

	it('godtar et mål om å holde vekta', () => {
		const result = resolveWeightGoalNumbers({
			rawTargetValue: 0,
			startValue: 98,
			fallbackStartWeight: null
		});
		expect(result?.targetDelta).toBe(0);
		expect(result?.targetWeight).toBe(98);
	});

	it('avrunder til én desimal', () => {
		const result = resolveWeightGoalNumbers({
			rawTargetValue: 85,
			startValue: 98.26,
			fallbackStartWeight: null
		});
		expect(result?.startWeight).toBe(98.3);
		expect(result?.targetDelta).toBe(-13.3);
	});
});
