import type OpenAI from 'openai';
import type {
	ChatCompletion,
	ChatCompletionCreateParamsNonStreaming
} from 'openai/resources/chat/completions';
import {
	completionSizing,
	describeRejection,
	rejectedOptionalParams,
	shouldFallBackToChatModel,
	FALLBACK_CHAT_MODEL,
	type OptionalModelParam
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
 * Hva OpenAI har avvist, husket i prosessen.
 *
 * Første svarmåling i prod (5. oktober 2026): `gpt-5.4` avvist, reserven
 * svarte, og første ord kom etter 14,5 s — fordi HVER runde prøvde modellen
 * på nytt, ventet på avslaget og så gikk til reserven. Med én verktøyrunde er
 * det to avslag per melding, for alltid. Et avslag på en parameter eller en
 * modell er en egenskap ved konfigurasjonen, ikke ved meldingen, så det skal
 * betales ÉN gang per prosess (altså per deploy), ikke per runde.
 *
 * Med en tidsgrense (`ttlMs`), så en rettet konfigurasjon — eller en modell
 * som får parameteren senere — tas i bruk igjen uten restart.
 */
export class ModelRejectionMemory {
	#unsupported = new Map<string, { params: Set<OptionalModelParam>; until: number }>();
	#unusableUntil = new Map<string, number>();

	constructor(
		private readonly now: () => number = () => Date.now(),
		private readonly ttlMs = 30 * 60_000
	) {}

	unsupportedParams(model: string): Set<OptionalModelParam> {
		const entry = this.#unsupported.get(model);
		if (!entry || entry.until <= this.now()) return new Set();
		return entry.params;
	}

	markUnsupported(model: string, params: OptionalModelParam[]): void {
		const params2 = new Set([...this.unsupportedParams(model), ...params]);
		this.#unsupported.set(model, { params: params2, until: this.now() + this.ttlMs });
	}

	isUnusable(model: string): boolean {
		return (this.#unusableUntil.get(model) ?? 0) > this.now();
	}

	markUnusable(model: string): void {
		this.#unusableUntil.set(model, this.now() + this.ttlMs);
	}

	/** Forespørselen uten parameterne modellen har avvist. */
	strip(request: ChatCompletionCreateParamsNonStreaming): ChatCompletionCreateParamsNonStreaming {
		const drop = this.unsupportedParams(String(request.model));
		if (drop.size === 0) return request;
		const copy: Record<string, unknown> = { ...request };
		for (const p of drop) delete copy[p];
		return copy as unknown as ChatCompletionCreateParamsNonStreaming;
	}
}

const defaultMemory = new ModelRejectionMemory();

/**
 * Forsøksrekkefølgen når OpenAI avviser forespørselen (400/404), og bare før
 * det første ordet er strømmet:
 *
 * 1. **Samme modell uten den valgfrie parameteren** OpenAI navngir
 *    (`verbosity`, `reasoning_effort`), eller uten alle hvis den ikke sier
 *    hvilken. En parameter er verdt mindre enn modellen; det var nettopp den
 *    byttehandelen den første reserven gjorde feil vei.
 * 2. **`FALLBACK_CHAT_MODEL` med de gamle parameterne**, og modellen merkes
 *    ubrukelig så de neste rundene går rett hit.
 *
 * Hvert avslag rapporteres som et maskinnavn (`describeRejection`) til
 * `onRejection`, så målingen kan si HVA som ble avvist uten loggen. Uten
 * reserven ville en feilskrevet `CHAT_DEFAULT_MODEL` gjort chatten død.
 *
 * Har brukeren alt sett tekst, kastes feilen: et nytt forsøk ville skrevet et
 * annet svar oppå det første.
 *
 * Strømmingen bruker SDK-ens `stream()`, som setter sammen verktøykallene selv.
 * Svaret som returneres er det samme `ChatCompletion` som før, så verktøyløkka
 * hos kalleren er uendret; strømmingen er en bieffekt for den som ser på.
 */
export async function createChatCompletionWithFallback(
	client: ChatCompletionClient,
	request: ChatCompletionCreateParamsNonStreaming,
	fallbackSizing: { temperature: number; maxTokens: number },
	options: {
		stream?: ChatStreamHooks | null;
		/** Reserven tok over. `reason` er siste avslag, eller `husket` når modellen alt var merket. */
		onFallback?: (reason: string) => void;
		/** Et avslag, også når samme modell svarte etter at en parameter ble droppet. */
		onRejection?: (reason: string) => void;
		memory?: ModelRejectionMemory;
	} = {}
): Promise<ChatCompletion> {
	const hooks = options.stream ?? null;
	const memory = options.memory ?? defaultMemory;
	const model = String(request.model);
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

	const isRejection = (err: unknown) =>
		!emitted && shouldFallBackToChatModel(model, (err as { status?: number } | null)?.status);

	let lastReason = 'husket';
	if (!(model !== FALLBACK_CHAT_MODEL && memory.isUnusable(model))) {
		let req = memory.strip(request);
		try {
			return await run(req);
		} catch (err) {
			if (!isRejection(err)) throw err;
			lastReason = describeRejection(err as Record<string, unknown>);
			options.onRejection?.(lastReason);
			console.warn(`[chat-model] ${model} avvist (${lastReason})`);

			const drop = rejectedOptionalParams(err as Record<string, unknown>, req as unknown as Record<string, unknown>);
			if (drop.length > 0) {
				memory.markUnsupported(model, drop);
				req = memory.strip(request);
				try {
					return await run(req);
				} catch (err2) {
					if (!isRejection(err2)) throw err2;
					lastReason = describeRejection(err2 as Record<string, unknown>);
					options.onRejection?.(lastReason);
					console.warn(`[chat-model] ${model} avvist også uten ${drop.join(', ')} (${lastReason})`);
				}
			}
			memory.markUnusable(model);
		}
	}

	console.warn(`[chat-model] ${model} → ${FALLBACK_CHAT_MODEL} (${lastReason})`);
	options.onFallback?.(lastReason);
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
