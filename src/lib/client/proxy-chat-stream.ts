interface ProxyChatStreamOptions {
	message: string;
	conversationId?: string | null;
	forceNewConversation?: boolean;
	/** Tittel når forceNewConversation oppretter samtalen (f.eks. flytens navn). */
	conversationTitle?: string;
	imageUrl?: string;
	attachment?: unknown;
	/** Flere vedlegg i én melding (Én inngang). */
	attachments?: unknown[];
	/** Meldingen kom gjennom Én inngang. */
	capture?: boolean;
	preferredModel?: string;
	systemPrompt?: string;
	signal?: AbortSignal;
	onStatus?: (message: string) => void;
	onToken?: (token: string) => void;
	/**
	 * Teksten som er strømmet så langt skal bort: modellen snakket før et
	 * verktøykall, og svaret kommer i neste runde.
	 */
	onStreamReset?: () => void;
	onComplete?: (payload: Record<string, any>) => void;
	onError?: (message: string) => void;
	onThemeRouted?: (theme: { themeId: string; themeName: string; confidence: string }) => void;
	onThemeSuggested?: (theme: { themeId: string; themeName: string; confidence: string; reasoning?: string }) => void;
	onBookRouted?: (book: { bookId: string; bookTitle: string; themeId: string }) => void;
	onFilmRouted?: (film: { filmId: string; filmTitle: string; themeId: string }) => void;
}

export async function streamProxyChat({
	message,
	conversationId = null,
	forceNewConversation = false,
	conversationTitle,
	imageUrl,
	attachment,
	attachments,
	capture,
	preferredModel,
	systemPrompt,
	signal,
	onStatus,
	onToken,
	onStreamReset,
	onComplete,
	onError,
	onThemeRouted,
	onThemeSuggested,
	onBookRouted,
	onFilmRouted
}: ProxyChatStreamOptions): Promise<Record<string, any>> {
	const response = await fetch('/api/chat-stream-messages', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			mode: 'proxy',
			message,
			conversationId,
			forceNewConversation,
			conversationTitle,
			imageUrl,
			attachment,
			...(attachments && attachments.length > 0 ? { attachments } : {}),
			...(capture ? { capture: true } : {}),
			preferredModel,
			routing: {},
			systemPrompt: systemPrompt ?? '',
			messages: []
		}),
		signal
	});

	if (!response.ok || !response.body) {
		const text = await response.text().catch(() => 'Kunne ikke starte streaming');
		throw new Error(text || 'Kunne ikke starte streaming');
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let finalPayload: Record<string, any> | null = null;
	let bookRouted = false;
	let filmRouted = false;

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split('\n');

		for (let i = 0; i < lines.length - 1; i++) {
			const line = lines[i].trim();
			if (!line.startsWith('data: ')) continue;

			const event = JSON.parse(line.slice(6));
			if (event.type === 'status') {
				onStatus?.(event.data?.message ?? 'Resonans tenker...');
			} else if (event.type === 'token') {
				onToken?.(event.data?.token ?? '');
			} else if (event.type === 'stream_reset') {
				onStreamReset?.();
			} else if (event.type === 'error') {
				const errorMessage = event.data?.message ?? 'Streaming feilet';
				onError?.(errorMessage);
				throw new Error(errorMessage);
			} else if (event.type === 'complete') {
				finalPayload = event.data;
			} else if (event.type === 'theme_routed') {
				onThemeRouted?.(event.data);
				onStatus?.(event.data?.message ?? 'Tema-routing fullført');
			} else if (event.type === 'theme_suggested') {
				onThemeSuggested?.(event.data);
			} else if (event.type === 'book_routed') {
				bookRouted = true;
				onBookRouted?.(event.data);
			} else if (event.type === 'film_routed') {
				filmRouted = true;
				onFilmRouted?.(event.data);
			}
		}

		buffer = lines[lines.length - 1];
	}

	const finalLine = buffer.trim();
	if (finalLine.startsWith('data: ')) {
		const event = JSON.parse(finalLine.slice(6));
		if (event.type === 'complete') {
			finalPayload = event.data;
		}
	}

	// Book/film-routing: stream ends after navigation — no complete payload needed
	if (!finalPayload && (bookRouted || filmRouted)) {
		return {};
	}

	if (!finalPayload) {
		throw new Error('Mangler avsluttende stream-payload');
	}

	onComplete?.(finalPayload);
	return finalPayload;
}