/**
 * Modellvalget for hovedchatten (`/api/chat`). Se
 * `docs/changelog/2026-10-05-coachen-smart-og-rask.md`.
 *
 * Fram til oktober 2026 svarte «Auto» med `gpt-4o-mini`, og et regex-sett
 * («sammenlign|analyse|plan …») løftet enkelte meldinger til `gpt-4o`. Runden
 * ETTER et verktøykall brukte samme heuristikk og ignorerte brukerens eget
 * valg, så selv med 5.4 valgt ble svaret som faktisk leses, det som kommer etter
 * at tallene er hentet, skrevet av mini. Coachen ble sammenlignet med
 * chatgpt.com og tapte, og brukeren limte inn skjermbilder fra Resonans i
 * ChatGPT framfor å spørre Resonans.
 *
 * Nå: ett standardvalg for alle runder (`CHAT_DEFAULT_MODEL`, default
 * `gpt-5.4`), og brukerens eksplisitte valg gjelder også etter verktøyene.
 * `legacy` gir den gamle heuristikken tilbake uten en deploy.
 */

export const DEFAULT_CHAT_MODEL = 'gpt-5.4';
/** Modellen vi faller tilbake på når OpenAI avviser modellen eller parametrene. */
export const FALLBACK_CHAT_MODEL = 'gpt-4o';
/** Verdi for `CHAT_DEFAULT_MODEL` som gir heuristikken fra før oktober 2026. */
export const LEGACY_CHAT_MODEL_MODE = 'legacy';

/**
 * Reasoning-tokens teller mot `max_completion_tokens`. Et tak på 1000, som
 * det gamle, kan da gå med til tenkingen og gi et tomt svar. Lengden styres av
 * prompten («lengden følger spørsmålet»), taket er bare en sikring.
 */
export const REASONING_TOKEN_FLOOR = 4000;

const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high'] as const;
export type ChatReasoningEffort = (typeof REASONING_EFFORTS)[number];
/** Lav innsats: fart er halve poenget, og et coachsvar er sjelden et matteproblem. */
export const DEFAULT_REASONING_EFFORT: ChatReasoningEffort = 'low';

export interface ChatModelInput {
	phase: 'initial' | 'followup';
	/** Brukerens eksplisitte valg (modellknappen). Tom/`auto` = ingen. */
	preferredModel?: string | null;
	/** Råverdien av `CHAT_DEFAULT_MODEL`. */
	configuredDefault?: string | null;
	hasImage: boolean;
	userInput: string;
	toolCallCount?: number;
	toolRound?: number;
	/** Kallet sender verktøy. En modell som ikke kan kalle dem over Chat Completions, velges ikke. */
	withTools?: boolean;
}

export interface ChatModelDecision {
	model: string;
	reason: string;
}

export function resolveDefaultChatModel(configured: string | null | undefined): string {
	const value = configured?.trim();
	return value ? value : DEFAULT_CHAT_MODEL;
}

export function isLegacyChatModelMode(configured: string | null | undefined): boolean {
	return resolveDefaultChatModel(configured) === LEGACY_CHAT_MODEL_MODE;
}

export function chooseChatModel(input: ChatModelInput): ChatModelDecision {
	const decision = chooseChatModelIgnoringTools(input);
	if (input.withTools && chatCompletionsToolSupport(decision.model) === 'none') {
		return { model: DEFAULT_CHAT_MODEL, reason: `tools_unsupported:${decision.model}` };
	}
	return decision;
}

function chooseChatModelIgnoringTools(input: ChatModelInput): ChatModelDecision {
	const preferred = input.preferredModel?.trim();
	if (preferred && preferred !== 'auto') {
		return { model: preferred, reason: 'user_preferred_model' };
	}

	const configured = resolveDefaultChatModel(input.configuredDefault);
	if (configured !== LEGACY_CHAT_MODEL_MODE) {
		return { model: configured, reason: `default_${input.phase}` };
	}

	return chooseLegacyChatModel(input);
}

/** Heuristikken fra før oktober 2026, uendret. Nås bare med `CHAT_DEFAULT_MODEL=legacy`. */
function chooseLegacyChatModel(input: ChatModelInput): ChatModelDecision {
	const normalizedInput = input.userInput.toLowerCase();
	const isTimeSensitiveQuestion = /nyhet|nyheter|siste|oppdatering|aktuelt|aktuell|krig|konflikt|valg|politikk|børs|marked/.test(normalizedInput);
	const isComparisonOrPlanning = /sammenlign|analyse|strategi|plan|vei opp|fordeler|ulemper|hva bør jeg/.test(normalizedInput);

	if (input.hasImage) return { model: 'gpt-4o', reason: 'image_input' };

	if (input.phase === 'initial') {
		if (isTimeSensitiveQuestion) return { model: 'gpt-4o', reason: 'time_sensitive_question' };
		if (isComparisonOrPlanning) return { model: 'gpt-4o', reason: 'complex_reasoning_prompt' };
		return { model: 'gpt-4o-mini', reason: 'default_fast_path' };
	}

	if ((input.toolCallCount ?? 0) >= 3 && (input.toolRound ?? 0) <= 1) {
		return { model: 'gpt-4o', reason: 'high_tool_fanout_followup' };
	}
	return { model: 'gpt-4o-mini', reason: 'default_followup_fast_path' };
}

/**
 * gpt-5 og nyere, og o-seriene: ingen `temperature`, `max_completion_tokens`,
 * `reasoning_effort`. Mønsteret var `^gpt-5` fram til oktober 2026, så
 * `gpt-6-luna` ville fått `temperature` + `max_tokens` og blitt avvist.
 */
export function isReasoningChatModel(model: string): boolean {
	return /^(gpt-(?:[5-9]|[1-9]\d)|o\d)/.test(model);
}

/**
 * Kan modellen kalle verktøy over Chat Completions, som chatten bruker?
 *
 * GPT-6-familien (oktober 2026) er bygget for Responses-API-et. Ifølge
 * modellsidene hos OpenAI: Sol og Astra kaller ALDRI verktøy over Chat
 * Completions, og Luna gjør det bare med `reasoning_effort: 'none'`. En modell
 * som får verktøy den ikke kan bruke, avvises med 400 — og reserven er
 * `gpt-4o`, altså et dårligere svar enn standardmodellen ville gitt.
 *
 * gpt-5.x (5.1 og nyere) har samme grense som Luna. Første svarmåling
 * (5. oktober 2026) ga `400::reasoning_effort` på gpt-5.4 med verktøy, og
 * fase 4 målte 0 tenketokens etter at parameteren ble droppet: coachen har
 * aldri tenkt mens den hadde verktøy. Fram til 8. oktober ble grensa oppdaget
 * ved avslag, og avslaget huskes bare 30 minutter per prosess — med en bruker
 * som chatter sjeldnere enn det, og en deploy per push, betalte nesten hver
 * første melding et ekstra kall. Nå sendes `none` med en gang. Resonnering
 * OG verktøy krever Responses-API-et; se fremdriftsplanen, spor 1.
 */
export type ChatToolSupport = 'full' | 'none' | 'without-reasoning';

export function chatCompletionsToolSupport(model: string): ChatToolSupport {
	if (/^gpt-6(?:\.\d+)?-(?:sol|astra)\b/.test(model)) return 'none';
	if (/^gpt-6(?:\.\d+)?-luna\b/.test(model)) return 'without-reasoning';
	if (/^gpt-5\.\d/.test(model)) return 'without-reasoning';
	return 'full';
}

export function resolveReasoningEffort(configured: string | null | undefined): ChatReasoningEffort {
	const value = configured?.trim().toLowerCase();
	return (REASONING_EFFORTS as readonly string[]).includes(value ?? '')
		? (value as ChatReasoningEffort)
		: DEFAULT_REASONING_EFFORT;
}

const VERBOSITIES = ['low', 'medium', 'high'] as const;
export type ChatVerbosity = (typeof VERBOSITIES)[number];
/**
 * Lav ordrikhet. Brukeren skrudde opp modellen i bøker og fikk «veldig lange
 * svar» — en sterkere modell skriver mer, ikke bedre, uten en grense. Prompten
 * sier «lengden følger spørsmålet»; dette er samme beskjed på API-nivå.
 */
export const DEFAULT_VERBOSITY: ChatVerbosity = 'low';

export function resolveVerbosity(configured: string | null | undefined): ChatVerbosity {
	const value = configured?.trim().toLowerCase();
	return (VERBOSITIES as readonly string[]).includes(value ?? '')
		? (value as ChatVerbosity)
		: DEFAULT_VERBOSITY;
}

/**
 * SDK-en (openai 6.7) kjenner ikke `none`, som GPT-6 Luna krever for å kalle
 * verktøy over Chat Completions. Den sender verdien uendret; typen ligger bare
 * etter API-et. Castet ved utgangen, så resten av koden ser den ekte mengden.
 */
type SdkReasoningEffort = Exclude<ChatReasoningEffort, 'none'>;

export type ChatCompletionSizing =
	| { max_completion_tokens: number; reasoning_effort: SdkReasoningEffort; verbosity: ChatVerbosity }
	| { temperature: number; max_tokens: number };

/**
 * Parameterne som avhenger av modellfamilien. En reasoning-modell avviser
 * `max_tokens` og en `temperature` utenom standard, så de to formene kan ikke
 * blandes — det var grunnen til at bare førsterunden hadde en gpt-5-gren.
 */
export function completionSizing(
	model: string,
	opts: {
		temperature: number;
		maxTokens: number;
		reasoningEffort?: ChatReasoningEffort;
		verbosity?: ChatVerbosity;
		/** Kallet sender verktøy — Luna tar dem da bare uten resonnering. */
		withTools?: boolean;
	}
): ChatCompletionSizing {
	if (isReasoningChatModel(model)) {
		const toolsForceNone = opts.withTools && chatCompletionsToolSupport(model) === 'without-reasoning';
		return {
			max_completion_tokens: Math.max(opts.maxTokens, REASONING_TOKEN_FLOOR),
			reasoning_effort: (toolsForceNone ? 'none' : (opts.reasoningEffort ?? DEFAULT_REASONING_EFFORT)) as SdkReasoningEffort,
			verbosity: opts.verbosity ?? DEFAULT_VERBOSITY
		};
	}
	return { temperature: opts.temperature, max_tokens: opts.maxTokens };
}

/**
 * Skal et feilet modellkall prøves på nytt med reservemodellen? Bare når
 * OpenAI avviste FORESPØRSELEN (ukjent modell, parameter den ikke tar), ikke
 * ved nettverksfeil eller 429 — da ville reserven bare doblet trykket.
 */
export function shouldFallBackToChatModel(model: string, status: number | undefined): boolean {
	if (model === FALLBACK_CHAT_MODEL) return false;
	return status === 400 || status === 404;
}

/**
 * Parametere vi sender til reasoning-modeller, men som modellen ikke MÅ ha.
 * Første svarmåling i prod (5. oktober 2026) viste at `gpt-5.4` ble avvist og
 * reserven `gpt-4o` svarte — og vi visste ikke hvorfor, for årsaken sto bare
 * i loggen. Er det én av disse som avvises, skal vi beholde modellen og miste
 * parameteren, ikke omvendt.
 */
export const OPTIONAL_MODEL_PARAMS = ['verbosity', 'reasoning_effort'] as const;
export type OptionalModelParam = (typeof OPTIONAL_MODEL_PARAMS)[number];

type RejectionLike = { status?: unknown; code?: unknown; param?: unknown } | null | undefined;

function token(value: unknown): string {
	return typeof value === 'string' || typeof value === 'number'
		? String(value).toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 40)
		: '';
}

/**
 * Avslaget som et maskinnavn: `400:unsupported_parameter:verbosity`. Bygd av
 * OpenAIs STRUKTURERTE felt, aldri av meldingsteksten — den kan i prinsippet
 * gjenta innhold, og målingen ligger på et åpent endepunkt.
 */
export function describeRejection(err: RejectionLike): string {
	return [token(err?.status), token(err?.code), token(err?.param)].join(':');
}

/**
 * Hvilke valgfrie parametere skal vi prøve uten? Navngir OpenAI parameteren,
 * bare den. Gjør den ikke det, alle vi sendte — vi vet ikke hvilken, og et
 * forsøk til er billigere enn å miste modellen.
 */
export function rejectedOptionalParams(
	err: RejectionLike,
	request: Record<string, unknown>
): OptionalModelParam[] {
	const sent = OPTIONAL_MODEL_PARAMS.filter((p) => request[p] !== undefined);
	const named = typeof err?.param === 'string' ? err.param : null;
	if (named) return sent.filter((p) => p === named);
	return sent;
}
