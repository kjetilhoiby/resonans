/**
 * Henter modellaliaser fra Stemmegaffel og kaller OpenAI med dem. Reglene bor
 * rent i `$lib/domain/ai/model-alias.ts`; se `docs/changelog/2026-10-09-modellaliaser.md`.
 *
 * Laben står ALDRI i den kritiske stien:
 *
 *   - `STEMMEGAFFEL_URL` er bryteren. Uten den brukes `ALIAS_DEFAULTS`.
 *   - Svaret holdes i prosessen og hentes på nytt hvert kvarter, i bakgrunnen.
 *     Første kall venter høyst `FETCH_TIMEOUT_MS` på laben; svarer den ikke,
 *     brukes standarden og forsøket gjentas ved neste frist.
 *   - Avviser OpenAI en aliasforespørsel (400/404), kjøres samme kall om igjen
 *     med standarden, og aliaset settes til side i `REJECT_MS`. Et alias laben
 *     har målt kan likevel være feil for ett kallsted – et bilde i meldingen,
 *     et svarformat laben ikke prøvde – og det skal koste ett ekstra kall,
 *     ikke en feil hos brukeren.
 */
import type OpenAI from 'openai';
import { _resetLabAliasCache, labAliasPayload, logAliasChoice } from '$lib/server/ai/lab-alias';
import { openai } from '$lib/server/openai';
import {
	applyAlias,
	parseAliasPayload,
	resolveAlias,
	shouldFallBackFromAlias,
	type ModelAlias,
	type ResolvedAlias
} from '$lib/domain/ai/model-alias';

const REJECT_MS = 30 * 60_000;

/** Når OpenAI sist avviste et alias: da brukes standarden en stund. */
const rejectedUntil = new Map<ModelAlias, number>();

/** Modellen og formen aliaset gir nå. Kaster aldri. */
export async function resolveModelAlias(alias: ModelAlias): Promise<ResolvedAlias> {
	const { payload, reason } = await labAliasPayload(alias, parseAliasPayload);
	if (Date.now() < (rejectedUntil.get(alias) ?? 0)) return resolveAlias(alias, null, 'OpenAI avviste aliaset nylig');
	const resolved = resolveAlias(alias, payload, reason || undefined);
	logAliasChoice(
		alias,
		`${resolved.source}:${resolved.model}`,
		`[modell-alias] ${alias} → ${resolved.model} (${resolved.source}${resolved.reason ? `: ${resolved.reason}` : ''})`
	);
	return resolved;
}

type Body = Omit<OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, 'model'>;

/**
 * `openai.chat.completions.create` med modellen fra aliaset. Kallstedet sender
 * det det alltid har sendt, bare uten `model`.
 */
export async function createWithAlias(alias: ModelAlias, body: Body): Promise<OpenAI.Chat.ChatCompletion> {
	const resolved = await resolveModelAlias(alias);
	const request = applyAlias(body, resolved) as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming;
	try {
		return await openai.chat.completions.create(request);
	} catch (err) {
		const status = (err as { status?: number })?.status;
		if (!shouldFallBackFromAlias(resolved.source, status)) throw err;
		rejectedUntil.set(alias, Date.now() + REJECT_MS);
		console.warn(`[modell-alias] ${alias}: OpenAI avviste ${resolved.model} (${status}); prøver standarden og setter aliaset til side i 30 min`);
		const fallback = applyAlias(body, resolveAlias(alias, null, 'avvist')) as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming;
		return openai.chat.completions.create(fallback);
	}
}

/** Bare for tester: tøm minnet mellom tilfeller. */
export function _resetModelAliasCache(): void {
	rejectedUntil.clear();
	_resetLabAliasCache();
}
