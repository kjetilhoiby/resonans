import { describe, it, expect } from 'vitest';
import { buildDirectionBlock, horizonLabel } from './direction-context';

describe('horizonLabel', () => {
	it('kjenner alle fire horisonter', () => {
		expect(horizonLabel('vision_10year')).toBe('10 år frem');
		expect(horizonLabel('vision_5year')).toBe('5 år frem');
		expect(horizonLabel('vision_yearly')).toBe('i år');
		expect(horizonLabel('vision_quarterly')).toBe('kommende kvartal');
	});

	it('faller tilbake til rå kind for ukjente', () => {
		expect(horizonLabel('vision_themed')).toBe('vision_themed');
	});
});

describe('buildDirectionBlock', () => {
	it('gir tom streng uten visjoner og verdier', () => {
		expect(buildDirectionBlock([], [])).toBe('');
	});

	it('sorterer horisonter fra lengst til kortest', () => {
		const block = buildDirectionBlock([
			{ kind: 'vision_yearly', summary: 'Ettårsbildet', originKind: 'user_authored' },
			{ kind: 'vision_10year', summary: 'Tiårsbildet', originKind: 'user_authored' }
		]);
		expect(block.indexOf('Tiårsbildet')).toBeLessThan(block.indexOf('Ettårsbildet'));
	});

	it('merker LLM-foreslåtte visjoner som AI-utkast', () => {
		const block = buildDirectionBlock([
			{ kind: 'vision_quarterly', summary: 'Kvartalsbildet', originKind: 'llm_proposed' }
		]);
		expect(block).toContain('[kommende kvartal] (AI-utkast) Kvartalsbildet');
	});

	it('legger konfrontasjons-instruks kun når minst én visjon er brukerforfattet', () => {
		const authored = buildDirectionBlock([
			{ kind: 'vision_5year', summary: 'Femårsbildet', originKind: 'user_authored' }
		]);
		expect(authored).toContain('pek på gapet eksplisitt');

		const proposed = buildDirectionBlock([
			{ kind: 'vision_5year', summary: 'Femårsbildet', originKind: 'llm_proposed' }
		]);
		expect(proposed).not.toContain('pek på gapet eksplisitt');
	});

	it('peker på query_reflections for fulltekst kun ved brukerforfattet retning', () => {
		const authored = buildDirectionBlock([
			{ kind: 'vision_yearly', summary: 'Ettårsbildet', originKind: 'user_authored' }
		]);
		expect(authored).toContain('query_reflections');

		const proposed = buildDirectionBlock([
			{ kind: 'vision_yearly', summary: 'Ettårsbildet', originKind: 'llm_proposed' }
		]);
		expect(proposed).not.toContain('query_reflections');
	});

	it('rendrer verdier og gap-notat', () => {
		const block = buildDirectionBlock(
			[{ kind: 'vision_yearly', summary: 'Ettårsbildet', originKind: 'user_authored' }],
			['Nærvær med barna', 'Helse som fundament'],
			'Sier trening er viktig, men uka har null økter.'
		);
		expect(block).toContain('VERDIER (brukerens egne, bekreftede ord):\n- Nærvær med barna\n- Helse som fundament');
		expect(block).toContain('KJENTE GAP (fra siste retningssamtale):\nSier trening er viktig, men uka har null økter.');
	});

	it('hopper over visjoner med tom summary', () => {
		expect(buildDirectionBlock([{ kind: 'vision_5year', summary: '   ' }])).toBe('');
	});
});
