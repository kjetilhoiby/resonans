<script lang="ts">
	import ChatInput from '../ui/ChatInput.svelte';
	import TriageCard from '../composed/TriageCard.svelte';
	import { tick } from 'svelte';
	import { filmTabsApi, type FilmTabsApi, type Film } from './film-api';

	export interface ChatMsg {
		role: 'user' | 'assistant';
		text: string;
	}

	interface Props {
		themeId: string;
		film: Film;
		chatMessages: ChatMsg[];
		chatMessagesLoaded: boolean;
		onChatMessage: (msg: ChatMsg) => void;
		/** Nettverkslag — injiseres som mock på /design. Default: ekte API. */
		api?: FilmTabsApi;
	}

	let { themeId, film, chatMessages, chatMessagesLoaded, onChatMessage, api = filmTabsApi }: Props =
		$props();

	let chatLoading = $state(false);
	let chatError = $state('');
	let chatStreamingText = $state('');
	let chatStreamingStatus = $state('');
	let chatMessagesEl = $state<HTMLDivElement | null>(null);

	function scrollChatToBottom() {
		tick().then(() => {
			if (chatMessagesEl) chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
		});
	}

	$effect(() => {
		if (chatMessagesEl && (chatMessagesLoaded || chatStreamingText)) scrollChatToBottom();
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

		onChatMessage({ role: 'user', text });
		scrollChatToBottom();
		chatLoading = true;
		chatError = '';
		chatStreamingText = '';
		chatStreamingStatus = 'Starter…';

		try {
			const systemPrompt = buildFilmSystemPrompt(film);
			const body: Record<string, unknown> = {
				mode: 'proxy',
				message: text,
				conversationId: film.conversationId,
				routing: {},
				systemPrompt,
				messages: []
			};

			const response = await api.streamChatMessages(body);
			if (!response.ok || !response.body) throw new Error('Streaming feilet');

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			let finalPayload: Record<string, unknown> | null = null;

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				for (let i = 0; i < lines.length - 1; i++) {
					const line = lines[i].trim();
					if (!line.startsWith('data: ')) continue;
					const event = JSON.parse(line.slice(6));
					if (event.type === 'status') chatStreamingStatus = event.data?.message ?? '';
					else if (event.type === 'token') {
						chatStreamingStatus = '';
						chatStreamingText += event.data?.token ?? '';
					} else if (event.type === 'complete') finalPayload = event.data;
				}
				buffer = lines[lines.length - 1];
			}

			const rawMessage = (finalPayload as { message?: string })?.message ?? chatStreamingText;
			onChatMessage({ role: 'assistant', text: rawMessage });
			scrollChatToBottom();
		} catch {
			chatError = 'Noe gikk galt. Prøv igjen.';
		} finally {
			chatStreamingText = '';
			chatStreamingStatus = '';
			chatLoading = false;
		}
	}
</script>

<div class="fl-chat">
	<div class="fl-chat-messages" bind:this={chatMessagesEl} aria-live="polite">
		{#if !chatMessagesLoaded}
			<p class="fl-empty">Laster…</p>
		{:else if chatMessages.length === 0}
			<p class="fl-empty">
				{#if film.contextStatus === 'pending'}
					Samler filmkontekst — jeg gir deg et rikere svar om litt…
				{:else}
					Start samtalen om filmen. Hva sitter du igjen med?
				{/if}
			</p>
		{/if}
		{#each chatMessages as msg}
			{#if msg.role === 'user'}
				<div class="fl-bubble-user">{msg.text}</div>
			{:else}
				<TriageCard text={msg.text} />
			{/if}
		{/each}
		{#if chatLoading}
			{#if chatStreamingText}
				<TriageCard text={chatStreamingText} streaming={true} />
			{:else}
				<TriageCard loading={true} status={chatStreamingStatus} />
			{/if}
		{/if}
		{#if chatError}
			<p class="fl-error">{chatError}</p>
		{/if}
	</div>
	<ChatInput
		placeholder="Hva tenker du om «{film.title}»?"
		disabled={chatLoading}
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

	.fl-chat-messages {
		flex: 1;
		overflow-y: scroll;
		-webkit-overflow-scrolling: touch;
		overscroll-behavior: contain;
		touch-action: pan-y;
		padding: 8px 16px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.fl-bubble-user {
		align-self: flex-end;
		background: var(--film-bg-accent, #2a1420);
		color: #ffe8dc;
		padding: 10px 14px;
		border-radius: 18px 18px 4px 18px;
		max-width: 80%;
		font-size: 0.88rem;
		line-height: 1.5;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.fl-empty {
		color: var(--film-text-tertiary, #666);
		font-size: 0.85rem;
		text-align: center;
		padding: 24px 16px;
	}

	.fl-error {
		color: var(--error-text);
		font-size: 0.8rem;
		margin: 0;
	}
</style>
