<script lang="ts">
	import ChatInput from '../ui/ChatInput.svelte';
	import ChatThread from '../ui/ChatThread.svelte';
	import { filmTabsApi, type FilmTabsApi, type Film } from './film-api';
	import { ChatState } from '$lib/client/chat-state.svelte';

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

	// Egen SSE-løkke og egen tråd fram til august 2026.
	const chat = new ChatState({
		conversationId,
		systemPrompt: () => buildSystemPrompt()
	});

	let loaded = $state(false);

	$effect(() => {
		if (loaded) return;
		loaded = true;
		if (conversationId) void chat.loadThread(conversationId);
	});

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
		if (!text.trim() || chat.loading) return;
		await chat.send(text);
	}
</script>

<div class="fl-tchat">
	<div class="fl-tchat-head">
		<button class="fl-close" onclick={onBack} aria-label="Tilbake til biblioteket">←</button>
		<h1 class="fl-tchat-title">💬 Prat om film</h1>
	</div>

	<ChatThread
		class="fl-tchat-messages"
		messages={chat.messages}
		streamingText={chat.streamingText}
		streamingSteps={chat.streamingSteps}
		loading={chat.loading}
		stopped={chat.stopped}
		stoppedText={chat.stoppedText}
		error={chat.error}
		lastUserMsgId={chat.lastUserMsgId}
		loadingHistory={!loaded}
		hasMore={chat.hasMore}
		loadingOlder={chat.loadingOlder}
		historyError={chat.historyError}
		onLoadOlder={() => chat.loadOlder()}
		onRetry={() => chat.retry()}
	>
		{#snippet empty()}
			<div class="fl-tchat-intro">
				<p>Spør om anbefalinger eller start en prat om en film du har sett.</p>
				<div class="fl-tchat-suggestions">
					<button onclick={() => send('Anbefal meg en film for i kveld basert på smaken min')}>Anbefal noe for i kveld</button>
					<button onclick={() => send('Foreslå en regissør jeg burde utforske')}>En regissør å utforske</button>
				</div>
			</div>
		{/snippet}
	</ChatThread>

	<ChatInput
		placeholder="Snakk om film…"
		disabled={chat.loading}
		streaming={chat.loading}
		onStop={() => chat.stop()}
		onsubmit={(msg) => send(msg)}
	/>
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
	:global(.fl-tchat-messages) {
		overflow-y: scroll;
		-webkit-overflow-scrolling: touch;
		overscroll-behavior: contain;
		touch-action: pan-y;
		padding: 12px 16px;
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
</style>
