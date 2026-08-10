<script lang="ts">
	import ChatInput from '../ui/ChatInput.svelte';
	import ChatThread from '../ui/ChatThread.svelte';
	import { filmTabsApi, type FilmTabsApi, type Film } from './film-api';
	import { ChatState } from '$lib/client/chat-state.svelte';
	import type { ThreadRow } from '$lib/client/chat-thread-rows';

	interface Props {
		themeId: string;
		film: Film;
		/** Ferdig tråd i stedet for et nettverkskall — brukes av /design-galleriet. */
		initialMessages?: ThreadRow[] | null;
		/** Nettverkslag — injiseres som mock på /design. Default: ekte API. */
		api?: FilmTabsApi;
	}

	let { themeId, film, initialMessages = null, api = filmTabsApi }: Props = $props();

	// Egen SSE-løkke og egen tråd-array fram til august 2026 — ChatState gjorde det
	// samme, med avbrudd, watchdog, retry og kø på kjøpet.
	const chat = new ChatState({
		conversationId: film.conversationId ?? null,
		systemPrompt: () => buildFilmSystemPrompt(film)
	});

	if (initialMessages) chat.hydrate(initialMessages);

	let loadedConversationId = $state<string | null>(null);
	$effect(() => {
		const convId = film.conversationId;
		if (initialMessages || !convId || convId === loadedConversationId) return;
		loadedConversationId = convId;
		void chat.loadThread(convId);
	});

	/* ── System prompt builder ───────────────────────────── */
	function buildFilmSystemPrompt(f: Film): string {
		const pack = f.contextPack ?? {};

		const parts: string[] = [
			`Du er en filmkyndig og reflektert samtalepartner som snakker om «${f.title}»${f.year ? ` (${f.year})` : ''}${f.director ? `, regissert av ${f.director}` : ''}. Du kjenner filmen godt — bruk den kunnskapen som grunnlag, ikke som pensum.`,

			`Når brukeren beskriver filmen eller sin opplevelse av den:
- bygg videre på deres observasjoner
- trekk ut mønstre og mulige tolkninger (tema, bildebruk, klipp, skuespill)
- vær konkret (referer til scener og detaljer)
- tør å formulere hva som kan være uklart eller motsetningsfylt
- ikke vær redd for å spekulere, men ikke vær skråsikker

Unngå:
- generelle formuleringer («sterk film», «interessant»)
- oppsummering uten nye perspektiver
- spoilere hvis brukeren ikke har sett filmen ennå

Avslutt gjerne med ett åpent, konkret spørsmål som bygger videre på det brukeren faktisk reagerte på.`
		];

		if (pack.metadata?.genres?.length) parts.push(`Sjangre: ${pack.metadata.genres.join(', ')}.`);
		if (pack.metadata?.runtime) parts.push(`Spilletid: ${pack.metadata.runtime} minutter.`);
		if (pack.themes?.length) parts.push(`Sentrale temaer i filmen: ${pack.themes.join(', ')}.`);
		if (pack.directorContext?.bio) parts.push(`Om regissøren: ${pack.directorContext.bio}`);
		if (pack.directorContext?.howFilmFits)
			parts.push(`Hvordan filmen passer i regissørskapet: ${pack.directorContext.howFilmFits}`);

		if (pack.filmographySequence) {
			const fmt = (w: { title: string; year?: number }) => `${w.title}${w.year ? ` (${w.year})` : ''}`;
			const before = pack.filmographySequence.before.map(fmt).join('; ') || '—';
			const after = pack.filmographySequence.after.map(fmt).join('; ') || '—';
			parts.push(
				`Plassering i regissørskapet: før denne kom ${before}. Etter denne kom ${after}. Bruk plasseringen når det er naturlig.`
			);
		}

		if (pack.castHighlights?.length) {
			const lines = pack.castHighlights
				.slice(0, 5)
				.map((c) => `- ${c.name}${c.character ? ` som ${c.character}` : ''}${c.note ? ` — ${c.note}` : ''}`)
				.join('\n');
			parts.push(`Sentrale skuespillere:\n${lines}`);
		}

		if (pack.criticReviews?.length) {
			const lines = pack.criticReviews
				.slice(0, 5)
				.map((r) => `- ${r.source}${r.verdict ? ` (${r.verdict})` : ''}: «${r.quote}» [${r.url}]`)
				.join('\n');
			parts.push(
				`Reelle kritikersitater (siter ordrett ved behov, oppgi kilde, IKKE finn på flere):\n${lines}`
			);
		}

		if (pack.reception?.critics) parts.push(`Syntese av kritikermottakelse: ${pack.reception.critics}`);
		if (pack.reception?.audience) parts.push(`Slik opplever publikum filmen typisk: ${pack.reception.audience}`);
		if (pack.reception?.patterns?.length)
			parts.push(`Gjengangere i reaksjonene: ${pack.reception.patterns.join(', ')}.`);

		if (pack.letterboxd?.averageRating !== undefined) {
			parts.push(
				`Letterboxd: ${pack.letterboxd.averageRating.toFixed(2)}/5. Bruk som signal, ikke fasit.`
			);
		}

		if (pack.whereToWatch?.flatrate?.length) {
			parts.push(
				`Filmen strømmes i Norge på: ${pack.whereToWatch.flatrate.map((p) => p.provider).join(', ')}.`
			);
		}

		if (pack.conversationHints?.length) {
			parts.push(
				`Gode innganger til samtalen (bruk naturlig, ramse dem IKKE opp):\n${pack.conversationHints.map((h) => `- ${h}`).join('\n')}`
			);
		}

		parts.push(
			`Du kan KUN referere kritikere som er listet over. Ikke dikt opp flere anmeldelser. Hvis brukeren spør om noe som ikke ligger i denne konteksten, kall verktøyet film_research med en konkret query.`
		);
		parts.push(`Svar alltid på norsk med mindre brukeren skriver på et annet språk.`);

		return parts.join('\n\n');
	}

	async function sendChatMessage(text: string) {
		if (!film.conversationId || !text.trim()) return;
		await chat.send(text);
	}
</script>

<div class="fl-chat">
	<ChatThread
		class="fl-chat-messages"
		messages={chat.messages}
		streamingText={chat.streamingText}
		streamingSteps={chat.streamingSteps}
		loading={chat.loading}
		stopped={chat.stopped}
		stoppedText={chat.stoppedText}
		error={chat.error}
		lastUserMsgId={chat.lastUserMsgId}
		emptyText={film.contextStatus === 'pending'
			? 'Samler filmkontekst — jeg gir deg et rikere svar om litt…'
			: 'Start samtalen om filmen. Hva sitter du igjen med?'}
		loadingHistory={chat.loadingOlder && chat.messages.length === 0}
		hasMore={chat.hasMore}
		loadingOlder={chat.loadingOlder}
		historyError={chat.historyError}
		onLoadOlder={() => chat.loadOlder()}
		onRetry={() => chat.retry()}
	/>
	<ChatInput
		placeholder="Hva tenker du om «{film.title}»?"
		disabled={chat.loading}
		streaming={chat.loading}
		onStop={() => chat.stop()}
		onsubmit={(msg) => sendChatMessage(msg)}
	/>
</div>

<style>
	.fl-chat {
		display: flex;
		flex-direction: column;
		flex: 1;
		overflow: hidden;
		padding-top: 8px;
	}

	/* ChatThread eier scroll og retning; her settes bare rammen. */
	:global(.fl-chat-messages) {
		/* `scroll` (ikke `auto`) sammen med touch-reglene — iOS-momentum. */
		overflow-y: scroll;
		-webkit-overflow-scrolling: touch;
		overscroll-behavior: contain;
		touch-action: pan-y;
		padding: 8px 16px;
	}

	.fl-empty {
		color: var(--film-text-tertiary, #666);
		font-size: 0.85rem;
		text-align: center;
		padding: 24px 16px;
	}

</style>
