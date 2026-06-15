/**
 * Delt chat-tilstand for alle chat-kontekster i Resonans.
 *
 * Bruk:
 *   const chat = new ChatState({ conversationId: '...' });
 *   const chat = new ChatState({ getOrCreateConversationId: async () => '...' });
 */

import { streamProxyChat } from './proxy-chat-stream';
import type { WidgetDraft } from '$lib/artifacts/widget-draft';
import type { WidgetCreationFlow } from '$lib/flows/widget-creation/flow';
import type { WeatherStatusWidget } from '$lib/ai/tools/weather-forecast';
import type { PhotoAnnotationResult } from '$lib/ai/tools/annotate-photo';

export interface ChatAction {
	id: string;
	label: string;
	style?: 'primary' | 'secondary' | 'danger';
}

export interface ChatMessage {
	id: string;
	role: 'user' | 'assistant';
	text: string;
	starred: boolean;
	imageUrl?: string | null;
	attachment?: unknown;
	actions?: ChatAction[];
	widgetProposal?: WidgetDraft | null;
	widgetFlow?: WidgetCreationFlow | null;
	statusWidget?: WeatherStatusWidget | null;
	photoAnnotation?: PhotoAnnotationResult | null;
	photoAnnotationImageUrl?: string | null;
}

export interface ChatStateOptions {
	/** Kjent samtale-ID (f.eks. /samtaler, ThemePage). Kan oppdateres reaktivt. */
	conversationId?: string | null;
	/** Lazy oppretting av samtale-ID (f.eks. HomeScreen, FlowSheet, aktivitet). */
	getOrCreateConversationId?: () => Promise<string | null>;
	/** Valgfritt vedlegg som injiseres kun på første melding (f.eks. treningskontekst). */
	initialAttachment?: unknown;
	/** Foretrukket modell for denne konteksten. Kan være en funksjon som evalueres ved hvert kall. */
	preferredModel?: string | (() => string | undefined);
	/** System-prompt-prefiks. Kan være en funksjon som evalueres ved hvert kall. */
	systemPrompt?: string | (() => string | undefined);
	/** Kalles med hele complete-payloaden — for spesialbehandling per kontekst. */
	onPayload?: (data: Record<string, unknown>) => void | Promise<void>;
	/**
	 * Kalles rett etter at assistant-melding er laget, men FØR den legges til messages.
	 * Returner en modifisert melding, eller undefined for å bruke den uendret.
	 * Returnerer false for å forhindre at meldingen legges til (for manuell håndtering).
	 */
	onAssistantMessage?: (msg: ChatMessage, data: Record<string, unknown>) => ChatMessage | false | void;
	/** HomeScreen: AI har rutet meldingen til et tema. */
	onThemeRouted?: (theme: { themeId: string; themeName: string; confidence: string }) => void;
	/** HomeScreen: AI foreslår et tema. */
	onThemeSuggested?: (theme: { themeId: string; themeName: string; confidence: string; reasoning?: string }) => void;
	/** HomeScreen: AI har rutet til en bok. */
	onBookRouted?: (book: { bookId: string; bookTitle: string; themeId: string }) => void;
	/** Kalles etter at sjekklister er oppdatert (HomeScreen). */
	onChecklistChanged?: () => Promise<void>;
}

export class ChatState {
	messages = $state<ChatMessage[]>([]);
	loading = $state(false);
	streamingText = $state('');
	streamingSteps = $state<string[]>([]);
	stopped = $state(false);
	stoppedText = $state('');
	error = $state('');
	conversationId = $state<string | null>(null);

	lastUserText = $state('');
	lastUserMsgId = $state('');

	#pendingMessage: string | null = null;
	#abortController: AbortController | null = null;
	#isFirstMessage = true;
	#opts: ChatStateOptions;

	// Watchdog: avbryt en strøm som har vært stille for lenge (typisk en død
	// forbindelse etter at mobilen har bakgrunnet appen midt i et LLM-svar).
	#watchdog: ReturnType<typeof setTimeout> | null = null;
	#timedOut = false;
	/** Maks stillhet (ms) før strømmen regnes som tapt. Status-events og tokens nullstiller den.
	 *  Romslig nok til at en treg gpt-5.4-generering ikke trigger den. */
	static ACTIVITY_TIMEOUT_MS = 60_000;

	constructor(opts: ChatStateOptions) {
		this.#opts = opts;
		if (opts.conversationId !== undefined) {
			this.conversationId = opts.conversationId ?? null;
		}
	}

	/** Oppdater conversationId utenfra (f.eks. ThemePage ved bytte av samtale). */
	setConversationId(id: string | null) {
		this.conversationId = id;
		this.#isFirstMessage = true;
	}

	/** Tøm meldingslisten (f.eks. ved nytt steg i FlowSheet). */
	reset() {
		this.messages = [];
		this.loading = false;
		this.streamingText = '';
		this.streamingSteps = [];
		this.stopped = false;
		this.stoppedText = '';
		this.error = '';
		this.#isFirstMessage = true;
	}

	stop() {
		this.#clearWatchdog();
		this.#abortController?.abort();
	}

	/** Marker en pågående strøm som tapt (f.eks. etter lang backgrounding på mobil).
	 *  Gir «Mistet forbindelsen»-feil + retry i stedet for en hengende spinner. */
	markConnectionLost() {
		if (!this.loading) return;
		this.#timedOut = true;
		this.#abortController?.abort();
	}

	/** (Re)start stillhets-timeren. Kalles ved hver mottatt status/token. */
	#armWatchdog() {
		this.#clearWatchdog();
		this.#watchdog = setTimeout(() => {
			this.#timedOut = true;
			this.#abortController?.abort();
		}, ChatState.ACTIVITY_TIMEOUT_MS);
	}

	#clearWatchdog() {
		if (this.#watchdog) {
			clearTimeout(this.#watchdog);
			this.#watchdog = null;
		}
	}

	retry() {
		this.error = '';
		this.messages = this.messages.filter((m) => m.id !== this.lastUserMsgId);
		void this.send(this.lastUserText);
	}

	/** Fjerner siste brukermelding og returnerer teksten (for å sette den i inputfeltet). */
	editStopped(): string {
		const text = this.lastUserText;
		this.stopped = false;
		this.stoppedText = '';
		this.messages = this.messages.filter((m) => m.id !== this.lastUserMsgId);
		return text;
	}

	async send(text: string, imageUrl?: string, attachment?: unknown) {
		const displayText = text || (imageUrl ? '📷 [Bilde]' : '');

		if (this.loading && !imageUrl && !attachment) {
			this.#pendingMessage = displayText;
			return;
		}

		const msgId = crypto.randomUUID();
		this.messages = [
			...this.messages,
			{ id: msgId, role: 'user', text: displayText, starred: false, imageUrl: imageUrl ?? null, attachment }
		];
		this.loading = true;
		this.streamingText = '';
		this.streamingSteps = [];
		this.stopped = false;
		this.stoppedText = '';
		this.error = '';
		this.lastUserText = displayText;
		this.lastUserMsgId = msgId;
		this.#abortController = new AbortController();
		this.#timedOut = false;
		this.#armWatchdog();

		// Løs opp samtale-ID
		if (!this.conversationId && this.#opts.getOrCreateConversationId) {
			try {
				this.conversationId = await this.#opts.getOrCreateConversationId();
			} catch {
				// API-et håndterer fallback
			}
		}

		// First-message attachment-injeksjon
		const effectiveAttachment = (this.#isFirstMessage && this.#opts.initialAttachment)
			? this.#opts.initialAttachment
			: attachment;
		this.#isFirstMessage = false;

		try {
			let bookWasRouted = false;

			const data = await streamProxyChat({
				message: displayText,
				conversationId: this.conversationId,
				imageUrl,
				attachment: effectiveAttachment,
				preferredModel: typeof this.#opts.preferredModel === 'function'
					? this.#opts.preferredModel()
					: this.#opts.preferredModel,
				systemPrompt: typeof this.#opts.systemPrompt === 'function'
					? this.#opts.systemPrompt()
					: this.#opts.systemPrompt,
				signal: this.#abortController.signal,
				onStatus: (status) => {
					this.#armWatchdog();
					this.streamingSteps = [...this.streamingSteps, status];
				},
				onToken: (token) => {
					this.#armWatchdog();
					this.streamingText += token;
				},
				onThemeRouted: (theme) => {
					this.#opts.onThemeRouted?.(theme);
					this.conversationId = null;
				},
				onThemeSuggested: (theme) => {
					this.#opts.onThemeSuggested?.(theme);
				},
				onBookRouted: (book) => {
					bookWasRouted = true;
					this.loading = false;
					this.streamingText = '';
					this.streamingSteps = [];
					this.#opts.onBookRouted?.(book);
				}
			});

			if (bookWasRouted) return;

			this.conversationId = (data.conversationId as string | null) ?? this.conversationId;

			const assistantMsg: ChatMessage = {
				id: crypto.randomUUID(),
				role: 'assistant',
				text: (data.message as string) ?? '',
				starred: false,
				imageUrl: null,
				actions: (data.actions as ChatAction[] | undefined) ?? undefined,
				widgetProposal: (data.widgetProposal ?? data.metadata?.widgetProposal) as WidgetDraft | null ?? null,
				widgetFlow: (data.widgetFlow ?? data.metadata?.widgetFlow) as WidgetCreationFlow | null ?? null,
				statusWidget: (data.statusWidget ?? data.metadata?.statusWidget) as WeatherStatusWidget | null ?? null,
				photoAnnotation: (data.photoAnnotation ?? data.metadata?.photoAnnotation) as PhotoAnnotationResult | null ?? null,
				photoAnnotationImageUrl: (data.photoAnnotationImageUrl ?? data.metadata?.photoAnnotationImageUrl) as string | null ?? null,
			};

			const transformed = this.#opts.onAssistantMessage?.(assistantMsg, data);
			if (transformed !== false) {
				this.messages = [...this.messages, transformed ?? assistantMsg];
			}

			await this.#opts.onPayload?.(data);
			if (data.checklistChanged) await this.#opts.onChecklistChanged?.();
		} catch (e) {
			if (this.#timedOut) {
				// Watchdog-utløst abort — behandles som en tapt forbindelse, ikke som brukerstopp.
				this.error = 'Mistet forbindelsen. Prøv igjen.';
			} else if (e instanceof Error && e.name === 'AbortError') {
				this.stopped = true;
				this.stoppedText = this.streamingText;
			} else {
				this.error = 'Noe gikk galt. Prøv igjen.';
			}
		} finally {
			this.#clearWatchdog();
			this.#abortController = null;
			this.streamingText = '';
			this.streamingSteps = [];
			this.loading = false;

			if (this.#pendingMessage) {
				const next = this.#pendingMessage;
				this.#pendingMessage = null;
				void this.send(next);
			}
		}
	}
}
