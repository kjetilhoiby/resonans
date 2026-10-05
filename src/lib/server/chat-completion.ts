import type OpenAI from 'openai';
import type {
	ChatCompletion,
	ChatCompletionCreateParamsNonStreaming
} from 'openai/resources/chat/completions';
import {
	completionSizing,
	shouldFallBackToChatModel,
	FALLBACK_CHAT_MODEL
} from '$lib/domain/ai/chat-model';

/**
 * Ett modellkall for hovedchatten: strømmet når noen lytter, med reserve når
 * OpenAI avviser forespørselen. Se
 * `docs/changelog/2026-10-05-coachen-smart-og-rask.md`.
 *
 * Klienten sendes inn framfor å importeres, så løkka kan testes med en falsk
 * klient (`chat-completion.test.ts`) — nettverket er ikke det som er
 * vanskelig her, rekkefølgen er.
 */

/** Kroker for å strømme modellsvaret videre til klienten. */
export interface ChatStreamHooks {
	/** Et nytt tekstbit fra modellen. */
	onDelta(token: string): void;
	/**
	 * Teksten som er strømmet så langt hører ikke til svaret: modellen sa noe
	 * («la meg sjekke …») og kalte så et verktøy. Svaret kommer i neste runde.
	 */
	onReset(): void;
}

/** Det vi trenger av OpenAI-klienten, så en test kan levere sin egen. */
export type ChatCompletionClient = {
	chat: {
		completions: Pick<OpenAI['chat']['completions'], 'create' | 'stream'>;
	};
};

/**
 * Avviser OpenAI forespørselen (ukjent modell, en parameter modellen ikke tar),
 * prøves den ÉN gang til med `FALLBACK_CHAT_MODEL` og de gamle parameterne, og
 * det logges som `[chat-model]`. Uten reserven ville en feilskrevet
 * `CHAT_DEFAULT_MODEL` eller en modell som forsvinner fra katalogen gjort hele
 * chatten død.
 *
 * **Reserven prøves bare før det første ordet er strømmet.** Har brukeren alt
 * sett tekst, ville et nytt forsøk skrevet et annet svar oppå det første.
 *
 * Strømmingen bruker SDK-ens `stream()`, som setter sammen verktøykallene selv.
 * Svaret som returneres er det samme `ChatCompletion` som før, så verktøyløkka
 * hos kalleren er uendret; strømmingen er en bieffekt for den som ser på.
 */
export async function createChatCompletionWithFallback(
	client: ChatCompletionClient,
	request: ChatCompletionCreateParamsNonStreaming,
	fallbackSizing: { temperature: number; maxTokens: number },
	options: { stream?: ChatStreamHooks | null; onFallback?: () => void } = {}
): Promise<ChatCompletion> {
	const hooks = options.stream ?? null;
	let emitted = false;

	const run = async (req: ChatCompletionCreateParamsNonStreaming): Promise<ChatCompletion> => {
		if (!hooks) return client.chat.completions.create(req);
		const stream = client.chat.completions.stream({ ...req, stream: true });
		// Uten en lytter kan en feil bli en ubehandlet hendelse; vi venter på
		// `finalChatCompletion()`, som kaster den samme feilen.
		stream.on('error', () => {});
		stream.on('content.delta', ({ delta }) => {
			if (!delta) return;
			emitted = true;
			hooks.onDelta(delta);
		});
		const completion = await stream.finalChatCompletion();
		if (emitted && completion.choices[0]?.message?.tool_calls?.length) {
			hooks.onReset();
			emitted = false;
		}
		return completion;
	};

	try {
		return await run(request);
	} catch (err) {
		const status = (err as { status?: number } | null)?.status;
		if (emitted || !shouldFallBackToChatModel(String(request.model), status)) throw err;
		console.warn(
			`[chat-model] ${request.model} avvist (${status}), prøver ${FALLBACK_CHAT_MODEL}:`,
			err instanceof Error ? err.message : err
		);
		options.onFallback?.();
		const {
			max_completion_tokens: _maxCompletionTokens,
			reasoning_effort: _reasoningEffort,
			verbosity: _verbosity,
			temperature: _temperature,
			max_tokens: _maxTokens,
			...rest
		} = request;
		return await run({
			...rest,
			model: FALLBACK_CHAT_MODEL,
			...completionSizing(FALLBACK_CHAT_MODEL, fallbackSizing)
		});
	}
}
