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
import type { ChatEventCard } from '$lib/chat/event-cards';

export interface ChatAction {
	id: string;
	label: string;
	style?: 'primary' | 'secondary' | 'danger';
}

export interface ChatMessage {
	id: string;
	/** DB-id for den lagrede meldingen (settes etter at svaret er ferdig). Brukes til
	 *  redigering/sletting. I /samtaler er `id` allerede DB-id-en; da er dbId lik id. */
	dbId?: string | null;
	role: 'user' | 'assistant';
	text: string;
	starred: boolean;
	/** Tidspunkt meldingen ble opprettet. Brukes til dato-seksjonering i den kanoniske
	 *  tråden. Valgfritt — kontekster uten tidsstempel viser ingen dato-spacere. */
	createdAt?: string | Date | null;
	imageUrl?: string | null;
	attachment?: unknown;
	actions?: ChatAction[];
	widgetProposal?: WidgetDraft | null;
	widgetFlow?: WidgetCreationFlow | null;
	statusWidget?: WeatherStatusWidget | null;
	photoAnnotation?: PhotoAnnotationResult | null;
	photoAnnotationImageUrl?: string | null;
	/** Inline hendelseskort i den kanoniske tråden (egenfrekvens, økt, nudge …). */
	eventCard?: ChatEventCard | null;
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

	// Kø for en melding som sendes mens en strøm pågår. Lagrer hele payloaden
	// (tekst + bilde + vedlegg) slik at f.eks. to bilder rett etter hverandre begge
	// får svar, i rekkefølge — i stedet for at det andre kortslutter det første.
	#pendingSend: { text: string; imageUrl?: string; attachment?: unknown } | null = null;
	#abortController: AbortController | null = null;
	#isFirstMessage = true;
	#opts: ChatStateOptions;

	// Generasjonsteller: hver send() får et nummer. reset()/stop() bumper telleren slik
	// at et utdatert (avbrutt) kall ikke kan skrive i tilstanden til en nyere send — f.eks.
	// når brukeren trykker «Neste» mens forrige steg fortsatt strømmer.
	#generation = 0;

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

	/** Oppdater teksten på en melding lokalt (etter en lagret redigering). */
	applyLocalEdit(id: string, text: string) {
		const msg = this.messages.find((m) => m.id === id);
		if (msg) msg.text = text;
	}

	/** Fjern en melding lokalt (etter en lagret sletting). */
	removeLocal(id: string) {
		this.messages = this.messages.filter((m) => m.id !== id);
	}

	/** Oppdater conversationId utenfra (f.eks. ThemePage ved bytte av samtale). */
	setConversationId(id: string | null) {
		this.conversationId = id;
		this.#isFirstMessage = true;
	}

	/** Tøm meldingslisten og avbryt en eventuell pågående strøm (f.eks. ved nytt steg i FlowSheet). */
	reset() {
		this.#generation++; // invalider in-flight send
		this.#clearWatchdog();
		this.#abortController?.abort();
		this.#abortController = null;
		this.#pendingSend = null;
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
		// Bumper IKKE generasjonen: catch-blokken skal kjøre og vise stoppet/feil.
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

		// Kø alt (også bilder/vedlegg) mens en strøm pågår, så hver melding får sitt
		// eget svar i rekkefølge. Lagre rå-input; displayText utledes på nytt ved replay.
		if (this.loading) {
			this.#pendingSend = { text, imageUrl, attachment };
			return;
		}

		const msgId = crypto.randomUUID();
		this.messages = [
			...this.messages,
			{ id: msgId, role: 'user', text: displayText, starred: false, createdAt: new Date(), imageUrl: imageUrl ?? null, attachment }
		];
		this.loading = true;
		this.streamingText = '';
		this.streamingSteps = [];
		this.stopped = false;
		this.stoppedText = '';
		this.error = '';
		this.lastUserText = displayText;
		this.lastUserMsgId = msgId;
		const gen = ++this.#generation;
		const controller = new AbortController();
		this.#abortController = controller;
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
				signal: controller.signal,
				onStatus: (status) => {
					if (gen !== this.#generation) return;
					this.#armWatchdog();
					this.streamingSteps = [...this.streamingSteps, status];
				},
				onToken: (token) => {
					if (gen !== this.#generation) return;
					this.#armWatchdog();
					this.streamingText += token;
				},
				onThemeRouted: (theme) => {
					if (gen !== this.#generation) return;
					this.#opts.onThemeRouted?.(theme);
					this.conversationId = null;
				},
				onThemeSuggested: (theme) => {
					if (gen !== this.#generation) return;
					this.#opts.onThemeSuggested?.(theme);
				},
				onBookRouted: (book) => {
					if (gen !== this.#generation) return;
					bookWasRouted = true;
					this.loading = false;
					this.streamingText = '';
					this.streamingSteps = [];
					this.#opts.onBookRouted?.(book);
				}
			});

			// Utdatert kall (brukeren gikk videre / nullstilte) — ikke skriv i ny tilstand.
			if (gen !== this.#generation) return;
			if (bookWasRouted) return;

			this.conversationId = (data.conversationId as string | null) ?? this.conversationId;

			// Fest DB-id-en på brukermeldingen slik at den kan redigeres/slettes senere.
			const userDbId = data.userMessageId as string | undefined;
			if (userDbId) {
				const userMsg = this.messages.find((m) => m.id === msgId);
				if (userMsg) userMsg.dbId = userDbId;
			}

			const assistantMsg: ChatMessage = {
				id: crypto.randomUUID(),
				dbId: (data.assistantMessageId as string | null) ?? null,
				role: 'assistant',
				text: (data.message as string) ?? '',
				starred: false,
				createdAt: new Date(),
				imageUrl: null,
				actions: (data.actions as ChatAction[] | undefined) ?? undefined,
				widgetProposal: (data.widgetProposal ?? data.metadata?.widgetProposal) as WidgetDraft | null ?? null,
				widgetFlow: (data.widgetFlow ?? data.metadata?.widgetFlow) as WidgetCreationFlow | null ?? null,
				statusWidget: (data.statusWidget ?? data.metadata?.statusWidget) as WeatherStatusWidget | null ?? null,
				photoAnnotation: (data.photoAnnotation ?? data.metadata?.photoAnnotation) as PhotoAnnotationResult | null ?? null,
				photoAnnotationImageUrl: (data.photoAnnotationImageUrl ?? data.metadata?.photoAnnotationImageUrl) as string | null ?? null,
				eventCard: (data.eventCard ?? data.metadata?.eventCard) as ChatEventCard | null ?? null,
			};

			const transformed = this.#opts.onAssistantMessage?.(assistantMsg, data);
			if (transformed !== false) {
				this.messages = [...this.messages, transformed ?? assistantMsg];
			}

			await this.#opts.onPayload?.(data);
			if (data.checklistChanged) await this.#opts.onChecklistChanged?.();
		} catch (e) {
			if (gen !== this.#generation) return; // utdatert kall — ignorer feilen
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
			// Utdatert kall: en nyere send (eller reset) eier nå tilstanden — rør ingenting.
			if (gen === this.#generation) {
				this.#clearWatchdog();
				this.#abortController = null;
				this.streamingText = '';
				this.streamingSteps = [];
				this.loading = false;

				if (this.#pendingSend) {
					const next = this.#pendingSend;
					this.#pendingSend = null;
					void this.send(next.text, next.imageUrl, next.attachment);
				}
			}
		}
	}
}
