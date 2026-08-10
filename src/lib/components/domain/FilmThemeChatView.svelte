<script lang="ts">
	import ChatInput from '../ui/ChatInput.svelte';
	import ChatMessages from '../ui/ChatMessages.svelte';
	import { tick } from 'svelte';
	import { filmTabsApi, type FilmTabsApi, type Film } from './film-api';
	import type { ChatMessage } from '$lib/client/chat-state.svelte';

	interface ChatMsg {
		role: 'user' | 'assistant';
		text: string;
	}

	interface Props {
		themeId: string;
		themeName: string;
		/** Temaets egen samtale — chatten strømmer mot og lagrer i denne. */
		conversationId: string | null;
		/** Brukerens filmer — personaliserer anbefalinger og lar chatten prate om sette filmer. */
		films: Film[];
		onBack: () => void;
		api?: FilmTabsApi;
	}

	let { themeId, themeName, conversationId, films, onBack, api = filmTabsApi }: Props = $props();

	let messages = $state<ChatMsg[]>([]);
	let loaded = $state(false);
	let chatLoading = $state(false);
	let chatError = $state('');
	let streamingText = $state('');
	let streamingStatus = $state('');

	/* Tema-tråden holdes lokalt som `ChatMsg[]` (rolle + tekst, uten id).
	   Oversettes til `ChatMessage` for den delte lista. */
	const uiMessages = $derived<ChatMessage[]>(
		messages.map((m, i) => ({ id: `filmtema-${i}`, role: m.role, text: m.text, starred: false }))
	);
	let messagesEl = $state<HTMLDivElement | null>(null);

	function scrollToBottom() {
		tick().then(() => {
			if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
		});
	}

	$effect(() => {
		if (!loaded) void loadHistory();
	});

	$effect(() => {
		if (messagesEl && (loaded || streamingText)) scrollToBottom();
	});

	async function loadHistory() {
		if (conversationId) {
			try {
				const res = await fetch(`/api/conversations/${conversationId}/messages`);
				if (res.ok) {
					const data: Array<{ role: string; content: string }> = await res.json();
					messages = data
						.filter((m) => m.role !== 'system')
						.map((m) => ({ role: m.role as 'user' | 'assistant', text: m.content }));
				}
			} catch {
				/* ignore */
			}
		}
		loaded = true;
	}

	function buildSystemPrompt(): string {
		const watched = films.filter((f) => f.status === 'watched');
		const want = films.filter((f) => f.status === 'want_to_watch');

		const parts: string[] = [
			`Du er en varm, kunnskapsrik filmentusiast som samtaler med brukeren om film — for å oppdage nye filmer å se OG for å reflektere over filmer de har sett. Du kjenner filmhistorie, regissører, sjangre og strømmelandskapet godt.`,

			`Når brukeren vil ha anbefalinger:
- ta utgangspunkt i smaken deres (se listen under), ikke bare det kanoniske
- foreslå konkret (tittel, år, regissør) og si kort HVORFOR det passer akkurat dem
- 2-4 forslag om gangen, ikke lange lister
- spør gjerne oppklarende om humør, tid eller selskap hvis det hjelper

Når brukeren vil prate om en film de har sett:
- bygg på deres reaksjon, vær konkret om scener og valg
- tør å tolke og spekulere, unngå tomme superlativer`
		];

		if (watched.length) {
			const lines = watched
				.slice(0, 25)
				.map((f) => {
					const bits = [`"${f.title}"${f.year ? ` (${f.year})` : ''}`];
					if (f.rating) bits.push(`terning ${f.rating}/6`);
					if (f.reviewNote) bits.push(`«${f.reviewNote}»`);
					return `- ${bits.join(' — ')}`;
				})
				.join('\n');
			parts.push(`Filmer brukeren HAR SETT (med terning + egen setning der det finnes) — bruk dette til å forstå smaken:\n${lines}`);
		}
		if (want.length) {
			parts.push(
				`På ønskelisten (ikke sett ennå): ${want.slice(0, 25).map((f) => `"${f.title}"`).join(', ')}. Ikke anbefal disse som «nye» — de kjenner dem alt.`
			);
		}
		if (!watched.length && !want.length) {
			parts.push(`Brukeren har ikke logget noen filmer ennå — bli gjerne kjent med smaken deres gjennom samtalen.`);
		}

		parts.push(
			`Tips brukeren om at de kan legge filmer på ønskelisten, logge sette filmer med terning + setning, og bruke «Hva ser jeg i kveld?» for å filtrere på tid og strømmetjeneste — men bare når det er naturlig, ikke i hvert svar.`
		);
		parts.push(`Svar alltid på norsk med mindre brukeren skriver på et annet språk.`);

		return parts.join('\n\n');
	}

	async function send(text: string) {
		if (!text.trim() || chatLoading) return;
		messages = [...messages, { role: 'user', text }];
		scrollToBottom();
		chatLoading = true;
		chatError = '';
		streamingText = '';
		streamingStatus = 'Starter…';

		try {
			const body: Record<string, unknown> = {
				mode: 'proxy',
				message: text,
				conversationId,
				routing: {},
				systemPrompt: buildSystemPrompt(),
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
					if (event.type === 'status') streamingStatus = event.data?.message ?? '';
					else if (event.type === 'token') {
						streamingStatus = '';
						streamingText += event.data?.token ?? '';
					} else if (event.type === 'complete') finalPayload = event.data;
				}
				buffer = lines[lines.length - 1];
			}

			const raw = (finalPayload as { message?: string })?.message ?? streamingText;
			messages = [...messages, { role: 'assistant', text: raw }];
			scrollToBottom();
		} catch {
			chatError = 'Noe gikk galt. Prøv igjen.';
		} finally {
			streamingText = '';
			streamingStatus = '';
			chatLoading = false;
		}
	}
</script>

<div class="fl-tchat">
	<div class="fl-tchat-head">
		<button class="fl-close" onclick={onBack} aria-label="Tilbake til biblioteket">←</button>
		<h1 class="fl-tchat-title">💬 Prat om film</h1>
	</div>

	<div class="fl-tchat-messages" bind:this={messagesEl} aria-live="polite">
		{#if !loaded}
			<p class="fl-empty">Laster…</p>
		{:else if messages.length === 0}
			<div class="fl-tchat-intro">
				<p>Spør om anbefalinger eller start en prat om en film du har sett.</p>
				<div class="fl-tchat-suggestions">
					<button onclick={() => send('Anbefal meg en film for i kveld basert på smaken min')}>Anbefal noe for i kveld</button>
					<button onclick={() => send('Foreslå en regissør jeg burde utforske')}>En regissør å utforske</button>
				</div>
			</div>
		{/if}
		<ChatMessages
			messages={uiMessages}
			streamingText={streamingText}
			loading={chatLoading}
			error={chatError}
		/>
	</div>

	<ChatInput placeholder="Snakk om film…" disabled={chatLoading} onsubmit={(msg) => send(msg)} />
</div>

<style>
	.fl-tchat {
		display: flex;
		flex-direction: column;
		flex: 1;
		overflow: hidden;
	}
	.fl-tchat-head {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 16px 8px;
		flex-shrink: 0;
		border-bottom: 1px solid var(--film-border-faint, #2a1a1a);
	}
	.fl-close {
		background: none;
		border: none;
		color: var(--film-text-secondary, #999);
		font-size: 1.4rem;
		cursor: pointer;
		padding: 0 4px;
		line-height: 1;
	}
	.fl-tchat-title {
		margin: 0;
		font-size: 1rem;
		color: var(--film-text-primary, #eee);
	}
	.fl-tchat-messages {
		flex: 1;
		overflow-y: scroll;
		-webkit-overflow-scrolling: touch;
		overscroll-behavior: contain;
		touch-action: pan-y;
		padding: 12px 16px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.fl-tchat-intro {
		color: var(--film-text-tertiary, #7a6a6a);
		font-size: 0.85rem;
		text-align: center;
		padding: 24px 8px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		align-items: center;
	}
	.fl-tchat-suggestions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		justify-content: center;
	}
	.fl-tchat-suggestions button {
		font: inherit;
		font-size: 0.8rem;
		padding: 7px 12px;
		background: var(--film-bg-input, #1a0f12);
		border: 1px solid var(--film-border, #3a2226);
		color: var(--film-accent-text, #ffcaa0);
		border-radius: 99px;
		cursor: pointer;
	}
	.fl-empty {
		color: var(--film-text-tertiary, #7a6a6a);
		font-size: 0.85rem;
		text-align: center;
		padding: 24px 16px;
	}
</style>
