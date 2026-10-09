/**
 * Henter modellaliaser fra Stemmegaffel og kaller OpenAI med dem. Reglene bor
 * rent i `$lib/domain/ai/model-alias.ts`; se `docs/changelog/2026-10-09-modellaliaser.md`.
 *
 * Laben står ALDRI i den kritiske stien:
 *
 *   - `STEMMEGAFFEL_URL` er bryteren. Uten den sendes kallene som før.
 *   - Svaret holdes i prosessen og hentes på nytt hvert kvarter, i bakgrunnen.
 *     Første kall venter høyst `FETCH_TIMEOUT_MS` på laben; svarer den ikke,
 *     brukes standarden og forsøket gjentas ved neste frist.
 *   - Avviser OpenAI en aliasforespørsel (400/404), kjøres samme kall om igjen
 *     med standarden, og aliaset settes til side i `REJECT_MS`. Et alias laben
 *     har målt kan likevel være feil for ett kallsted – et bilde i meldingen,
 *     et svarformat laben ikke prøvde – og det skal koste ett ekstra kall,
 *     ikke en feil hos brukeren.
 */
import { env } from '$env/dynamic/private';
import type OpenAI from 'openai';
import { openai } from '$lib/server/openai';
import {
	applyAlias,
	parseAliasPayload,
	resolveAlias,
	shouldFallBackFromAlias,
	type AliasPayload,
	type ModelAlias,
	type ResolvedAlias
} from '$lib/domain/ai/model-alias';

const REFRESH_MS = 15 * 60_000;
const FETCH_TIMEOUT_MS = 1500;
const REJECT_MS = 30 * 60_000;

interface Entry {
	payload: AliasPayload | null;
	reason: string;
	fetchedAt: number;
	rejectedUntil: number;
	pending: Promise<void> | null;
	/** Modellen vi sist logget at aliaset ga, så et bytte sies én gang. */
	logged: string | null;
}

const cache = new Map<ModelAlias, Entry>();

function baseUrl(): string | null {
	const url = env.STEMMEGAFFEL_URL?.trim();
	return url ? url.replace(/\/+$/, '') : null;
}

async function refresh(alias: ModelAlias, entry: Entry, base: string): Promise<void> {
	try {
		const res = await fetch(`${base}/api/v1/aliaser/${alias}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
		if (!res.ok) {
			entry.reason = `laben svarte ${res.status}`;
		} else {
			const payload = parseAliasPayload(await res.json());
			// Et ubrukelig svar visker ikke ut et godt vi har fra før.
			if (payload) entry.payload = payload;
			entry.reason = payload ? '' : 'laben svarte i en form vi ikke kjenner';
		}
	} catch (err) {
		entry.reason = `laben svarte ikke (${err instanceof Error ? err.name : 'ukjent feil'})`;
	} finally {
		entry.fetchedAt = Date.now();
		entry.pending = null;
	}
}

/** Modellen og formen aliaset gir nå. Kaster aldri. */
export async function resolveModelAlias(alias: ModelAlias): Promise<ResolvedAlias> {
	const base = baseUrl();
	if (!base) return resolveAlias(alias, null, 'STEMMEGAFFEL_URL er ikke satt');

	let entry = cache.get(alias);
	if (!entry) {
		entry = { payload: null, reason: '', fetchedAt: 0, rejectedUntil: 0, pending: null, logged: null };
		cache.set(alias, entry);
	}
	if (!entry.pending && Date.now() - entry.fetchedAt > REFRESH_MS) {
		entry.pending = refresh(alias, entry, base);
	}
	// Bare første gang venter vi; senere fornyes svaret mens det gamle brukes.
	if (entry.fetchedAt === 0 && entry.pending) await entry.pending;

	if (Date.now() < entry.rejectedUntil) return resolveAlias(alias, null, 'OpenAI avviste aliaset nylig');
	const resolved = resolveAlias(alias, entry.payload, entry.reason || undefined);
	const label = `${resolved.source}:${resolved.model}`;
	if (entry.logged !== label) {
		entry.logged = label;
		console.log(`[modell-alias] ${alias} → ${resolved.model} (${resolved.source}${resolved.reason ? `: ${resolved.reason}` : ''})`);
	}
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
		const entry = cache.get(alias);
		if (entry) entry.rejectedUntil = Date.now() + REJECT_MS;
		console.warn(`[modell-alias] ${alias}: OpenAI avviste ${resolved.model} (${status}); prøver standarden og setter aliaset til side i 30 min`);
		const fallback = applyAlias(body, resolveAlias(alias, null, 'avvist')) as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming;
		return openai.chat.completions.create(fallback);
	}
}

/** Bare for tester: tøm minnet mellom tilfeller. */
export function _resetModelAliasCache(): void {
	cache.clear();
}
