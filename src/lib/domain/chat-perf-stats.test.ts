import { describe, it, expect } from 'vitest';
import {
	MIN_SAMPLES_FOR_VERDICT,
	SLOW_PHASE_MS,
	parseAnswer,
	parsePhases,
	parsePromptParts,
	parseToolSelection,
	sanitizeModelName,
	sanitizeRejection,
	summarizeChatAnswers,
	percentile,
	summarizeChatPerf,
	type ChatPerfSample,
	type ToolSelectionSample
} from './chat-perf-stats';

/** n målinger der «helsebriefing» dominerer, og én utligger til slutt. */
function manySamples(n: number, briefingMs = 400): ChatPerfSample[] {
	return Array.from({ length: n }, (_, i) => ({
		wallMs: 500,
		phases: [
			{ name: 'helsebriefing', ms: briefingMs },
			{ name: 'minne', ms: 40 },
			{ name: 'mål', ms: i === n - 1 ? 900 : 30 }
		]
	}));
}

describe('parsePhases', () => {
	it('slipper gjennom gyldige faser', () => {
		expect(parsePhases([{ name: 'minne', ms: 12 }])).toEqual([{ name: 'minne', ms: 12 }]);
	});

	// jsonb er en generell beholder; et felt noen legger til senere skal ikke
	// følge med ut av seg selv. Samme regel som toPublicCronRun.
	it('tar bare name og ms, aldri andre felt', () => {
		const p = parsePhases([{ name: 'minne', ms: 12, hemmelig: 'brukerdata' }]);
		expect(p).toEqual([{ name: 'minne', ms: 12 }]);
		expect(JSON.stringify(p)).not.toContain('hemmelig');
	});

	it('hopper over søppel framfor å kaste', () => {
		expect(parsePhases([null, 'tekst', 42, { name: 'a' }, { ms: 1 }, { name: 1, ms: 1 }])).toEqual(
			[]
		);
		expect(parsePhases(null)).toEqual([]);
		expect(parsePhases({ name: 'a', ms: 1 })).toEqual([]);
	});

	it('avviser NaN og Infinity — de ødelegger enhver aggregering', () => {
		expect(parsePhases([{ name: 'a', ms: NaN }, { name: 'b', ms: Infinity }])).toEqual([]);
	});
});

describe('percentile', () => {
	it('er nærmeste rang, altså alltid en målt verdi', () => {
		const s = [10, 20, 30, 40];
		expect(percentile(s, 0.5)).toBe(20);
		expect(percentile(s, 0.95)).toBe(40);
		expect(percentile(s, 0)).toBe(10);
		expect(percentile(s, 1)).toBe(40);
	});

	it('takler én måling og ingen', () => {
		expect(percentile([7], 0.5)).toBe(7);
		expect(percentile([], 0.5)).toBeNull();
	});
});

describe('summarizeChatPerf', () => {
	it('sier fra om tomt vindu framfor å late som', () => {
		const s = summarizeChatPerf([]);
		expect(s.samples).toBe(0);
		expect(s.wall).toBeNull();
		expect(s.summary).toContain('Ingen målinger');
	});

	// Under terskelen skal tallene sies, men ikke dommen — et cache-grep tatt
	// på tre målinger kan fjerne arbeid som ikke var problemet.
	it('holder dommen tilbake under terskelen', () => {
		const s = summarizeChatPerf(manySamples(3));
		expect(s.summary).toContain('For få til å si noe');
		expect(s.summary).toContain(`trengs ${MIN_SAMPLES_FOR_VERDICT}`);
		// men tallene er der
		expect(s.wall?.medianMs).toBe(500);
	});

	it('rangerer tyngste fase først og navngir den i dommen', () => {
		const s = summarizeChatPerf(manySamples(30));
		expect(s.phases[0].name).toBe('helsebriefing');
		expect(s.summary).toContain('helsebriefing');
		expect(s.summary).toContain('der ligger gevinsten');
	});

	// Poenget med persentiler: én utligger skal synes i maks, ikke drukne.
	it('skiller median fra maks per fase', () => {
		const s = summarizeChatPerf(manySamples(30));
		const mal = s.phases.find((p) => p.name === 'mål')!;
		expect(mal.medianMs).toBe(30);
		expect(mal.maxMs).toBe(900);
	});

	it('leser wall mot sum som parallelliseringens helse', () => {
		// sum = 400+40+30 = 470, wall = 500 → fasene kjører etter hverandre
		const seriell = summarizeChatPerf(manySamples(30));
		expect(seriell.parallelismRatio).toBeGreaterThan(0.9);
		expect(seriell.summary).toContain('nærmest etter hverandre');

		// samme faser, men wall 150 → parallelliseringen virker
		const parallell = summarizeChatPerf(
			manySamples(30).map((s) => ({ ...s, wallMs: 150 }))
		);
		expect(parallell.parallelismRatio).toBeLessThan(0.6);
		expect(parallell.summary).toContain('parallelliseringen virker');
	});

	it('sier at ingen fase peker seg ut når alle er raske', () => {
		const s = summarizeChatPerf(manySamples(30, SLOW_PHASE_MS - 100));
		expect(s.summary).toContain('ingen fase peker seg ut');
	});

	it('teller faser hver for seg — en fase kan mangle i noen meldinger', () => {
		const blandet: ChatPerfSample[] = [
			{ wallMs: 100, phases: [{ name: 'a', ms: 10 }, { name: 'b', ms: 20 }] },
			{ wallMs: 100, phases: [{ name: 'a', ms: 10 }] }
		];
		const s = summarizeChatPerf(blandet);
		expect(s.phases.find((p) => p.name === 'a')?.samples).toBe(2);
		expect(s.phases.find((p) => p.name === 'b')?.samples).toBe(1);
	});

	it('deler ikke på null når alle faser er 0 ms', () => {
		const s = summarizeChatPerf([{ wallMs: 5, phases: [{ name: 'a', ms: 0 }] }]);
		expect(s.parallelismRatio).toBeNull();
		expect(s.summary).not.toContain('NaN');
	});
});


function answered(totalMs: number, opts: Partial<NonNullable<ChatPerfSample['answer']>> = {}): ChatPerfSample {
	return {
		wallMs: 100,
		phases: [{ name: 'ruting', ms: 2 }],
		answer: {
			model: 'gpt-5.4-2026-03-05',
			firstTokenMs: Math.round(totalMs / 3),
			totalMs,
			toolRounds: 0,
			fallback: false,
			streamed: true,
			...opts
		}
	};
}

describe('summarizeChatAnswers', () => {
	it('er null uten svarmålinger — rader fra før feltet fantes teller ikke', () => {
		expect(summarizeChatAnswers(manySamples(5))).toBeNull();
		expect(summarizeChatPerf(manySamples(5)).answer).toBeNull();
	});

	it('gir median og p95 for første ord og ferdig svar', () => {
		const stats = summarizeChatAnswers([answered(3000), answered(6000), answered(9000)])!;
		expect(stats.samples).toBe(3);
		expect(stats.total).toEqual({ medianMs: 6000, p95Ms: 9000, maxMs: 9000 });
		expect(stats.firstToken).toEqual({ medianMs: 2000, p95Ms: 3000, maxMs: 3000 });
	});

	it('første ord regnes bare over strømmede svar', () => {
		const stats = summarizeChatAnswers([
			answered(3000),
			answered(9000, { streamed: false, firstTokenMs: null })
		])!;
		expect(stats.firstToken).toEqual({ medianMs: 1000, p95Ms: 1000, maxMs: 1000 });
		expect(stats.total.maxMs).toBe(9000);
	});

	it('sier hvilken modell som faktisk svarte, og at reserven tok over', () => {
		const stats = summarizeChatAnswers([
			answered(3000),
			answered(4000),
			answered(5000, { model: 'gpt-4o-2024-08-06', fallback: true })
		])!;
		expect(stats.byModel).toEqual([
			{ model: 'gpt-5.4-2026-03-05', samples: 2 },
			{ model: 'gpt-4o-2024-08-06', samples: 1 }
		]);
		expect(stats.fallbacks).toBe(1);
		expect(stats.summary).toContain('reserven svarte 1 gang');
	});

	it('holder dommen tilbake under terskelen', () => {
		expect(summarizeChatAnswers([answered(3000)])!.summary).toContain(`trengs ${MIN_SAMPLES_FOR_VERDICT}`);
		const many = Array.from({ length: MIN_SAMPLES_FOR_VERDICT }, () => answered(3000));
		expect(summarizeChatAnswers(many)!.summary).not.toContain('for få');
	});
});

describe('sanitizeModelName', () => {
	it('slipper gjennom maskinnavn', () => {
		expect(sanitizeModelName('gpt-5.4-2026-03-05')).toBe('gpt-5.4-2026-03-05');
		expect(sanitizeModelName('o3-mini')).toBe('o3-mini');
	});

	it('gjør alt annet til «annet» — navnet går ut på et åpent endepunkt', () => {
		expect(sanitizeModelName('<script>alert(1)</script>')).toBe('annet');
		expect(sanitizeModelName('gpt 5')).toBe('annet');
		expect(sanitizeModelName('a'.repeat(60))).toBe('annet');
		expect(sanitizeModelName(null)).toBe('annet');
	});
});

describe('parseAnswer', () => {
	const row = {
		model: 'gpt-5.4',
		firstTokenMs: 900,
		totalMs: 4200,
		toolRounds: 1,
		fallback: false,
		streamed: true
	};

	it('leser en hel rad', () => {
		expect(parseAnswer(row)).toEqual({
			...row,
			rejection: null,
			modelMs: null,
			promptTokens: null,
			completionTokens: null,
			reasoningTokens: null,
			promptTokensTotal: null,
			cachedTokens: null,
			promptParts: null,
			toolSelection: null
		});
	});

	it('er null for rader fra før kolonnene fantes', () => {
		expect(
			parseAnswer({ model: null, firstTokenMs: null, totalMs: null, toolRounds: null, fallback: null, streamed: null })
		).toBeNull();
	});

	it('vasker modellnavnet også ved lesing', () => {
		expect(parseAnswer({ ...row, model: 'tull med mellomrom' })!.model).toBe('annet');
	});
});

describe('avslag i svarmålingen', () => {
	it('teller avslagene, så «hvorfor svarte reserven» kan leses uten loggen', () => {
		const stats = summarizeChatAnswers([
			answered(3000, { rejection: '400:unsupported_parameter:verbosity' }),
			answered(3000, { rejection: '400:unsupported_parameter:verbosity' }),
			answered(5000, { model: 'gpt-4o-2024-08-06', fallback: true, rejection: '404:model_not_found:' }),
			answered(3000)
		])!;
		expect(stats.rejections).toEqual([
			{ reason: '400:unsupported_parameter:verbosity', samples: 2 },
			{ reason: '404:model_not_found:', samples: 1 }
		]);
		expect(stats.summary).toContain('avslag: 400:unsupported_parameter:verbosity ×2');
	});

	it('vasker avslaget ved lesing — det ligger på et åpent endepunkt', () => {
		expect(sanitizeRejection('400:unsupported_parameter:verbosity')).toBe('400:unsupported_parameter:verbosity');
		expect(sanitizeRejection('400: noe fritekst fra en melding')).toBeNull();
		expect(sanitizeRejection(42)).toBeNull();
	});
});

describe('hvor tida i svaret går', () => {
	it('deler svartida i modellkall og resten, og tar med tenketokens', () => {
		// wallMs 100 i answered(): 15 000 totalt − 100 kontekst − 12 000 modell = 2 900 annet.
		const stats = summarizeChatAnswers([
			answered(15000, { modelMs: 12000, promptTokens: 9000, completionTokens: 900, reasoningTokens: 700 }),
			answered(15000, { modelMs: 12000, promptTokens: 9000, completionTokens: 900, reasoningTokens: 700 })
		])!;
		expect(stats.split).toEqual({
			samples: 2,
			modelMedianMs: 12000,
			otherMedianMs: 2900,
			promptTokensMedian: 9000,
			completionTokensMedian: 900,
			reasoningTokensMedian: 700,
			cachedShareMedian: null,
			promptParts: []
		});
		expect(stats.summary).toContain('12000 ms modellkall og 2900 ms verktøy og annet; 700 tenketokens');
	});

	it('er null når ingen svar har feltet — rader fra før skal ikke dra medianen mot null', () => {
		expect(summarizeChatAnswers([answered(3000)])!.split).toBeNull();
	});

	it('teller bare svarene som har feltet', () => {
		const stats = summarizeChatAnswers([answered(3000), answered(9000, { modelMs: 6000 })])!;
		expect(stats.split?.samples).toBe(1);
		expect(stats.split?.reasoningTokensMedian).toBeNull();
	});
});

describe('promptens anatomi', () => {
	it('gir median tegn per blokk, største først, og cache-andelen', () => {
		const parts = [
			{ name: 'verktøy' as const, chars: 89000 },
			{ name: 'helse' as const, chars: 12000 },
			{ name: 'minne' as const, chars: 3000 }
		];
		const stats = summarizeChatAnswers([
			answered(7000, { modelMs: 3000, promptTokensTotal: 60000, cachedTokens: 45000, promptParts: parts }),
			answered(7000, { modelMs: 3000, promptTokensTotal: 60000, cachedTokens: 15000, promptParts: parts })
		])!;
		expect(stats.split?.promptParts.map((p) => p.name)).toEqual(['verktøy', 'helse', 'minne']);
		expect(stats.split?.promptParts[0].medianChars).toBe(89000);
		// Nærmeste rang: medianen av [0,25, 0,75] er 0,25.
		expect(stats.split?.cachedShareMedian).toBe(0.25);
		expect(stats.summary).toContain('25 % av prompten fra cachen');
		expect(stats.summary).toContain('største promptblokk er «verktøy»');
	});

	it('slipper bare kjente blokknavn gjennom — kolonnen er jsonb og endepunktet åpent', () => {
		expect(
			parsePromptParts([
				{ name: 'verktøy', chars: 10 },
				{ name: 'hemmelig', chars: 5 },
				{ name: 'helse', chars: -1 },
				{ name: 'minne', chars: 3, innhold: 'brukertekst' }
			])
		).toEqual([
			{ name: 'verktøy', chars: 10 },
			{ name: 'minne', chars: 3 }
		]);
		expect(parsePromptParts('tull')).toBeNull();
	});
});

describe('verktøyutvalget i svarmålingen', () => {
	function selection(opts: Partial<ToolSelectionSample> = {}): ToolSelectionSample {
		return {
			mode: 'shadow',
			groups: ['kjerne'],
			sources: { routing: [], theme: [], recent: [], image: [] },
			selected: 18,
			total: 67,
			called: [],
			missed: [],
			loaded: [],
			...opts
		};
	}

	it('vasker navnene — modellen kan kalle et verktøy som ikke finnes', () => {
		const parsed = parseToolSelection({
			mode: 'shadow',
			groups: ['kjerne', 'helse', '<script>'],
			sources: { routing: ['helse', 'tull'], theme: 'helse' },
			selected: 30,
			total: 67,
			called: ['query_training', 'slett_alt', 'query_training'],
			missed: ['slett_alt', 'query_economics'],
			loaded: ['okonomi', 'kjerne!'],
			ekstra: 'skal ikke ut'
		});
		expect(parsed).toEqual({
			mode: 'shadow',
			groups: ['kjerne', 'helse'],
			sources: { routing: ['helse'], theme: [], recent: [], image: [] },
			selected: 30,
			total: 67,
			called: ['query_training'],
			missed: ['query_economics'],
			loaded: ['okonomi']
		});
	});

	it('forkaster en rad uten gyldig modus eller tall', () => {
		expect(parseToolSelection({ mode: 'kanskje', selected: 1, total: 2 })).toBeNull();
		expect(parseToolSelection({ mode: 'on', selected: 'mange', total: 2 })).toBeNull();
		expect(parseToolSelection(null)).toBeNull();
	});

	it('leses fra radkolonnen', () => {
		const answer = parseAnswer({
			model: 'gpt-5.4',
			firstTokenMs: 1,
			totalMs: 2,
			toolRounds: 0,
			fallback: false,
			streamed: true,
			toolSelection: selection({ called: ['query_weight'] })
		});
		expect(answer?.toolSelection?.called).toEqual(['query_weight']);
	});

	it('regner bom-andelen bare over svar som kalte verktøy', () => {
		const samples = [
			answered(1000, { toolSelection: selection() }),
			answered(1000, { toolSelection: selection({ called: ['query_training'] }) }),
			answered(1000, {
				toolSelection: selection({
					called: ['query_economics', 'query_training'],
					missed: ['query_economics'],
					sources: { routing: ['helse'], theme: [], recent: [], image: [] }
				})
			}),
			answered(1000, { toolSelection: selection({ called: ['query_economics'], missed: ['query_economics'], loaded: ['okonomi'] }) }),
			answered(1000)
		];
		const stats = summarizeChatAnswers(samples)!.toolSelection!;
		expect(stats).toMatchObject({
			samples: 4,
			withToolCalls: 3,
			withMiss: 2,
			missRate: 0.67,
			selectedMedian: 18,
			total: 67,
			topMissed: [{ tool: 'query_economics', samples: 2 }],
			loaded: [{ group: 'okonomi', samples: 1 }],
			sources: { routing: 1, theme: 0, recent: 0, image: 0 }
		});
	});

	it('holder dommen tilbake til det finnes nok svar med verktøykall', () => {
		const few = Array.from({ length: 3 }, () => answered(1000, { toolSelection: selection({ called: ['query_weight'] }) }));
		const summary = summarizeChatAnswers(few)!.summary;
		expect(summary).toContain('0 av 3 svar med verktøykall bommet');
		expect(summary).not.toContain('skru på kuttet');
	});

	it('sier fra når bom-andelen er lav nok til kuttet', () => {
		const many = Array.from({ length: MIN_SAMPLES_FOR_VERDICT }, () =>
			answered(1000, { toolSelection: selection({ called: ['query_weight'] }) })
		);
		expect(summarizeChatAnswers(many)!.summary).toContain('lavt nok til å skru på kuttet');
	});

	it('sier fra når bom-andelen er for høy', () => {
		const many = Array.from({ length: MIN_SAMPLES_FOR_VERDICT }, (_, i) =>
			answered(1000, {
				toolSelection: selection({ called: ['query_economics'], missed: i % 2 === 0 ? ['query_economics'] : [] })
			})
		);
		expect(summarizeChatAnswers(many)!.summary).toContain('rett gruppene eller ordene før kuttet skrus på');
	});

	it('er null uten svar som har feltet', () => {
		expect(summarizeChatAnswers([answered(1000)])!.toolSelection).toBeNull();
	});
});
