import { describe, it, expect } from 'vitest';
import {
	resolveWeightGoalNumbers,
	targetWeightInText,
	validateWeightGoalTarget
} from './weight-goal';

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

describe('targetWeightInText', () => {
	it('finner målvekta i en tittel', () => {
		expect(targetWeightInText('Redusere vekt til 95 kg')).toBe(95);
		expect(targetWeightInText('Gå ned til 95 kg fra nåværende vekt')).toBe(95);
		expect(targetWeightInText('ned til 88,5 kilo innen jul')).toBe(88.5);
	});

	it('tar målvekta, ikke startvekta', () => {
		expect(targetWeightInText('Fra 104 kg til 85 kg innen sommeren')).toBe(85);
	});

	it('leser ikke en ENDRING som en målvekt', () => {
		// «Ned 5 kg» er et delta. En parser som gjettet her ville laget et mål om å
		// veie fem kilo.
		expect(targetWeightInText('Ned 5 kg innen jul')).toBeNull();
		expect(targetWeightInText('Gå ned 5 kg')).toBeNull();
	});

	it('går ikke i «tilbake»-fella', () => {
		expect(targetWeightInText('Ta tilbake 3 kg muskel')).toBeNull();
	});

	it('forkaster tall som ikke kan være kroppsvekt', () => {
		expect(targetWeightInText('Løfte til 8 kg i kettlebell')).toBeNull();
		expect(targetWeightInText('opp til 900 kg i markløft')).toBeNull();
	});
});

describe('validateWeightGoalTarget', () => {
	it('godtar en oppgitt målvekt', () => {
		const result = validateWeightGoalTarget({
			title: 'Redusere vekt til 95 kg',
			targetWeightKg: 95
		});
		expect(result).toEqual({ ok: true, targetWeightKg: 95, source: 'oppgitt' });
	});

	it('redder et mål der modellen sendte endringen i stedet', () => {
		// Prod 23. august 2026: tittelen sa «til 95 kg», målfeltet sa −5, og målet
		// endte med å sikte mot 93 kg. Tittelen er det brukeren leser.
		const result = validateWeightGoalTarget({
			title: 'Redusere vekt til 95 kg',
			description: 'Gå ned til 95 kg fra nåværende vekt',
			targetValue: -5
		});
		expect(result).toEqual({ ok: true, targetWeightKg: 95, source: 'tittel' });
	});

	it('avviser når tekst og måltall er uenige', () => {
		const result = validateWeightGoalTarget({
			title: 'Redusere vekt til 95 kg',
			targetWeightKg: 93
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain('95');
			expect(result.error).toContain('93');
		}
	});

	it('avviser når ingenting kan være en målvekt', () => {
		const result = validateWeightGoalTarget({ title: 'Gå ned 5 kg', targetValue: -5 });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain('targetWeightKg');
	});

	it('godtar en målvekt i targetValue — samme mening, riktig felt er bare hyggeligere', () => {
		const result = validateWeightGoalTarget({ title: 'Ned mot normalvekt', targetValue: 95 });
		expect(result).toEqual({ ok: true, targetWeightKg: 95, source: 'oppgitt' });
	});
});
