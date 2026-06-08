<script lang="ts">
	import ChatInput from '../ui/ChatInput.svelte';
	import TriageCard from '../composed/TriageCard.svelte';
	import AudioKaraokePlayer from './AudioKaraokePlayer.svelte';
	import { tick } from 'svelte';

	interface Book {
		id: string;
		title: string;
		author: string | null;
		coverUrl: string | null;
		totalPages: number | null;
		currentPage: number;
		format: 'print' | 'audio' | 'both';
		totalMinutes: number | null;
		currentMinutes: number;
		status: 'not_started' | 'reading' | 'completed' | 'paused';
		conversationId: string | null;
		contextStatus: 'none' | 'pending' | 'partial' | 'ready';
		contextPack: Record<string, unknown> | null;
		contextProgress?: BookContextProgressEnvelope | null;
		startedAt: string | null;
		finishedAt: string | null;
		loanDueDate: string | null;
		loanStartDate: string | null;
		createdAt: string;
	}

	interface BookContextProgressEnvelope {
		jobStatus: 'queued' | 'running' | 'retry' | 'completed' | 'failed' | 'canceled';
		jobError: string | null;
		progress: BookContextProgress | null;
	}

	interface BookContextProgress {
		stepIndex: number;
		totalSteps: number;
		label: string;
		sourcesCompleted: number;
		sourcesTotal: number;
		sources: {
			openLibrary?: { ok: boolean; worksFound?: number; error?: string };
			criticReviews?: { ok: boolean; count?: number; error?: string };
			readerSources?: { ok: boolean; count?: number; error?: string };
			goodreads?: { ok: boolean; reviewCount?: number; error?: string };
		};
		updatedAt: string;
	}

	interface WordTimestamp {
		word: string;
		start: number;
		end: number;
	}

	interface BookClip {
		id: string;
		bookId: string;
		text: string;
		page: number | null;
		position: string | null;
		note: string | null;
		source: string | null;
		audioUrl: string | null;
		words: WordTimestamp[] | null;
		characters: string[] | null;
		createdAt: string;
	}

	interface ChatMsg {
		role: 'user' | 'assistant';
		text: string;
	}

	interface Props {
		themeId: string;
		book: Book;
		clips: BookClip[];
		chatMessages: ChatMsg[];
		chatMessagesLoaded: boolean;
		onAutoProgress: (bookId: string, currentMinutes: number, totalMinutes: number) => void;
		onClipAdded: (clip: BookClip) => void;
		onChatMessage: (msg: ChatMsg) => void;
	}

	let {
		themeId,
		book,
		clips,
		chatMessages,
		chatMessagesLoaded,
		onAutoProgress,
		onClipAdded,
		onChatMessage
	}: Props = $props();

	/* ── Chat state ──────────────────────────────────────── */
	let chatLoading = $state(false);
	let chatError = $state('');
	let chatStreamingText = $state('');
	let chatStreamingStatus = $state('');

	/* ── Image attachment ────────────────────────────────── */
	let pendingImageUrl = $state<string | null>(null);
	let imageUploadLoading = $state(false);
	let bookImageInput = $state<HTMLInputElement | null>(null);

	/* ── Audio attachment ────────────────────────────────── */
	let pendingAudioUrl = $state<string | null>(null);
	let pendingAudioName = $state<string | null>(null);
	let pendingTranscript = $state<string | null>(null);
	let audioUploadLoading = $state(false);
	let audioUploadStatus = $state('');
	let bookAudioInput = $state<HTMLInputElement | null>(null);

	/* ── Clip drawer ─────────────────────────────────────── */
	let chatClipsOpen = $state(false);

	/* ── Scroll ──────────────────────────────────────────── */
	let chatMessagesEl = $state<HTMLDivElement | null>(null);

	function scrollChatToBottom() {
		tick().then(() => {
			if (chatMessagesEl) chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
		});
	}

	$effect(() => {
		if (chatMessagesEl && (chatMessagesLoaded || chatStreamingText)) scrollChatToBottom();
	});

	/* ── Format helpers ──────────────────────────────────── */
	function formatMinutes(mins: number): string {
		const h = Math.floor(mins / 60);
		const m = mins % 60;
		return h > 0 ? `${h}t ${m < 10 ? '0' : ''}${m}m` : `${m}m`;
	}

	function fmtDate(iso: string): string {
		return new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
	}

	/* ── System prompt builder ───────────────────────────── */
	function buildBookSystemPrompt(bk: Book): string {
		const pack = (bk.contextPack ?? {}) as {
			themes?: string[];
			authorContext?: { bio?: string; themes?: string[]; howBookFits?: string };
			reception?: { critics?: string; readers?: string; patterns?: string[] };
			relatedWorks?: string[];
			conversationHints?: string[];
			metadata?: { year?: number; genre?: string };
			bibliographySequence?: {
				authorName: string;
				currentBook: { title: string; year?: number };
				before: Array<{ title: string; year?: number; oneLiner?: string }>;
				after: Array<{ title: string; year?: number; oneLiner?: string }>;
			};
			criticReviews?: Array<{
				source: string;
				url: string;
				publishedAt?: string;
				verdict?: 'positive' | 'mixed' | 'negative';
				quote: string;
				paraphrase?: string;
			}>;
			readerVoices?: Array<{ source: string; url: string; quote: string }>;
			goodreads?: {
				url: string;
				averageRating?: number;
				ratingsCount?: number;
				topReviews?: Array<{ rating?: number; quote: string }>;
			};
		};

		const isAudio = bk.format === 'audio' || bk.format === 'both';

		const parts: string[] = [
			`Du er en oppmerksom og reflektert leser som samtaler om «${bk.title}»${bk.author ? ` av ${bk.author}` : ''}. Du kjenner boken godt — bruk den kunnskapen som grunnlag, ikke som pensum.`,

			`Når brukeren beskriver boken eller sin opplevelse av den:
- bygg videre på deres observasjoner
- trekk ut mønstre og mulige tolkninger
- vær konkret (referer til scener og detaljer)
- tør å formulere hva som kan være ubehagelig eller uklart
- organiser tanker når det gir verdi
- ikke vær redd for å spekulere, men ikke vær skråsikker

Unngå:
- generelle formuleringer ("sterk historie", "interessant")
- oppsummering uten nye perspektiver

Avslutt gjerne med ett åpent, konkret spørsmål som bygger videre på det brukeren faktisk reagerte på.`
		];

		if (isAudio) {
			const progressInfo = bk.currentMinutes && bk.totalMinutes
				? `Brukeren er på ${formatMinutes(bk.currentMinutes)} av ${formatMinutes(bk.totalMinutes)}.`
				: bk.currentMinutes
					? `Brukeren har hørt ${formatMinutes(bk.currentMinutes)}.`
					: '';

			parts.push(`Brukeren hører denne boken som lydbok.${progressInfo ? ' ' + progressInfo : ''}

Hvis brukeren sender et skjermbilde fra en lydspiller:
- Les av nåværende posisjon (format T:MM:SS), total lengde, og boktittel
- Kommentér gjerne hva posisjonen tilsvarer tematisk i boken
- Legg ALLTID til taggen <!--FREMDRIFT:NNN/MMM--> HELT PÅ SLUTTEN av svaret ditt, der NNN er nåværende posisjon i hele minutter og MMM er total varighet i hele minutter (0 hvis ukjent). Ikke forklar taggen.

Hvis brukeren sender et lydklipp eller transkripsjon fra boken:
- Behandle teksten som et mulig sitat og diskuter innholdet
- Avslutt med «Vil du lagre dette som et klipp?» hvis innholdet er sitérbart`);
		}

		if (pack.metadata?.genre) parts.push(`Sjanger: ${pack.metadata.genre}.`);
		if (pack.themes?.length) parts.push(`Sentrale temaer i boken: ${pack.themes.join(', ')}.`);
		if (pack.authorContext?.bio) parts.push(`Om forfatteren: ${pack.authorContext.bio}`);
		if (pack.authorContext?.howBookFits) parts.push(`Hvordan boken passer inn i forfatterens verk: ${pack.authorContext.howBookFits}`);

		if (pack.bibliographySequence) {
			const fmt = (w: { title: string; year?: number; oneLiner?: string }) =>
				`${w.title}${w.year ? ` (${w.year})` : ''}${w.oneLiner ? ` — ${w.oneLiner}` : ''}`;
			const before = pack.bibliographySequence.before.map(fmt).join('; ') || '—';
			const after = pack.bibliographySequence.after.map(fmt).join('; ') || '—';
			parts.push(`Plassering i forfatterskapet: før denne kom ${before}. Etter denne kom ${after}. Bruk plasseringen når det er naturlig (f.eks. "dette kom rett etter X, hvor han …").`);
		}

		if (pack.criticReviews?.length) {
			const lines = pack.criticReviews.slice(0, 5).map((r) =>
				`- ${r.source}${r.verdict ? ` (${r.verdict})` : ''}: «${r.quote}» [${r.url}]`
			).join('\n');
			parts.push(`Reelle kritikersitater (siter ordrett ved behov, oppgi kilde, IKKE finn på flere):\n${lines}`);
		}

		if (pack.reception?.critics) parts.push(`Syntese av kritikermottakelse: ${pack.reception.critics}`);
		if (pack.reception?.readers) parts.push(`Slik opplever lesere boken typisk: ${pack.reception.readers}`);
		if (pack.reception?.patterns?.length) parts.push(`Gjengangere i lesernes reaksjoner: ${pack.reception.patterns.join(', ')}.`);

		if (pack.readerVoices?.length) {
			const lines = pack.readerVoices.slice(0, 3).map((v) => `- ${v.source}: «${v.quote}»`).join('\n');
			parts.push(`Leserstemmer (eksempler, ikke statistikk):\n${lines}`);
		}

		if (pack.goodreads?.averageRating !== undefined) {
			parts.push(`Goodreads: ${pack.goodreads.averageRating.toFixed(2)}/5${pack.goodreads.ratingsCount ? ` (${pack.goodreads.ratingsCount.toLocaleString('no-NO')} stemmer)` : ''}. Bruk som signal, ikke fasit.`);
		}

		if (pack.relatedWorks?.length) parts.push(`Beslektede verk du kan trekke på: ${pack.relatedWorks.join(', ')}.`);
		if (pack.conversationHints?.length) {
			parts.push(`Gode innganger til samtalen (bruk disse naturlig når det passer, ramse dem IKKE opp):\n${pack.conversationHints.map((h) => `- ${h}`).join('\n')}`);
		}

		parts.push(`Du kan KUN referere kritikere som er listet over. Ikke dikt opp flere anmeldelser. Hvis brukeren spør om noe som ikke ligger i denne konteksten, kall verktøyet book_research med en konkret query.`);

		parts.push(`Svar alltid på norsk med mindre brukeren skriver på et annet språk.`);

		return parts.join('\n\n');
	}

	/* ── Image attachment ────────────────────────────────── */
	async function handleBookImageAttachment(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		imageUploadLoading = true;
		try {
			const fd = new FormData();
			fd.append('image', file);
			const res = await fetch('/api/upload-image', { method: 'POST', body: fd });
			if (!res.ok) throw new Error();
			const data = await res.json();
			pendingImageUrl = data.url ?? data.secure_url ?? null;
		} catch { /* ignore */ } finally {
			imageUploadLoading = false;
			if (bookImageInput) bookImageInput.value = '';
		}
	}

	/* ── Audio attachment ────────────────────────────────── */
	async function handleBookAudioAttachment(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file || !book) return;
		if (bookAudioInput) bookAudioInput.value = '';

		audioUploadLoading = true;
		audioUploadStatus = 'Laster opp…';
		pendingAudioName = file.name;
		pendingAudioUrl = null;
		pendingTranscript = null;

		try {
			const fd = new FormData();
			fd.append('file', file);
			audioUploadStatus = 'Transkriberer…';
			const res = await fetch(`/api/tema/${themeId}/books/${book.id}/transcribe`, {
				method: 'POST', body: fd
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				audioUploadStatus = err.error ?? 'Transkripsjon feilet.';
				return;
			}
			const data = await res.json();
			pendingTranscript = data.transcript;
			pendingAudioUrl = data.audioUrl ?? null;
			if (data.clip) onClipAdded(data.clip);
			audioUploadStatus = '';
		} catch {
			audioUploadStatus = 'Noe gikk galt.';
		} finally {
			audioUploadLoading = false;
		}
	}

	/* ── Send message ────────────────────────────────────── */
	async function sendChatMessage(text: string) {
		if (!book.conversationId) return;

		const imageUrl = pendingImageUrl;
		const transcript = pendingTranscript;
		pendingImageUrl = null;
		pendingAudioUrl = null;
		pendingAudioName = null;
		pendingTranscript = null;

		const userLabel = imageUrl
			? `📷 ${text || 'Skjermbilde'}`
			: transcript
				? `🎵 ${text || 'Lydklipp'}`
				: text;
		onChatMessage({ role: 'user', text: userLabel });
		scrollChatToBottom();
		chatLoading = true;
		chatError = '';
		chatStreamingText = '';
		chatStreamingStatus = 'Starter…';

		try {
			const systemPrompt = buildBookSystemPrompt(book);
			let outMessage = text || (imageUrl ? 'Hva ser du på dette bildet?' : 'Kommenter dette lydklippet.');
			if (transcript) {
				outMessage = (text
					? `${text}\n\n`
					: '') + `[Lydklipp-transkripsjon]\n${transcript}`;
			}
			const body: Record<string, unknown> = {
				mode: 'proxy',
				message: outMessage,
				conversationId: book.conversationId,
				routing: {},
				systemPrompt,
				messages: []
			};
			if (imageUrl) body.imageUrl = imageUrl;

			const response = await fetch('/api/chat-stream-messages', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});

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
					else if (event.type === 'token') { chatStreamingStatus = ''; chatStreamingText += event.data?.token ?? ''; }
					else if (event.type === 'complete') finalPayload = event.data;
				}
				buffer = lines[lines.length - 1];
			}

			const rawMessage = (finalPayload as any)?.message ?? chatStreamingText;
			const fremdriftMatch = rawMessage.match(/<!--FREMDRIFT:(\d+)\/(\d+)-->/);
			const displayMessage = fremdriftMatch
				? rawMessage.replace(/\s*<!--FREMDRIFT:\d+\/\d+-->\s*/, '').trim()
				: rawMessage;
			onChatMessage({ role: 'assistant', text: displayMessage });
			if (fremdriftMatch) {
				onAutoProgress(book.id, parseInt(fremdriftMatch[1], 10), parseInt(fremdriftMatch[2], 10));
			}
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

<div class="bk-chat">
	<div class="bk-chat-messages" bind:this={chatMessagesEl} aria-live="polite">
		{#if !chatMessagesLoaded}
			<p class="bk-empty">Laster…</p>
		{:else if chatMessages.length === 0}
			<p class="bk-empty">
				{#if book.contextStatus === 'pending'}
					Samler bokkontekst — jeg gir deg et rikere svar om litt…
				{:else}
					Start samtalen om boken. Hva tenker du så langt?
				{/if}
			</p>
		{/if}
		{#each chatMessages as msg}
			{#if msg.role === 'user'}
				<div class="bk-bubble-user">{msg.text}</div>
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
			<p class="bk-error">{chatError}</p>
		{/if}
	</div>
	{#if pendingImageUrl}
		<div class="bk-pending-image">
			<img src={pendingImageUrl} alt="Vedlegg" class="bk-pending-thumb" />
			<button class="bk-pending-remove" onclick={() => (pendingImageUrl = null)} aria-label="Fjern bilde">×</button>
		</div>
	{/if}
	{#if pendingAudioUrl || pendingTranscript}
		<div class="bk-pending-audio">
			<span class="bk-pending-audio-name">🎵 {pendingAudioName ?? 'Lydklipp'} {pendingTranscript ? '— transkribert ✓' : ''}</span>
			<button class="bk-pending-remove" onclick={() => { pendingAudioUrl = null; pendingAudioName = null; pendingTranscript = null; }} aria-label="Fjern lyd">×</button>
		</div>
	{/if}
	{#if imageUploadLoading || audioUploadLoading}
		<p class="bk-upload-status">{imageUploadLoading ? 'Laster opp bilde…' : audioUploadStatus || 'Laster opp lyd…'}</p>
	{/if}
	<input
		bind:this={bookImageInput}
		type="file"
		accept="image/*"
		style="display:none"
		onchange={handleBookImageAttachment}
	/>
	<input
		bind:this={bookAudioInput}
		type="file"
		accept="audio/*,video/*"
		style="display:none"
		onchange={handleBookAudioAttachment}
	/>
	<ChatInput
		showActionRig
		placeholder="Hva tenker du om «{book.title}»?"
		disabled={chatLoading || imageUploadLoading || audioUploadLoading}
		onsubmit={(msg) => sendChatMessage(msg)}
		onAttachment={(kind) => {
			if (kind === 'camera') bookImageInput?.click();
			else if (kind === 'voice') bookAudioInput?.click();
		}}
	/>

	<!-- Audio clips drawer -->
	{#if clips.some((c) => c.audioUrl)}
		{@const audioClips = clips.filter((c) => c.audioUrl)}
		<div class="bk-chat-clips-drawer">
			<button
				class="bk-chat-clips-toggle"
				onclick={() => (chatClipsOpen = !chatClipsOpen)}
			>
				🎵 {audioClips.length} lydklipp {chatClipsOpen ? '▴' : '▾'}
			</button>
			{#if chatClipsOpen}
				<div class="bk-chat-clips-list">
					{#each audioClips as clip}
						<div class="bk-chat-clip-row">
							<div class="bk-chat-clip-meta">
								{#if clip.position}<span class="bk-clip-loc">⏱ {clip.position}</span>{/if}
								{#if clip.characters?.length}
									{#each clip.characters as char}
										<span class="bk-clip-char">{char}</span>
									{/each}
								{/if}
								<span class="bk-clip-date">{fmtDate(clip.createdAt)}</span>
							</div>
							<AudioKaraokePlayer
								src={clip.audioUrl!}
								words={clip.words}
								text={clip.text}
							/>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.bk-chat {
		display: flex;
		flex-direction: column;
		flex: 1;
		overflow: hidden;
		padding-top: 8px;
	}

	.bk-chat-messages {
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

	.bk-bubble-user {
		align-self: flex-end;
		background: #1e2244;
		color: #e0e4ff;
		padding: 10px 14px;
		border-radius: 18px 18px 4px 18px;
		max-width: 80%;
		font-size: 0.88rem;
		line-height: 1.5;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.bk-pending-image {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 16px;
	}
	.bk-pending-thumb {
		height: 48px;
		width: 48px;
		object-fit: cover;
		border-radius: 6px;
	}
	.bk-pending-audio {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 16px;
		background: #0f1025;
		border-top: 1px solid #1e1e2a;
	}
	.bk-pending-audio-name {
		font-size: 0.82rem;
		color: #a0a8ff;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.bk-pending-remove {
		background: none;
		border: none;
		color: #888;
		font-size: 1rem;
		cursor: pointer;
		padding: 0 4px;
		line-height: 1;
	}
	.bk-pending-remove:hover { color: #ff9999; }
	.bk-upload-status {
		font-size: 0.78rem;
		color: #888;
		padding: 2px 16px;
		margin: 0;
	}

	.bk-clip-loc {
		font-size: 0.72rem;
		color: #7c8ef5;
		background: #111a2a;
		padding: 2px 6px;
		border-radius: 4px;
	}

	.bk-clip-date {
		font-size: 0.7rem;
		color: #555;
		margin-left: auto;
	}

	.bk-clip-char {
		font-size: 0.7rem;
		padding: 2px 7px;
		border-radius: 99px;
		background: #1a1a2a;
		border: 1px solid #3a3a5a;
		color: #9090c8;
	}

	.bk-chat-clips-drawer {
		border-top: 1px solid #1a1a2a;
		flex-shrink: 0;
	}

	.bk-chat-clips-toggle {
		width: 100%;
		background: none;
		border: none;
		color: #7070a0;
		font: inherit;
		font-size: 0.78rem;
		padding: 8px 16px;
		cursor: pointer;
		text-align: left;
		transition: color 0.15s;
	}
	.bk-chat-clips-toggle:hover { color: #a0a8ff; }

	.bk-chat-clips-list {
		display: flex;
		flex-direction: column;
		gap: 0;
		max-height: 320px;
		overflow-y: auto;
		padding: 0 16px 8px;
	}

	.bk-chat-clip-row {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 10px 0;
		border-top: 1px solid #111118;
	}
	.bk-chat-clip-row:first-child { border-top: none; }

	.bk-chat-clip-meta {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}

	.bk-empty {
		color: #666;
		font-size: 0.85rem;
		text-align: center;
		padding: 24px 16px;
	}

	.bk-error {
		color: #e07070;
		font-size: 0.8rem;
		margin: 0;
	}
</style>
