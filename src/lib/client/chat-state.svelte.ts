/**
 * Delt chat-tilstand for alle chat-kontekster i Resonans.
 *
 * Bruk:
 *   const chat = new ChatState({ conversationId: '...' });
 *   const chat = new ChatState({ getOrCreateConversationId: async () => '...' });
 */

import { streamProxyChat } from './proxy-chat-stream';
import { extractApiErrorMessage } from './api-error';
import {
	displayRows,
	oldestCursor,
	threadRowToMessage,
	dedupePrepend,
	type ThreadRow
} from './chat-thread-rows';
import type { WidgetDraft } from '$lib/artifacts/widget-draft';
import type { WidgetCreationFlow } from '$lib/flows/widget-creation/flow';
import type { WeatherStatusWidget } from '$lib/ai/tools/weather-forecast';
import type { PhotoAnnotationResult } from '$lib/ai/tools/annotate-photo';
import type { ChatEventCard } from '$lib/chat/event-cards';
import type { ResearchCard } from '$lib/chat/research-card';

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
	/** Kilde-kort fra web_search (bunnpanel med kilder, bilder og evt. kart). */
	researchCard?: ResearchCard | null;
}

/** Ekstra valg per sending. */
export interface SendOptions {
	/** Teksten som VISES i brukerboblen når den skiller seg fra det modellen får. */
	displayText?: string;
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
	/** Opprett en fersk samtale på første melding (flyt-samtaler) i stedet for å
	 *  appende til nyeste web-samtale. Gjelder kun når conversationId mangler. */
	forceNewConversation?: boolean;
	/** Tittel på samtalen som forceNewConversation oppretter (f.eks. flytens navn). */
	conversationTitle?: string | (() => string | undefined);
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
	/** HomeScreen: AI har rutet til en film. */
	onFilmRouted?: (film: { filmId: string; filmTitle: string; themeId: string }) => void;
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

	/** Finnes det eldre meldinger enn den første i `messages`? */
	hasMore = $state(false);
	/** Er en side med eldre meldinger på vei inn nå? */
	loadingOlder = $state(false);
	/** Feil fra historikk-henting. Holdes atskilt fra `error`, som gjelder svaret. */
	historyError = $state('');
	// Tidsstempelet til den eldste RÅ raden vi har hentet — markøren neste side hentes
	// før. Serveren oppgir den i `X-Oldest-Cursor` nettopp fordi svaret er filtrert.
	#oldestCursor: string | null = null;

	// Kø for en melding som sendes mens en strøm pågår. Lagrer hele payloaden
	// (tekst + bilde + vedlegg) slik at f.eks. to bilder rett etter hverandre begge
	// får svar, i rekkefølge — i stedet for at det andre kortslutter det første.
	#pendingSend: {
		text: string;
		imageUrl?: string;
		attachment?: unknown;
		opts?: SendOptions;
	} | null = null;
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

	/** Meldinger per side ved lasting oppover. */
	static HISTORY_PAGE_SIZE = 20;

	constructor(opts: ChatStateOptions) {
		this.#opts = opts;
		if (opts.conversationId !== undefined) {
			this.conversationId = opts.conversationId ?? null;
		}
	}

	/**
	 * Fyll tråden med en ferdig hentet side.
	 *
	 * `rows` er RÅ rader — system-meldinger og alt. Filtreringen skjer her, og markøren
	 * settes fra den ufiltrerte lista, slik at neste side ikke henter dem om igjen.
	 * `cursor` overstyrer når kilden vet bedre (endepunktets `X-Oldest-Cursor`).
	 */
	hydrate(rows: ThreadRow[], opts: { hasMore?: boolean; cursor?: string | null } = {}) {
		this.messages = displayRows(rows).map(threadRowToMessage);
		this.hasMore = opts.hasMore ?? false;
		this.#oldestCursor = opts.cursor !== undefined ? opts.cursor : oldestCursor(rows);
		this.historyError = '';
		this.error = '';
	}

	/**
	 * Bytt til en samtale og hent SISTE side av den.
	 *
	 * Uten `limit` returnerer endepunktet hele tråden, og en lang samtale åpner på sin
	 * egen begynnelse — det var symptomet «jeg kommer alltid til eldste melding».
	 * Returnerer en feilmelding, eller null når det gikk bra.
	 */
	async loadThread(
		conversationId: string,
		pageSize: number = ChatState.HISTORY_PAGE_SIZE
	): Promise<string | null> {
		this.setConversationId(conversationId);
		this.loadingOlder = true;
		try {
			const res = await fetch(
				`/api/conversations/${conversationId}/messages?limit=${pageSize}`
			);
			if (!res.ok) {
				const message = `Kunne ikke laste samtalen. ${extractApiErrorMessage(
					res.status,
					await res.text()
				)}`;
				this.historyError = message;
				return message;
			}
			const rows = (await res.json()) as ThreadRow[];
			this.hydrate(rows, {
				hasMore: res.headers.get('X-Has-More') === '1',
				cursor: res.headers.get('X-Oldest-Cursor') || oldestCursor(rows)
			});
			return null;
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Kunne ikke laste samtalen.';
			this.historyError = message;
			return message;
		} finally {
			this.loadingOlder = false;
		}
	}

	/**
	 * Hent forrige side og legg den på toppen. Returnerer antall meldinger som faktisk
	 * ble lagt til, slik at kalleren vet om scroll-posisjonen må kompenseres.
	 *
	 * Kalleren måler høyden FØR og gjenoppretter etter — se `ChatThread.svelte`, som
	 * gjør begge deler så ingen flate trenger å huske dansen.
	 */
	async loadOlder(pageSize: number = ChatState.HISTORY_PAGE_SIZE): Promise<number> {
		if (this.loadingOlder || !this.hasMore || !this.#oldestCursor || !this.conversationId) {
			return 0;
		}
		this.loadingOlder = true;
		this.historyError = '';
		try {
			const res = await fetch(
				`/api/conversations/${this.conversationId}/messages` +
					`?before=${encodeURIComponent(this.#oldestCursor)}&limit=${pageSize}`
			);
			if (!res.ok) {
				this.historyError = `Kunne ikke laste eldre meldinger. ${extractApiErrorMessage(
					res.status,
					await res.text()
				)}`;
				return 0;
			}
			const older = (await res.json()) as ThreadRow[];
			const cursor = res.headers.get('X-Oldest-Cursor');
			this.hasMore = res.headers.get('X-Has-More') === '1' && older.length > 0;
			// Serverens markør vinner. Faller vi tilbake på svaret, er den eldste VISTE
			// raden det beste vi har — da kan system-meldinger foran den hentes om igjen.
			this.#oldestCursor = cursor || oldestCursor(older) || this.#oldestCursor;
			if (older.length === 0) return 0;

			const prepend = dedupePrepend(this.messages, older.map(threadRowToMessage));
			if (prepend.length === 0) return 0;
			this.messages = [...prepend, ...this.messages];
			return prepend.length;
		} catch (err) {
			this.historyError =
				err instanceof Error ? err.message : 'Kunne ikke laste eldre meldinger.';
			return 0;
		} finally {
			this.loadingOlder = false;
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
		// Markøren tilhørte forrige tråd. Uten dette ville lasting oppover i den nye
		// samtalen hentet «før» et tidspunkt fra en helt annen samtale.
		this.hasMore = false;
		this.#oldestCursor = null;
		this.historyError = '';
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

	async send(text: string, imageUrl?: string, attachment?: unknown, opts?: SendOptions) {
		// Boblen og prompten er ikke alltid samme tekst: bok-chatten viser «🎵 Lydklipp»
		// mens modellen får hele transkripsjonen. `promptText` er det som sendes.
		const displayText = opts?.displayText ?? text ?? (imageUrl ? '📷 [Bilde]' : '');
		const promptText = text || displayText || (imageUrl ? '📷 [Bilde]' : '');

		// Kø alt (også bilder/vedlegg) mens en strøm pågår, så hver melding får sitt
		// eget svar i rekkefølge. Lagre rå-input; displayText utledes på nytt ved replay.
		if (this.loading) {
			this.#pendingSend = { text, imageUrl, attachment, opts };
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
			let filmWasRouted = false;

			const data = await streamProxyChat({
				message: promptText,
				conversationId: this.conversationId,
				// Kun aller første melding uten kjent samtale — deretter binder
				// conversationId (bevares gjennom reset()) alle steg til samme samtale.
				forceNewConversation: Boolean(this.#opts.forceNewConversation && !this.conversationId),
				conversationTitle: typeof this.#opts.conversationTitle === 'function'
					? this.#opts.conversationTitle()
					: this.#opts.conversationTitle,
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
				},
				onFilmRouted: (film) => {
					if (gen !== this.#generation) return;
					filmWasRouted = true;
					this.loading = false;
					this.streamingText = '';
					this.streamingSteps = [];
					this.#opts.onFilmRouted?.(film);
				}
			});

			// Utdatert kall (brukeren gikk videre / nullstilte) — ikke skriv i ny tilstand.
			if (gen !== this.#generation) return;
			if (bookWasRouted || filmWasRouted) return;

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
				researchCard: (data.researchCard ?? data.metadata?.researchCard) as ResearchCard | null ?? null,
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
					void this.send(next.text, next.imageUrl, next.attachment, next.opts);
				}
			}
		}
	}
}
