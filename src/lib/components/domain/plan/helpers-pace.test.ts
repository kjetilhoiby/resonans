import { describe, it, expect } from 'vitest';
import { computePaceEstimate } from './helpers';

/**
 * Tonen følger målretningen, ordet følger verdien.
 *
 * For et vektmål peker retningen nedover, og en tekst som beskrev estimatet med
 * målretningens fortegn ble motsatt av sann: prod viste «Estimat ved dagens snitt:
 * ~98 kg (5 kg under mål)» om et mål på 93 kg.
 */
const format = (v: number) => String(Math.round(v * 10) / 10);

/** Halvveis i perioden, så både «på plan» og estimat kan regnes. */
function halfway(opts: {
	startValue: number;
	currentValue: number;
	targetValue: number;
	unit?: string;
}) {
	const now = new Date();
	const startDate = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
	const endDate = new Date(now.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
	return computePaceEstimate({
		startDate,
		endDate,
		unit: opts.unit ?? 'kg',
		formatValue: format,
		...opts
	});
}

describe('computePaceEstimate — nedadgående mål', () => {
	it('kaller et estimat over målvekta for «over mål», ikke «under»', () => {
		// 98 → 93 planlagt, men vekta står stille: estimatet er 98, altså 5 kg OVER målet.
		const estimate = halfway({ startValue: 98, currentValue: 98, targetValue: 93 });

		expect(estimate?.estimateLabel).toContain('5 kg over mål');
		// Tonen er fortsatt «bak»: over målvekta er å ligge bak et vektmål.
		expect(estimate?.estimateTone).toBe('behind');
	});

	it('kaller et estimat under målvekta for «under mål», med positiv tone', () => {
		// 104 → 85 planlagt, 94 halvveis: tempoet projiserer 84, altså under målet.
		const estimate = halfway({ startValue: 104, currentValue: 94, targetValue: 85 });

		expect(estimate?.estimateLabel).toContain('under mål');
		expect(estimate?.estimateTone).toBe('ahead');
	});

	it('holder tone og ord fra hverandre: over målvekta kan være foran plan', () => {
		// 104 → 85 planlagt, 98 halvveis: raskere enn plan (foran), men estimatet på
		// 92 kg ligger fortsatt over målvekta.
		const estimate = halfway({ startValue: 104, currentValue: 98, targetValue: 85 });

		expect(estimate?.estimateLabel).toContain('over mål');
		expect(estimate?.estimateTone).toBe('behind');
	});

	it('sier «bak plan» når vekta ligger over plankurven', () => {
		const estimate = halfway({ startValue: 98, currentValue: 98, targetValue: 93 });
		expect(estimate?.diffLabel).toContain('bak plan');
	});
});

describe('computePaceEstimate — oppadgående mål', () => {
	it('kaller et estimat under måltallet for «under mål»', () => {
		// 0 → 150 km, halvveis med 50 km: estimatet er 100, altså 50 under målet.
		const estimate = halfway({ startValue: 0, currentValue: 50, targetValue: 150, unit: 'km' });

		expect(estimate?.estimateLabel).toContain('50 km under mål');
		expect(estimate?.estimateTone).toBe('behind');
	});

	it('kaller et estimat over måltallet for «over mål»', () => {
		const estimate = halfway({ startValue: 0, currentValue: 100, targetValue: 150, unit: 'km' });

		expect(estimate?.estimateLabel).toContain('over mål');
		expect(estimate?.estimateTone).toBe('ahead');
	});
});
