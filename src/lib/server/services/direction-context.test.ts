import { describe, it, expect } from 'vitest';
import { buildDirectionBlock, horizonLabel } from './direction-context';
import { resolveDeprioritization } from '$lib/domains/livskompass/deprioritization';

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

	it('rammer konfrontasjonen inn med varme — se først, utfordre så', () => {
		const authored = buildDirectionBlock([
			{ kind: 'vision_5year', summary: 'Femårsbildet', originKind: 'user_authored' }
		]);
		expect(authored).toContain('konfrontasjonen skal komme fra varme');
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

describe('buildDirectionBlock — milepæler', () => {
	const NOW = new Date('2026-09-19T08:00:00Z');
	const vision = [{ kind: 'vision_yearly', summary: 'Ettårsbildet', originKind: 'user_authored' }];

	it('rendrer ferske milepæler med regnskap', () => {
		const block = buildDirectionBlock(vision, [], undefined, {
			milestones: [
				{
					id: 'a',
					title: 'Skifte jobb',
					achievedOn: '2026-09-14',
					frees: 'mindre belastning fra jobbsøking',
					cost: 'spenning på gammel jobb'
				}
			],
			now: NOW
		});
		expect(block).toContain('NYLIG OPPNÅDD');
		expect(block).toContain('Skifte jobb (14. september 2026)');
		expect(block).toContain('Kostet: spenning på gammel jobb');
	});

	it('står mellom verdiene og gap-notatet', () => {
		const block = buildDirectionBlock(
			vision,
			['Nærvær med barna'],
			'Sier trening er viktig, men uka har null økter.',
			{ milestones: [{ id: 'a', title: 'Skifte jobb', achievedOn: '2026-09-14' }], now: NOW }
		);
		expect(block.indexOf('VERDIER')).toBeLessThan(block.indexOf('NYLIG OPPNÅDD'));
		expect(block.indexOf('NYLIG OPPNÅDD')).toBeLessThan(block.indexOf('KJENTE GAP'));
	});

	it('endrer ingenting uten milepæler', () => {
		const uten = buildDirectionBlock(vision, ['Nærvær med barna']);
		const tom = buildDirectionBlock(vision, ['Nærvær med barna'], undefined, { milestones: [], now: NOW });
		expect(tom).toBe(uten);
	});

	// Uten retning er en milepælsliste bare oppnåelser uten noe å tolke dem mot.
	it('rendrer ikke milepæler alene når retningen er tom', () => {
		expect(
			buildDirectionBlock([], [], undefined, {
				milestones: [{ id: 'a', title: 'Skifte jobb', achievedOn: '2026-09-14' }],
				now: NOW
			})
		).toBe('');
	});
});

describe('buildDirectionBlock — bevisste nedprioriteringer', () => {
	const NOW = new Date('2026-09-19T08:00:00Z');
	const vision = [{ kind: 'vision_yearly', summary: 'Ettårsbildet', originKind: 'user_authored' }];
	const valgt = resolveDeprioritization(
		{
			id: 'd1',
			dimensionId: 'kultur',
			startDate: '2026-08-10',
			endDate: '2026-11-02',
			reason: 'gir plass til jobbstarten',
			repair: 'to konserter i november',
			confirmedOn: null,
			settledOn: null,
			outcome: null
		},
		'2026-09-19'
	);

	it('rendrer den valgte nedprioriteringen med terminen', () => {
		const block = buildDirectionBlock(vision, [], undefined, { deprioritizations: [valgt], now: NOW });
		expect(block).toContain('BEVISST NEDPRIORITERT NÅ');
		expect(block).toContain('Uke 6 av 13, slik du bestemte');
	});

	// Rekkefølgen er en påstand: prioriteringene leses FØR dommen om hva som spriker.
	it('står mellom verdiene og milepælene, og foran gap-notatet', () => {
		const block = buildDirectionBlock(vision, ['Nærvær med barna'], 'Trener for lite.', {
			deprioritizations: [valgt],
			milestones: [{ id: 'm1', title: 'Skifte jobb', achievedOn: '2026-09-14' }],
			now: NOW
		});
		expect(block.indexOf('VERDIER')).toBeLessThan(block.indexOf('BEVISST NEDPRIORITERT'));
		expect(block.indexOf('BEVISST NEDPRIORITERT')).toBeLessThan(block.indexOf('NYLIG OPPNÅDD'));
		expect(block.indexOf('NYLIG OPPNÅDD')).toBeLessThan(block.indexOf('KJENTE GAP'));
	});

	it('endrer ingenting uten nedprioriteringer', () => {
		const uten = buildDirectionBlock(vision, ['Nærvær med barna']);
		const tom = buildDirectionBlock(vision, ['Nærvær med barna'], undefined, {
			deprioritizations: [],
			now: NOW
		});
		expect(tom).toBe(uten);
	});
});

describe('buildDirectionBlock — rekkefølgen', () => {
	const NOW = new Date('2026-09-19T08:00:00Z');
	const vision = [{ kind: 'vision_yearly', summary: 'Ettårsbildet', originKind: 'user_authored' }];
	const rangering = {
		priorities: [
			{ label: 'Helse', anchorKind: 'area' as const, anchorId: 'helse', why: 'fundamentet' },
			{ label: 'Bidrag hjemme', anchorKind: null, anchorId: null, why: null }
		],
		setOn: '2026-02-12'
	};

	it('rendrer rekkefølgen med posisjon og begrunnelse', () => {
		const block = buildDirectionBlock(vision, [], undefined, { ranking: rangering, now: NOW });
		expect(block).toContain('REKKEFØLGEN');
		expect(block).toContain('1. Helse — fundamentet');
		expect(block).toContain('2. Bidrag hjemme');
	});

	// De to prioriteringsblokkene er ikke hverandres motsatser, og en modell som
	// ser dem ved siden av hverandre tar nettopp den slutningen.
	it('sier at det som mangler ikke er valgt bort', () => {
		const block = buildDirectionBlock(vision, [], undefined, { ranking: rangering, now: NOW });
		expect(block).toContain('ikke valgt bort');
	});

	it('står etter verdiene og FØR nedprioriteringene', () => {
		const valgt = resolveDeprioritization(
			{
				id: 'd1',
				dimensionId: 'kultur',
				startDate: '2026-08-10',
				endDate: '2026-11-02',
				reason: 'gir plass til jobbstarten',
				repair: null,
				confirmedOn: null,
				settledOn: null,
				outcome: null
			},
			'2026-09-19'
		);
		const block = buildDirectionBlock(vision, ['Nærvær med barna'], undefined, {
			ranking: rangering,
			deprioritizations: [valgt],
			now: NOW
		});
		expect(block.indexOf('VERDIER')).toBeLessThan(block.indexOf('REKKEFØLGEN'));
		expect(block.indexOf('REKKEFØLGEN')).toBeLessThan(block.indexOf('BEVISST NEDPRIORITERT'));
	});

	it('endrer ingenting uten rekkefølge', () => {
		const uten = buildDirectionBlock(vision, ['Nærvær med barna']);
		const tom = buildDirectionBlock(vision, ['Nærvær med barna'], undefined, {
			ranking: null,
			now: NOW
		});
		expect(tom).toBe(uten);
	});
});
