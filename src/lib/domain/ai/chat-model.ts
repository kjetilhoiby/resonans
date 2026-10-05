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

const REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high'] as const;
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

/** gpt-5-familien og o-seriene: ingen `temperature`, `max_completion_tokens`, `reasoning_effort`. */
export function isReasoningChatModel(model: string): boolean {
	return /^(gpt-5|o\d)/.test(model);
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

export type ChatCompletionSizing =
	| { max_completion_tokens: number; reasoning_effort: ChatReasoningEffort; verbosity: ChatVerbosity }
	| { temperature: number; max_tokens: number };

/**
 * Parameterne som avhenger av modellfamilien. En reasoning-modell avviser
 * `max_tokens` og en `temperature` utenom standard, så de to formene kan ikke
 * blandes — det var grunnen til at bare førsterunden hadde en gpt-5-gren.
 */
export function completionSizing(
	model: string,
	opts: { temperature: number; maxTokens: number; reasoningEffort?: ChatReasoningEffort; verbosity?: ChatVerbosity }
): ChatCompletionSizing {
	if (isReasoningChatModel(model)) {
		return {
			max_completion_tokens: Math.max(opts.maxTokens, REASONING_TOKEN_FLOOR),
			reasoning_effort: opts.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
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
