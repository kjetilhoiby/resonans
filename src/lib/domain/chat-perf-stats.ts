/**
 * Fra én logglinje per melding til et svar på «hva skal vi cache».
 *
 * ## Hvorfor aggregering, og ikke bare logglinja
 *
 * `[chat-perf]` har logget én linje per melding siden 2. september 2026, og
 * den er riktig for å se på ÉN melding. Men spørsmålet som faktisk står — hvor
 * går tida i chat-pipelinen, og hva er verdt å cache — besvares av fordelingen
 * over mange meldinger. En enkelt linje kan være et uhell; medianen kan ikke.
 *
 * Målingen lagres derfor, ikke bare logges. Ringbufferen tømmes ved restart,
 * og restart er hyppig (hver push) — så den evige logglinja var i praksis et
 * vindu på noen timer, som krevde admin-secret å lese.
 *
 * ## PERSENTILER, aldri snitt
 *
 * Samme lærdom som `worst` i `host-metrics.ts`, og den er dyrekjøpt: Coolifys
 * minnegraf viste 78 % under en hendelse der OOM-killeren fyrte tre ganger,
 * fordi den glattet. Et snitt over chat-målinger ville skjult nøyaktig den
 * halen brukeren faktisk kjenner.
 *
 * Per fase gir MEDIANEN normalkostnaden — det er den en cache fjerner — og
 * MAKS det verste tilfellet. En fase med lav median og høy maks er et annet
 * problem enn en med høy median: den første er en utligger å forstå, den andre
 * er arbeid å fjerne.
 *
 * ## `wall` mot `sum` er parallelliseringens helse
 *
 * Fasene i parallellbatchen overlapper, så `sum` er samlet DB-arbeid mens
 * `wall` er tiden brukeren ventet. `wall` langt under `sum` betyr at
 * parallelliseringen gjør jobben sin. `wall` ≈ største enkeltfase betyr at
 * neste forbedring er å gjøre nettopp den fasen billigere — og DA er en cache
 * det riktige grepet.
 */

import {
	TOOL_GROUP_MAP,
	TOOL_GROUPS,
	TOOL_SELECTION_MODES,
	type ToolGroup,
	type ToolSelectionMode
} from '$lib/domain/ai/tool-selection';

export interface PhaseSample {
	name: string;
	ms: number;
}

export interface ChatPerfSample {
	wallMs: number;
	phases: PhaseSample[];
	/**
	 * Selve svaret, målt fra samme klokke som `wallMs`. Fram til oktober 2026
	 * stoppet målingen ved FØRSTE modellkall, så «raskere» etter et modellbytte
	 * kunne ikke etterprøves: kontekstfasen var målt, modelltiden ikke, og
	 * hvilken modell som faktisk svarte (reserven inkludert) sto bare i loggen.
	 * `null` for meldinger som feilet før svaret, og for rader fra før feltet.
	 */
	answer?: ChatAnswerSample | null;
}

export interface ChatAnswerSample {
	/** Modellen OpenAI sier svarte (`completion.model`), gjennom `sanitizeModelName`. */
	model: string;
	/** Fram til første strømmede ord. `null` når svaret ikke ble strømmet. */
	firstTokenMs: number | null;
	/** Fram til det ferdige svaret. */
	totalMs: number;
	/** Antall verktøyrunder etter førsterunden. */
	toolRounds: number;
	/** Reserven (`gpt-4o`) tok over etter et avslag. */
	fallback: boolean;
	streamed: boolean;
	/**
	 * Siste avslag fra OpenAI (`400:unsupported_parameter:verbosity`), også
	 * når samme modell svarte etter at en parameter ble droppet. `null` uten
	 * avslag.
	 */
	rejection?: string | null;
	/**
	 * Samlet tid i modellkallene (alle runder). `totalMs − wallMs − modelMs`
	 * er verktøyene og resten. Fra OpenAIs `usage`: største prompt (den vokser
	 * med verktøysvarene), og svar- og tenketokens summert over rundene.
	 * `null` på rader fra før feltene fantes.
	 */
	modelMs?: number | null;
	promptTokens?: number | null;
	completionTokens?: number | null;
	reasoningTokens?: number | null;
	/**
	 * Prompt-tokens SUMMERT over kallene, og hvor mange av dem OpenAI hentet fra
	 * prompt-cachen. Andelen er det som avgjør om en stor prompt koster tid.
	 */
	promptTokensTotal?: number | null;
	cachedTokens?: number | null;
	/** Størrelsen på promptens blokker i tegn, navngitt fra `PROMPT_PART_NAMES`. */
	promptParts?: PromptPart[] | null;
	/** Verktøyutvalget og om det bommet. `null` når ingen verktøy ble sendt. */
	toolSelection?: ToolSelectionSample | null;
}

/**
 * Hvordan verktøyutvalget gikk for ett svar (`$lib/domain/ai/tool-selection.ts`).
 * Alle navn er maskinnavn fra kartet; `parseToolSelection` slipper ingenting
 * annet gjennom, siden kolonnen er jsonb og målingen står på et åpent endepunkt.
 */
export interface ToolSelectionSample {
	mode: ToolSelectionMode;
	groups: ToolGroup[];
	sources: { routing: ToolGroup[]; theme: ToolGroup[]; recent: ToolGroup[]; image: ToolGroup[] };
	/** Verktøy i utvalget, og alle verktøyene som finnes. */
	selected: number;
	total: number;
	/** Verktøyene modellen kalte, og de av dem som IKKE var i utvalget. */
	called: string[];
	missed: string[];
	/** Grupper modellen hentet selv med `load_tools`. */
	loaded: ToolGroup[];
}

function knownGroups(raw: unknown): ToolGroup[] {
	return Array.isArray(raw) ? TOOL_GROUPS.filter((g) => raw.includes(g)) : [];
}

function knownTools(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	return [...new Set(raw.filter((n): n is string => typeof n === 'string' && Object.hasOwn(TOOL_GROUP_MAP, n)))];
}

export function parseToolSelection(raw: unknown): ToolSelectionSample | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	if (!(TOOL_SELECTION_MODES as readonly string[]).includes(r.mode as string)) return null;
	const selected = finiteOrNull(r.selected);
	const total = finiteOrNull(r.total);
	if (selected == null || total == null) return null;
	const src = (r.sources && typeof r.sources === 'object' ? r.sources : {}) as Record<string, unknown>;
	return {
		mode: r.mode as ToolSelectionMode,
		groups: knownGroups(r.groups),
		sources: {
			routing: knownGroups(src.routing),
			theme: knownGroups(src.theme),
			recent: knownGroups(src.recent),
			image: knownGroups(src.image)
		},
		selected,
		total,
		called: knownTools(r.called),
		missed: knownTools(r.missed),
		loaded: knownGroups(r.loaded)
	};
}

export interface PromptPart {
	name: PromptPartName;
	chars: number;
}

/**
 * Blokkene i hovedchattens prompt. Navnene er kode-literaler; `parsePromptParts`
 * slipper bare disse gjennom, siden kolonnen er jsonb og målingen ligger på et
 * åpent endepunkt.
 */
export const PROMPT_PART_NAMES = [
	'verktøy',
	'grunnprompt',
	'prefiks',
	'minne',
	'personer',
	'mål',
	'sjekklister',
	'kontakter',
	'fremgangsmåter',
	'kilde',
	'dato',
	'dag',
	'ferie',
	'helse',
	'historikk',
	'melding'
] as const;
export type PromptPartName = (typeof PROMPT_PART_NAMES)[number];

export function parsePromptParts(raw: unknown): PromptPart[] | null {
	if (!Array.isArray(raw)) return null;
	const out: PromptPart[] = [];
	for (const item of raw) {
		if (!item || typeof item !== 'object') continue;
		const { name, chars } = item as Record<string, unknown>;
		if (!(PROMPT_PART_NAMES as readonly string[]).includes(name as string)) continue;
		if (typeof chars !== 'number' || !Number.isFinite(chars) || chars < 0) continue;
		out.push({ name: name as PromptPartName, chars });
	}
	return out;
}

/** Avslaget er bygd av `describeRejection`; ved lesing vaskes det på nytt. */
export function sanitizeRejection(raw: unknown): string | null {
	return typeof raw === 'string' && /^[a-z0-9_.:-]{1,124}$/.test(raw) ? raw : null;
}

/**
 * Modellnavnet går ut på et ÅPENT endepunkt, og `preferredModel` kommer fra
 * klienten. Et navn er et maskinnavn (`gpt-5.4-2026-03-05`); alt annet blir
 * `annet` framfor å bli speilet tilbake.
 */
export function sanitizeModelName(raw: unknown): string {
	return typeof raw === 'string' && /^[a-z0-9][a-z0-9.\-]{0,47}$/i.test(raw) ? raw : 'annet';
}

/** Leser svarfeltene fra rad-kolonnene; `null` når raden er fra før de fantes. */
export function parseAnswer(row: {
	model: unknown;
	firstTokenMs: unknown;
	totalMs: unknown;
	toolRounds: unknown;
	fallback: unknown;
	streamed: unknown;
	rejection?: unknown;
	modelMs?: unknown;
	promptTokens?: unknown;
	completionTokens?: unknown;
	reasoningTokens?: unknown;
	promptTokensTotal?: unknown;
	cachedTokens?: unknown;
	promptParts?: unknown;
	toolSelection?: unknown;
}): ChatAnswerSample | null {
	if (typeof row.totalMs !== 'number' || !Number.isFinite(row.totalMs)) return null;
	return {
		model: sanitizeModelName(row.model),
		firstTokenMs:
			typeof row.firstTokenMs === 'number' && Number.isFinite(row.firstTokenMs) ? row.firstTokenMs : null,
		totalMs: row.totalMs,
		toolRounds: typeof row.toolRounds === 'number' && Number.isFinite(row.toolRounds) ? row.toolRounds : 0,
		fallback: row.fallback === true,
		streamed: row.streamed === true,
		rejection: sanitizeRejection(row.rejection),
		modelMs: finiteOrNull(row.modelMs),
		promptTokens: finiteOrNull(row.promptTokens),
		completionTokens: finiteOrNull(row.completionTokens),
		reasoningTokens: finiteOrNull(row.reasoningTokens),
		promptTokensTotal: finiteOrNull(row.promptTokensTotal),
		cachedTokens: finiteOrNull(row.cachedTokens),
		promptParts: parsePromptParts(row.promptParts),
		toolSelection: parseToolSelection(row.toolSelection)
	};
}

function finiteOrNull(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Fasene slik de kommer ut av jsonb, formet gjennom en hviteliste.
 *
 * Navnene er kode-literaler (`perf.timed('helsebriefing', …)`), så de bærer
 * ingen brukerdata — men kolonnen er en generell jsonb-beholder, og et lagret
 * felt noen legger til senere skal ikke følge med ut av seg selv. Samme regel
 * som `toPublicCronRun`: bygg objektet felt for felt.
 */
export function parsePhases(raw: unknown): PhaseSample[] {
	if (!Array.isArray(raw)) return [];
	const out: PhaseSample[] = [];
	for (const item of raw) {
		if (!item || typeof item !== 'object') continue;
		const { name, ms } = item as Record<string, unknown>;
		if (typeof name !== 'string' || typeof ms !== 'number' || !Number.isFinite(ms)) continue;
		out.push({ name, ms });
	}
	return out;
}

/**
 * Nærmeste-rang-persentil.
 *
 * Ikke interpolerende: med få målinger er en interpolert verdi et tall som
 * ikke ble målt, og det er verre enn et som ble. `p(1)` er derfor alltid en
 * ekte observasjon.
 */
export function percentile(sorted: number[], p: number): number | null {
	if (sorted.length === 0) return null;
	const rank = Math.ceil(p * sorted.length);
	return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

export interface PhaseStats {
	name: string;
	/** Hvor mange meldinger fasen ble målt i. */
	samples: number;
	medianMs: number;
	p95Ms: number;
	maxMs: number;
}

export interface ChatPerfStats {
	samples: number;
	wall: { medianMs: number; p95Ms: number; maxMs: number } | null;
	/** Samlet DB-arbeid per melding — median. */
	sumMedianMs: number | null;
	/**
	 * `wall / sum` ved medianen. Lavt tall = parallelliseringen virker.
	 * Nær 1 = fasene kjører i praksis etter hverandre.
	 */
	parallelismRatio: number | null;
	/** Tyngste fase først — den man skal se på står da alltid samme sted. */
	phases: PhaseStats[];
	/** Hva tallene betyr, med forbeholdene. */
	summary: string;
	/** Selve svaret: tid til første ord, total tid, modell. `null` uten målinger. */
	answer: ChatAnswerStats | null;
}

export interface DurationStats {
	medianMs: number;
	p95Ms: number;
	maxMs: number;
}

export interface ChatAnswerStats {
	samples: number;
	/** Bare over strømmede svar — et ikke-strømmet svar har ingen «første ord». */
	firstToken: DurationStats | null;
	total: DurationStats;
	/** Hvilke modeller som faktisk svarte, flest først. */
	byModel: { model: string; samples: number }[];
	fallbacks: number;
	/** Hva OpenAI avviste, flest først — svaret på «hvorfor svarte reserven». */
	rejections: { reason: string; samples: number }[];
	/** Median antall verktøyrunder. */
	toolRoundsMedian: number;
	/**
	 * Hvor tida i svaret går, som medianer over svarene som har feltene:
	 * modellkallene, og alt annet etter konteksten (verktøyene, lagring).
	 */
	split: {
		samples: number;
		modelMedianMs: number;
		otherMedianMs: number;
		promptTokensMedian: number | null;
		completionTokensMedian: number | null;
		reasoningTokensMedian: number | null;
		/** Median andel av prompt-tokens OpenAI hentet fra cachen (0–1). */
		cachedShareMedian: number | null;
		/** Median tegn per promptblokk, største først. */
		promptParts: { name: PromptPartName; medianChars: number }[];
	} | null;
	/** Verktøyutvalgets treffsikkerhet. `null` uten svar som har feltet. */
	toolSelection: ToolSelectionStats | null;
	summary: string;
}

export interface ToolSelectionStats {
	samples: number;
	/** Svar der modellen kalte minst ett verktøy — nevneren i bom-andelen. */
	withToolCalls: number;
	/** Svar der minst ett kalt verktøy manglet i utvalget. */
	withMiss: number;
	/** `withMiss / withToolCalls`, avrundet til to desimaler. `null` uten verktøykall. */
	missRate: number | null;
	selectedMedian: number;
	total: number;
	/** Verktøyene som bommet oftest — de som mangler en gruppe eller et ord. */
	topMissed: { tool: string; samples: number }[];
	/** Grupper modellen hentet med `load_tools`, flest først. */
	loaded: { group: ToolGroup; samples: number }[];
	/** Hvor mange svar hvert signal bidro med en gruppe utover kjernen. */
	sources: { routing: number; theme: number; recent: number; image: number };
}

/** Bom-andelen kuttet kan skrus på under — se changeloggen, fase 6. */
export const MAX_MISS_RATE_FOR_CUT = 0.05;

function countBy<T extends string>(values: T[]): { key: T; samples: number }[] {
	const counts = new Map<T, number>();
	for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
	return [...counts.entries()]
		.map(([key, n]) => ({ key, samples: n }))
		.sort((a, b) => b.samples - a.samples || a.key.localeCompare(b.key));
}

export function summarizeToolSelection(answers: ChatAnswerSample[]): ToolSelectionStats | null {
	const rows = answers.map((a) => a.toolSelection).filter((t): t is ToolSelectionSample => Boolean(t));
	if (rows.length === 0) return null;
	const withCalls = rows.filter((r) => r.called.length > 0);
	const withMiss = withCalls.filter((r) => r.missed.length > 0);
	return {
		samples: rows.length,
		withToolCalls: withCalls.length,
		withMiss: withMiss.length,
		missRate: withCalls.length > 0 ? Math.round((withMiss.length / withCalls.length) * 100) / 100 : null,
		selectedMedian: medianOf(rows.map((r) => r.selected))!,
		total: Math.max(...rows.map((r) => r.total)),
		topMissed: countBy(rows.flatMap((r) => r.missed))
			.slice(0, 10)
			.map(({ key, samples }) => ({ tool: key, samples })),
		loaded: countBy(rows.flatMap((r) => r.loaded)).map(({ key, samples }) => ({ group: key, samples })),
		sources: {
			routing: rows.filter((r) => r.sources.routing.length > 0).length,
			theme: rows.filter((r) => r.sources.theme.length > 0).length,
			recent: rows.filter((r) => r.sources.recent.length > 0).length,
			image: rows.filter((r) => r.sources.image.length > 0).length
		}
	};
}

function describeToolSelection(t: ToolSelectionStats): string {
	const base = `verktøyutvalg: median ${t.selectedMedian} av ${t.total} verktøy`;
	if (t.missRate == null) return `${base}, ingen svar med verktøykall ennå`;
	const miss =
		`${t.withMiss} av ${t.withToolCalls} svar med verktøykall bommet (${Math.round(t.missRate * 100)} %)` +
		(t.topMissed.length > 0 ? `, oftest ${t.topMissed.slice(0, 3).map((m) => m.tool).join(', ')}` : '');
	// Dommen holdes tilbake under MIN_SAMPLES_FOR_VERDICT, som ellers.
	if (t.withToolCalls < MIN_SAMPLES_FOR_VERDICT) return `${base}; ${miss}`;
	return (
		`${base}; ${miss} — ` +
		(t.missRate <= MAX_MISS_RATE_FOR_CUT
			? 'lavt nok til å skru på kuttet'
			: `over ${Math.round(MAX_MISS_RATE_FOR_CUT * 100)} %: rett gruppene eller ordene før kuttet skrus på`)
	);
}

function durationStats(values: number[]): DurationStats | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	return {
		medianMs: percentile(sorted, 0.5)!,
		p95Ms: percentile(sorted, 0.95)!,
		maxMs: sorted[sorted.length - 1]
	};
}

export function summarizeChatAnswers(samples: ChatPerfSample[]): ChatAnswerStats | null {
	const answers = samples.map((s) => s.answer).filter((a): a is ChatAnswerSample => Boolean(a));
	if (answers.length === 0) return null;

	const total = durationStats(answers.map((a) => a.totalMs))!;
	const firstToken = durationStats(
		answers.filter((a) => a.streamed && a.firstTokenMs != null).map((a) => a.firstTokenMs!)
	);

	const counts = new Map<string, number>();
	for (const a of answers) counts.set(a.model, (counts.get(a.model) ?? 0) + 1);
	const byModel = [...counts.entries()]
		.map(([model, n]) => ({ model, samples: n }))
		.sort((a, b) => b.samples - a.samples || a.model.localeCompare(b.model));

	const fallbacks = answers.filter((a) => a.fallback).length;
	const rejectionCounts = new Map<string, number>();
	for (const a of answers) {
		if (a.rejection) rejectionCounts.set(a.rejection, (rejectionCounts.get(a.rejection) ?? 0) + 1);
	}
	const rejections = [...rejectionCounts.entries()]
		.map(([reason, n]) => ({ reason, samples: n }))
		.sort((a, b) => b.samples - a.samples || a.reason.localeCompare(b.reason));
	const toolRoundsMedian = percentile(
		answers.map((a) => a.toolRounds).sort((a, b) => a - b),
		0.5
	)!;

	const split = summarizeSplit(samples);
	const toolSelection = summarizeToolSelection(answers);

	const parts = [
		`${answers.length} svar: ` +
			(firstToken ? `første ord etter median ${firstToken.medianMs} ms (p95 ${firstToken.p95Ms}), ` : '') +
			`ferdig svar etter median ${total.medianMs} ms (p95 ${total.p95Ms})`
	];
	parts.push(`modell: ${byModel.map((m) => `${m.model} ×${m.samples}`).join(', ')}`);
	if (fallbacks > 0) {
		// Reserven er en sikring, ikke en modus. Står den i tallene, ble
		// standardmodellen avvist — og det er en konfigurasjonsfeil å rette.
		parts.push(`reserven svarte ${fallbacks} gang${fallbacks === 1 ? '' : 'er'} — standardmodellen ble avvist`);
	}
	if (rejections.length > 0) {
		parts.push(`avslag: ${rejections.map((r) => `${r.reason} ×${r.samples}`).join(', ')}`);
	}
	if (split) {
		parts.push(
			`av svartida er median ${split.modelMedianMs} ms modellkall og ${split.otherMedianMs} ms verktøy og annet` +
				(split.reasoningTokensMedian != null ? `; ${split.reasoningTokensMedian} tenketokens per svar` : '') +
				(split.cachedShareMedian != null
					? `; ${Math.round(split.cachedShareMedian * 100)} % av prompten fra cachen`
					: '')
		);
		const biggest = split.promptParts[0];
		if (biggest) {
			parts.push(`største promptblokk er «${biggest.name}» med median ${biggest.medianChars} tegn`);
		}
	}
	if (toolSelection) parts.push(describeToolSelection(toolSelection));
	if (answers.length < MIN_SAMPLES_FOR_VERDICT) {
		parts.push(`for få til et mønster (trengs ${MIN_SAMPLES_FOR_VERDICT})`);
	}

	return {
		samples: answers.length,
		firstToken,
		total,
		byModel,
		fallbacks,
		rejections,
		toolRoundsMedian,
		split,
		toolSelection,
		summary: parts.join('; ') + '.'
	};
}

/**
 * Under dette er utvalget for lite til å si noe om en median.
 *
 * Samme begrunnelse som `MIN_OBSERVATIONS` i sultprediksjonen: en median av
 * tre målinger er en gjetning med selvtillit, og et cache-grep tatt på den
 * kan fjerne arbeid som ikke var problemet.
 */
export const MIN_SAMPLES_FOR_VERDICT = 20;

/** Over dette er en fase verdt å se på uansett hva resten gjør. */
export const SLOW_PHASE_MS = 300;

export function summarizeChatPerf(samples: ChatPerfSample[]): ChatPerfStats {
	if (samples.length === 0) {
		return {
			samples: 0,
			wall: null,
			sumMedianMs: null,
			parallelismRatio: null,
			phases: [],
			summary: 'Ingen målinger i vinduet.',
			answer: null
		};
	}

	const walls = samples.map((s) => s.wallMs).sort((a, b) => a - b);
	const sums = samples
		.map((s) => s.phases.reduce((acc, p) => acc + p.ms, 0))
		.sort((a, b) => a - b);

	const byName = new Map<string, number[]>();
	for (const s of samples) {
		for (const p of s.phases) {
			const arr = byName.get(p.name);
			if (arr) arr.push(p.ms);
			else byName.set(p.name, [p.ms]);
		}
	}

	const phases: PhaseStats[] = [...byName.entries()]
		.map(([name, msList]) => {
			const sorted = [...msList].sort((a, b) => a - b);
			return {
				name,
				samples: sorted.length,
				medianMs: percentile(sorted, 0.5)!,
				p95Ms: percentile(sorted, 0.95)!,
				maxMs: sorted[sorted.length - 1]
			};
		})
		.sort((a, b) => b.medianMs - a.medianMs);

	const wallMedian = percentile(walls, 0.5)!;
	const sumMedian = percentile(sums, 0.5)!;
	const ratio = sumMedian > 0 ? wallMedian / sumMedian : null;

	return {
		samples: samples.length,
		wall: { medianMs: wallMedian, p95Ms: percentile(walls, 0.95)!, maxMs: walls[walls.length - 1] },
		sumMedianMs: sumMedian,
		parallelismRatio: ratio == null ? null : Math.round(ratio * 100) / 100,
		phases,
		summary: describe(samples.length, wallMedian, sumMedian, ratio, phases),
		answer: summarizeChatAnswers(samples)
	};
}

function describe(
	n: number,
	wallMedian: number,
	sumMedian: number,
	ratio: number | null,
	phases: PhaseStats[]
): string {
	if (n < MIN_SAMPLES_FOR_VERDICT) {
		// Tallene sies, dommen holdes tilbake — som `describeWeeklyIntensity`.
		return (
			`${n} målinger: median ${wallMedian} ms ventetid, ${sumMedian} ms samlet arbeid. ` +
			`For få til å si noe om mønsteret (trengs ${MIN_SAMPLES_FOR_VERDICT}).`
		);
	}

	const parts = [`${n} målinger: median ${wallMedian} ms ventetid, ${sumMedian} ms samlet arbeid`];

	if (ratio != null && ratio < 0.6) {
		parts.push(`parallelliseringen virker (wall er ${Math.round(ratio * 100)} % av sum)`);
	} else if (ratio != null) {
		parts.push(
			`fasene kjører nærmest etter hverandre (wall er ${Math.round(ratio * 100)} % av sum) — ` +
				'se på om de faktisk startes parallelt før du cacher noe'
		);
	}

	const worst = phases[0];
	if (worst && worst.medianMs >= SLOW_PHASE_MS) {
		parts.push(
			`tyngste fase er «${worst.name}» med median ${worst.medianMs} ms ` +
				`(p95 ${worst.p95Ms}, maks ${worst.maxMs}) — der ligger gevinsten`
		);
	} else if (worst) {
		parts.push(
			`tyngste fase er «${worst.name}» med median ${worst.medianMs} ms, altså under ` +
				`${SLOW_PHASE_MS} ms: ingen fase peker seg ut som cache-kandidat`
		);
	}

	return parts.join('; ') + '.';
}

function medianOf(values: number[]): number | null {
	if (values.length === 0) return null;
	return percentile([...values].sort((a, b) => a - b), 0.5);
}

/**
 * Tida i svaret, delt i modellkall og resten. Bare svar med `modelMs` teller,
 * så rader fra før feltet ikke drar medianen mot null.
 */
function summarizeSplit(samples: ChatPerfSample[]): ChatAnswerStats['split'] {
	const rows = samples.filter(
		(s): s is ChatPerfSample & { answer: ChatAnswerSample & { modelMs: number } } =>
			s.answer?.modelMs != null
	);
	if (rows.length === 0) return null;
	const nums = (pick: (a: ChatAnswerSample) => number | null | undefined) =>
		rows.map((r) => pick(r.answer)).filter((v): v is number => typeof v === 'number');
	return {
		samples: rows.length,
		modelMedianMs: medianOf(rows.map((r) => r.answer.modelMs))!,
		otherMedianMs: medianOf(rows.map((r) => Math.max(0, r.answer.totalMs - r.wallMs - r.answer.modelMs)))!,
		promptTokensMedian: medianOf(nums((a) => a.promptTokens)),
		completionTokensMedian: medianOf(nums((a) => a.completionTokens)),
		reasoningTokensMedian: medianOf(nums((a) => a.reasoningTokens)),
		cachedShareMedian: medianOf(
			rows
				.map((r) => r.answer)
				.filter((a) => (a.promptTokensTotal ?? 0) > 0 && a.cachedTokens != null)
				.map((a) => Math.round((a.cachedTokens! / a.promptTokensTotal!) * 100) / 100)
		),
		promptParts: summarizePromptParts(rows.map((r) => r.answer.promptParts ?? []))
	};
}

function summarizePromptParts(perAnswer: PromptPart[][]): { name: PromptPartName; medianChars: number }[] {
	const byName = new Map<PromptPartName, number[]>();
	for (const parts of perAnswer) {
		for (const p of parts) {
			const list = byName.get(p.name);
			if (list) list.push(p.chars);
			else byName.set(p.name, [p.chars]);
		}
	}
	return [...byName.entries()]
		.map(([name, list]) => ({ name, medianChars: medianOf(list)! }))
		.sort((a, b) => b.medianChars - a.medianChars);
}
