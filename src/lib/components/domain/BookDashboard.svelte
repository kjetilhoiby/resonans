<script lang="ts">
	import ChatInput from '../ui/ChatInput.svelte';
	import TriageCard from '../composed/TriageCard.svelte';
	import Icon from '../ui/Icon.svelte';
	import AudioKaraokePlayer from './AudioKaraokePlayer.svelte';
	import { page } from '$app/stores';
	import { get } from 'svelte/store';
	import { tick } from 'svelte';

	interface Props {
		themeId: string;
	}

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
		startedAt: string | null;
		finishedAt: string | null;
		createdAt: string;
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

	interface ProgressLogEntry {
		id: string;
		currentPage: number | null;
		currentMinutes: number | null;
		loggedAt: string;
	}

	const CHART_VW = 340, CHART_VH = 155;
	const CHART_PL = 48, CHART_PT = 10, CHART_PB = 30;
	const CHART_CW = CHART_VW - CHART_PL - 14;
	const CHART_CH = CHART_VH - CHART_PT - CHART_PB;

	interface ProgressChartData {
		linePath: string;
		predPath: string | null;
		dots: { cx: number; cy: number; label: string }[];
		etaDate: Date | null;
		paceLabel: string | null;
		xLabels: { x: number; label: string; star?: boolean }[];
		yLines: { y: number; label: string }[];
		hasEnoughData: boolean;
	}

	let { themeId }: Props = $props();

	/* ── Loading state ──────────────────────────────────── */
	let books = $state<Book[]>([]);
	let booksLoading = $state(false);
	let booksError = $state('');
	let booksLoaded = $state(false);

	/* ── Views: library | book ─────────────────────────── */
	type BookTab = 'chat' | 'klipp' | 'fremdrift';
	let selectedBook = $state<Book | null>(null);
	let bookTab = $state<BookTab>('chat');
	let headerCollapsed = $state(false);

	/* ── Add book / search ──────────────────────────────── */
	interface OLBook {
		title: string;
		author: string | null;
		coverUrl: string | null;
		totalPages: number | null;
		year: number | null;
	}
	let showSearch = $state(false);
	let searchQuery = $state('');
	let searchResults = $state<OLBook[]>([]);
	let searchLoading = $state(false);
	let searchError = $state('');
	let searchDebounce = $state<ReturnType<typeof setTimeout> | null>(null);
	let addSaving = $state(false);
	let addError = $state('');
	let manualMode = $state(false);
	let manualTitle = $state('');
	let manualAuthor = $state('');
	let manualPages = $state('');

	/* ── Book chat ──────────────────────────────────────── */
	let chatMessages = $state<ChatMsg[]>([]);
	let chatLoading = $state(false);
	let chatError = $state('');
	let chatStreamingText = $state('');
	let chatStreamingStatus = $state('');
	let chatMessagesLoaded = $state(false);

	/* ── Clips ──────────────────────────────────────────── */
	let clips = $state<BookClip[]>([]);
	let clipsLoaded = $state(false);
	let showAddClip = $state(false);
	let clipText = $state('');
	let clipPage = $state('');
	let clipPosition = $state('');
	let clipNote = $state('');
	let clipCharacters = $state(''); // comma-separated input
	let clipSaving = $state(false);
	let clipError = $state('');

	// Collapsible clip drawer shown inside chat tab
	let chatClipsOpen = $state(false);

	/* ── Progress ───────────────────────────────────────── */
	let progressPage = $state('');
	let posHours = $state(0);
	let posMins = $state(0);
	let totalDurHours = $state(0);
	let totalDurMins = $state(0);
	let progressSaving = $state(false);
	let progressError = $state('');
	let progressAutoSaved = $state(false);
	let totalDurExpanded = $state(false);

	/* ── Discover book ───────────────────────────────────── */
	let discoverLoading = $state(false);
	let discoverError = $state('');
	let bookDiscoverInput = $state<HTMLInputElement | null>(null);

	/* ── Progress log + chart ──────────────────────── */
	let progressLog = $state<ProgressLogEntry[]>([]);
	let progressLogLoaded = $state(false);
	let progressChart = $derived.by(() => selectedBook ? buildProgressChart(progressLog, selectedBook) : null);

	/* ── Chat scroll ────────────────────────────────────── */
	let chatMessagesEl = $state<HTMLDivElement | null>(null);

	function scrollChatToBottom() {
		tick().then(() => {
			if (chatMessagesEl) chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
		});
	}

	/* ── Image attachment (screenshot parsing) ───────────── */
	let pendingImageUrl = $state<string | null>(null);
	let imageUploadLoading = $state(false);
	let bookImageInput = $state<HTMLInputElement | null>(null);

	/* ── Audio attachment ────────────────────────────────── */
	let pendingAudioUrl = $state<string | null>(null);
	let pendingAudioName = $state<string | null>(null);
	let pendingTranscript = $state<string | null>(null); // transcript ready for chat
	let audioUploadLoading = $state(false);
	let audioUploadStatus = $state(''); // progress label shown in UI
	let bookAudioInput = $state<HTMLInputElement | null>(null);

	/* ── Add book format ─────────────────────────────────── */
	let manualFormat = $state<'print' | 'audio' | 'both'>('print');
	let manualTotalMinutes = $state('');

	/* ── Init ───────────────────────────────────────────── */
	$effect(() => {
		if (!booksLoaded) void loadBooks();
	});

	async function loadBooks() {
		booksLoading = true;
		booksError = '';
		try {
			const res = await fetch(`/api/tema/${themeId}/books`);
			if (!res.ok) throw new Error('Lasting feilet');
			books = await res.json();
			booksLoaded = true;
			// Auto-open a specific book if ?book= is in the URL
			const requestedBookId = get(page).url.searchParams.get('book');
			if (requestedBookId) {
				const found = books.find((b) => b.id === requestedBookId);
				if (found) openBook(found);
			}
		} catch {
			booksError = 'Kunne ikke laste bøker.';
		} finally {
			booksLoading = false;
		}
	}

	function onSearchInput() {
		if (searchDebounce) clearTimeout(searchDebounce);
		if (!searchQuery.trim()) { searchResults = []; return; }
		searchDebounce = setTimeout(() => void doSearch(searchQuery.trim()), 380);
	}

	async function doSearch(q: string) {
		searchLoading = true;
		searchError = '';
		try {
			const enc = encodeURIComponent(q);

			const [olRes, gbRes] = await Promise.allSettled([
				fetch(`https://openlibrary.org/search.json?q=${enc}&fields=title,author_name,number_of_pages_median,cover_i,first_publish_year&limit=6`),
				fetch(`https://www.googleapis.com/books/v1/volumes?q=${enc}&maxResults=8&orderBy=relevance`)
			]);

			const results: OLBook[] = [];
			const seen = new Set<string>();

			function dedupeKey(title: string, author: string | null) {
				return `${title.toLowerCase().trim()}|${(author ?? '').toLowerCase().trim()}`;
			}

			// Open Library results
			if (olRes.status === 'fulfilled' && olRes.value.ok) {
				const json = await olRes.value.json() as { docs: Array<{ title: string; author_name?: string[]; number_of_pages_median?: number; cover_i?: number; first_publish_year?: number }> };
				for (const d of json.docs) {
					const author = d.author_name?.[0] ?? null;
					const key = dedupeKey(d.title, author);
					if (seen.has(key)) continue;
					seen.add(key);
					results.push({
						title: d.title,
						author,
						coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
						totalPages: d.number_of_pages_median ?? null,
						year: d.first_publish_year ?? null
					});
				}
			}

			// Google Books results
			if (gbRes.status === 'fulfilled' && gbRes.value.ok) {
				const json = await gbRes.value.json() as { items?: Array<{ volumeInfo: { title: string; authors?: string[]; pageCount?: number; imageLinks?: { thumbnail?: string }; publishedDate?: string } }> };
				for (const item of json.items ?? []) {
					const vi = item.volumeInfo;
					const author = vi.authors?.[0] ?? null;
					const key = dedupeKey(vi.title, author);
					if (seen.has(key)) continue;
					seen.add(key);
					const thumb = vi.imageLinks?.thumbnail?.replace('http://', 'https://') ?? null;
					const year = vi.publishedDate ? parseInt(vi.publishedDate, 10) || null : null;
					results.push({
						title: vi.title,
						author,
						coverUrl: thumb,
						totalPages: vi.pageCount ?? null,
						year
					});
				}
			}

			if (results.length === 0 && (olRes.status === 'rejected' || gbRes.status === 'rejected')) {
				searchError = 'Søk feilet. Sjekk nettforbindelsen.';
			}

			searchResults = results.slice(0, 10);
		} catch {
			searchError = 'Søk feilet. Sjekk nettforbindelsen.';
		} finally {
			searchLoading = false;
		}
	}

	async function addBook(data: { title: string; author: string | null; coverUrl: string | null; totalPages: number | null; format?: 'print' | 'audio' | 'both'; totalMinutes?: number | null }) {
		addSaving = true;
		addError = '';
		try {
			const res = await fetch(`/api/tema/${themeId}/books`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(data)
			});
			if (!res.ok) throw new Error('Oppretting feilet');
			const book: Book = await res.json();
			books = [...books, book];
			closeSearch();
			openBook(book);
		} catch {
			addError = 'Klarte ikke legge til boken. Prøv igjen.';
		} finally {
			addSaving = false;
		}
	}

	function closeSearch() {
		showSearch = false;
		searchQuery = '';
		searchResults = [];
		searchError = '';
		manualMode = false;
		manualTitle = '';
		manualAuthor = '';
		manualPages = '';
		manualTotalMinutes = '';
		addError = '';
	}

	async function openBook(book: Book) {
		selectedBook = book;
		bookTab = 'chat';
		headerCollapsed = false;
		chatMessages = [];
		chatMessagesLoaded = false;
		clips = [];
		clipsLoaded = false;
		progressPage = String(book.currentPage || '');
		totalDurExpanded = false;
		posHours = Math.floor((book.currentMinutes || 0) / 60);
		posMins = (book.currentMinutes || 0) % 60;
		totalDurHours = Math.floor((book.totalMinutes || 0) / 60);
		totalDurMins = (book.totalMinutes || 0) % 60;
		progressLog = [];
		progressLogLoaded = false;

		// Load chat history
		if (book.conversationId) {
			try {
				const res = await fetch(`/api/conversations/${book.conversationId}/messages`);
				if (res.ok) {
					const data: Array<{ role: string; content: string }> = await res.json();
					chatMessages = data
						.filter((m) => m.role !== 'system')
						.map((m) => ({ role: m.role as 'user' | 'assistant', text: m.content }));
				}
			} catch { /* ignore */ }
		}
		chatMessagesLoaded = true;
		scrollChatToBottom();

		// Poll context status if pending
		if (book.contextStatus === 'pending') {
			void pollContextStatus(book.id);
		}
	}

	function closeBook() {
		selectedBook = null;
		chatMessages = [];
		chatStreamingText = '';
		clips = [];
		pendingImageUrl = null;
		pendingAudioUrl = null;
		pendingAudioName = null;
		pendingTranscript = null;
		progressLog = [];
		progressLogLoaded = false;
	}

	async function pollContextStatus(bookId: string) {
		const MAX_POLLS = 20;
		for (let i = 0; i < MAX_POLLS; i++) {
			await new Promise((r) => setTimeout(r, 3000));
			if (!selectedBook || selectedBook.id !== bookId) return;
			try {
				const res = await fetch(`/api/tema/${themeId}/books/${bookId}`);
				if (!res.ok) return;
				const updated: Book = await res.json();
				if (updated.contextStatus !== 'pending') {
					selectedBook = updated;
					books = books.map((b) => (b.id === bookId ? updated : b));
					return;
				}
			} catch { return; }
		}
	}

	function buildBookSystemPrompt(book: Book): string {
		const pack = (book.contextPack ?? {}) as {
			themes?: string[];
			authorContext?: { bio?: string; themes?: string[]; howBookFits?: string };
			reception?: { critics?: string; readers?: string; patterns?: string[] };
			relatedWorks?: string[];
			conversationHints?: string[];
			metadata?: { year?: number; genre?: string };
		};

		const isAudio = book.format === 'audio' || book.format === 'both';

		const parts: string[] = [
			`Du er en oppmerksom og reflektert leser som samtaler om «${book.title}»${book.author ? ` av ${book.author}` : ''}. Du kjenner boken godt — bruk den kunnskapen som grunnlag, ikke som pensum.`,

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
			const progressInfo = book.currentMinutes && book.totalMinutes
				? `Brukeren er på ${formatMinutes(book.currentMinutes)} av ${formatMinutes(book.totalMinutes)}.`
				: book.currentMinutes
					? `Brukeren har hørt ${formatMinutes(book.currentMinutes)}.`
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
		if (pack.reception?.readers) parts.push(`Slik opplever lesere boken typisk: ${pack.reception.readers}`);
		if (pack.reception?.patterns?.length) parts.push(`Gjengangere i lesernes reaksjoner: ${pack.reception.patterns.join(', ')}.`);
		if (pack.relatedWorks?.length) parts.push(`Beslektede verk du kan trekke på: ${pack.relatedWorks.join(', ')}.`);
		if (pack.conversationHints?.length) {
			parts.push(`Gode innganger til samtalen (bruk disse naturlig når det passer, ramse dem IKKE opp):\n${pack.conversationHints.map((h) => `- ${h}`).join('\n')}`);
		}

		parts.push(`Svar alltid på norsk med mindre brukeren skriver på et annet språk.`);

		return parts.join('\n\n');
	}

	/** Silently PATCH book progress from AI-detected screenshot data, then update local state. */
	async function applyAutoProgress(bookId: string, currentMinutes: number, totalMinutes: number) {
		const updates: Record<string, number> = { currentMinutes };
		if (totalMinutes > 0) updates.totalMinutes = totalMinutes;
		try {
			const r = await fetch(`/api/tema/${themeId}/books/${bookId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(updates)
			});
			if (r.ok) {
				const updated: Book = await r.json();
				selectedBook = updated;
				books = books.map((b) => (b.id === bookId ? updated : b));
				posHours = Math.floor(currentMinutes / 60);
				posMins = currentMinutes % 60;
				if (totalMinutes > 0) {
					totalDurHours = Math.floor(totalMinutes / 60);
					totalDurMins = totalMinutes % 60;
				}
				progressAutoSaved = true;
				setTimeout(() => { progressAutoSaved = false; }, 4000);
			}
		} catch { /* silent */ }
	}

	/** Analyze a book cover / audiobook screenshot and pre-fill the add-book form. */
	async function discoverBookFromImage(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		if (bookDiscoverInput) bookDiscoverInput.value = '';
		discoverLoading = true;
		discoverError = '';
		try {
			const fd = new FormData();
			fd.append('image', file);
			const res = await fetch('/api/books/analyze-image', { method: 'POST', body: fd });
			const data = await res.json();
			if (!res.ok) { discoverError = data.error ?? 'Kunne ikke lese bildet.'; return; }
			if (!data.title) { discoverError = 'Fant ingen boktittel i bildet.'; return; }
			// Pre-fill manual form and switch to it
			manualTitle = data.title;
			manualAuthor = data.author ?? '';
			manualFormat = data.format ?? 'print';
			if (data.totalMinutes) manualTotalMinutes = String(data.totalMinutes);
			manualMode = true;
			// Also kick off a background search to find cover etc.
			void doSearch(data.title);
		} catch {
			discoverError = 'Noe gikk galt.';
		} finally {
			discoverLoading = false;
		}
	}

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

	async function handleBookAudioAttachment(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file || !selectedBook) return;
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
			const res = await fetch(`/api/tema/${themeId}/books/${selectedBook.id}/transcribe`, {
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
			// Add new clip to the in-memory list immediately
			if (data.clip) clips = [data.clip, ...clips];
			audioUploadStatus = '';
		} catch {
			audioUploadStatus = 'Noe gikk galt.';
		} finally {
			audioUploadLoading = false;
		}
	}

	async function sendChatMessage(text: string) {
		if (!selectedBook?.conversationId) return;

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
		chatMessages.push({ role: 'user', text: userLabel });
		scrollChatToBottom();
		chatLoading = true;
		chatError = '';
		chatStreamingText = '';
		chatStreamingStatus = 'Starter…';

		try {
			const systemPrompt = buildBookSystemPrompt(selectedBook);
			let outMessage = text || (imageUrl ? 'Hva ser du på dette bildet?' : 'Kommenter dette lydklippet.');
			if (transcript) {
				outMessage = (text
					? `${text}\n\n`
					: '') + `[Lydklipp-transkripsjon]\n${transcript}`;
			}
			const body: Record<string, unknown> = {
				mode: 'proxy',
				message: outMessage,
				conversationId: selectedBook.conversationId,
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
			chatMessages.push({ role: 'assistant', text: displayMessage });
			if (fremdriftMatch && selectedBook) {
				void applyAutoProgress(selectedBook.id, parseInt(fremdriftMatch[1], 10), parseInt(fremdriftMatch[2], 10));
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

	async function loadClips() {
		if (!selectedBook) return;
		try {
			const res = await fetch(`/api/tema/${themeId}/books/${selectedBook.id}/clips`);
			if (res.ok) clips = await res.json();
		} catch { /* ignore */ }
		clipsLoaded = true;
	}

	$effect(() => {
		if (selectedBook && !clipsLoaded) {
			void loadClips();
		}
	});

	$effect(() => {
		// Scroll to bottom whenever the element mounts, messages load, or streaming text changes
		if (chatMessagesEl && (chatMessagesLoaded || chatStreamingText)) scrollChatToBottom();
	});

	$effect(() => {
		if (bookTab === 'fremdrift' && selectedBook && !progressLogLoaded) {
			void loadProgressLog();
		}
	});

	async function addClip() {
		if (!clipText.trim() || !selectedBook) { clipError = 'Tekst er påkrevd.'; return; }
		clipSaving = true;
		clipError = '';
		try {
			const characters = clipCharacters.trim()
				? clipCharacters.split(',').map((c) => c.trim()).filter(Boolean)
				: null;
			const res = await fetch(`/api/tema/${themeId}/books/${selectedBook.id}/clips`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					text: clipText.trim(),
					page: clipPage ? Number(clipPage) : null,
					position: clipPosition.trim() || null,
					note: clipNote.trim() || null,
					characters
				})
			});
			if (!res.ok) throw new Error();
			const clip: BookClip = await res.json();
			clips = [clip, ...clips];
			clipText = '';
			clipPage = '';
			clipPosition = '';
			clipNote = '';
			clipCharacters = '';
			showAddClip = false;
		} catch {
			clipError = 'Kunne ikke lagre klippet.';
		} finally {
			clipSaving = false;
		}
	}

	async function deleteClip(clipId: string) {
		if (!selectedBook) return;
		clips = clips.filter((c) => c.id !== clipId);
		await fetch(`/api/tema/${themeId}/books/${selectedBook.id}/clips/${clipId}`, { method: 'DELETE' });
	}

	async function saveProgress() {
		if (!selectedBook) return;
		progressSaving = true;
		progressError = '';
		try {
			const updates: Record<string, number> = {};

			if (selectedBook.format !== 'audio' && progressPage.trim()) {
				const page = parseInt(progressPage, 10);
				if (!Number.isFinite(page) || page < 0) { progressError = 'Ugyldig sidetall.'; progressSaving = false; return; }
				updates.currentPage = page;
			}

			if (selectedBook.format !== 'print') {
				const mins = (posHours || 0) * 60 + (posMins || 0);
				if (mins !== selectedBook.currentMinutes) updates.currentMinutes = mins;
				const total = (totalDurHours || 0) * 60 + (totalDurMins || 0);
				if (total > 0 && total !== selectedBook.totalMinutes) updates.totalMinutes = total;
			}

			if (Object.keys(updates).length === 0) { progressError = 'Ingen endringer.'; progressSaving = false; return; }

			const res = await fetch(`/api/tema/${themeId}/books/${selectedBook.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(updates)
			});
			if (!res.ok) throw new Error();
			const updated: Book = await res.json();
			selectedBook = updated;
			books = books.map((b) => (b.id === updated.id ? updated : b));
		} catch {
			progressError = 'Lagring feilet.';
		} finally {
			progressSaving = false;
		}
	}

	async function deleteBook() {
		if (!selectedBook) return;
		if (!confirm(`Slett «${selectedBook.title}»? Dette kan ikke angres.`)) return;
		const id = selectedBook.id;
		await fetch(`/api/tema/${themeId}/books/${id}`, { method: 'DELETE' });
		books = books.filter((b) => b.id !== id);
		selectedBook = null;
	}

	async function setStatus(status: Book['status']) {
		if (!selectedBook) return;
		try {
			const res = await fetch(`/api/tema/${themeId}/books/${selectedBook.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status })
			});
			if (!res.ok) throw new Error();
			const updated: Book = await res.json();
			selectedBook = updated;
			books = books.map((b) => (b.id === updated.id ? updated : b));
		} catch { /* ignore */ }
	}

	function progressPct(book: Book): number {
		if (!book.totalPages || book.totalPages <= 0) return 0;
		return Math.min(100, Math.round((book.currentPage / book.totalPages) * 100));
	}

	function minutesPct(book: Book): number {
		if (!book.totalMinutes || book.totalMinutes <= 0) return 0;
		return Math.min(100, Math.round(((book.currentMinutes || 0) / book.totalMinutes) * 100));
	}

	/** Format integer minutes as "Xt Ym" */
	function formatMinutes(mins: number): string {
		const h = Math.floor(mins / 60);
		const m = mins % 60;
		return h > 0 ? `${h}t ${m < 10 ? '0' : ''}${m}m` : `${m}m`;
	}

	/** Parse "1:25", "1:24:35", or raw "85" → integer minutes */
	function parseProgressMinutes(s: string): number | null {
		const trimmed = s.trim();
		if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
		const match = trimmed.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
		if (!match) return null;
		const h = parseInt(match[1], 10);
		const m = parseInt(match[2], 10);
		const secs = match[3] ? parseInt(match[3], 10) : 0;
		return Math.round(h * 60 + m + secs / 60);
	}

	function linReg(pts: { x: number; y: number }[]): { slope: number; intercept: number } | null {
		const n = pts.length;
		if (n < 2) return null;
		const sx = pts.reduce((s, p) => s + p.x, 0);
		const sy = pts.reduce((s, p) => s + p.y, 0);
		const sxy = pts.reduce((s, p) => s + p.x * p.y, 0);
		const sx2 = pts.reduce((s, p) => s + p.x * p.x, 0);
		const d = n * sx2 - sx * sx;
		if (d === 0) return null;
		const slope = (n * sxy - sx * sy) / d;
		return { slope, intercept: (sy - slope * sx) / n };
	}

	function fmtEta(d: Date): string {
		const months = ['jan','feb','mar','apr','mai','jun','jul','aug','sep','okt','nov','des'];
		return `${d.getDate()}. ${months[d.getMonth()]} ${d.getFullYear()}`;
	}

	function buildProgressChart(log: ProgressLogEntry[], book: Book): ProgressChartData | null {
		const metric: 'page' | 'minutes' = book.format === 'print' ? 'page' : 'minutes';
		const total = metric === 'page' ? (book.totalPages ?? 0) : (book.totalMinutes ?? 0);
		const dayMap = new Map<string, number>();
		for (const e of log) {
			const day = e.loggedAt.slice(0, 10);
			const v = metric === 'page' ? e.currentPage : e.currentMinutes;
			if (v !== null && v !== undefined) dayMap.set(day, v);
		}
		const rawDays = [...dayMap.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1);
		if (rawDays.length === 0) return null;

		const hasEnoughData = rawDays.length >= 2;
		const t0 = Date.parse(rawDays[0][0] + 'T00:00:00');
		const tLast = Date.parse(rawDays[rawDays.length - 1][0] + 'T00:00:00');

		let etaDate: Date | null = null;
		let paceLabel: string | null = null;
		let etaMs: number | null = null;
		let reg: { slope: number; intercept: number } | null = null;
		if (hasEnoughData && total > 0) {
			const regPts = rawDays.map(([day, val]) => ({
				x: (Date.parse(day + 'T00:00:00') - t0) / 86400000, y: val
			}));
			reg = linReg(regPts);
			if (reg && reg.slope > 0) {
				const etaDays = (total - reg.intercept) / reg.slope;
				if (etaDays > 0 && etaDays < 3650) {
					etaMs = t0 + etaDays * 86400000;
					etaDate = new Date(etaMs);
					paceLabel = metric === 'page'
						? `${reg.slope.toFixed(1)} sider/dag`
						: `${formatMinutes(Math.round(reg.slope))}/dag`;
				}
			}
		}

		const span = Math.max(tLast - t0, 86400000);
		const tMax = etaMs && etaMs > tLast && (etaMs - t0) < Math.max(span * 3, 30 * 86400000)
			? etaMs : tLast;
		const tRange = Math.max(tMax - t0, 86400000);
		const xOf = (ms: number) => CHART_PL + ((ms - t0) / tRange) * CHART_CW;
		const yOf = (v: number) => total > 0
			? CHART_PT + CHART_CH * (1 - Math.max(0, Math.min(v, total)) / total)
			: CHART_PT + CHART_CH;
		const f1 = (n: number) => parseFloat(n.toFixed(1));
		const fmtDay = (d: string) => { const [, mm, dd] = d.split('-'); return `${dd}.${mm}`; };

		const dots = rawDays.map(([day, val]) => {
			const ms = Date.parse(day + 'T00:00:00');
			const lbl = metric === 'page' ? `s.${val}` : formatMinutes(val);
			return { cx: f1(xOf(ms)), cy: f1(yOf(val)), label: `${fmtDay(day)}: ${lbl}` };
		});
		const linePath = dots.map((d, i) => `${i === 0 ? 'M' : 'L'}${d.cx},${d.cy}`).join(' ');

		let predPath: string | null = null;
		if (etaMs && dots.length >= 1) {
			const last = dots[dots.length - 1];
			const etaX = f1(Math.min(xOf(etaMs), CHART_PL + CHART_CW));
			predPath = `M${last.cx},${last.cy} L${etaX},${f1(yOf(total))}`;
		}

		const xLabels: { x: number; label: string; star?: boolean }[] = [
			{ x: f1(xOf(t0)), label: fmtDay(rawDays[0][0]) }
		];
		if (rawDays.length > 1) xLabels.push({ x: f1(xOf(tLast)), label: fmtDay(rawDays[rawDays.length - 1][0]) });
		if (etaDate && etaMs) {
			const d = etaDate;
			const lbl = `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}`;
			xLabels.push({ x: f1(Math.min(xOf(etaMs), CHART_PL + CHART_CW - 18)), label: lbl, star: true });
		}

		const yLines: { y: number; label: string }[] = [];
		if (total > 0) {
			const yl = (v: number) => metric === 'page' ? String(v) : formatMinutes(v);
			yLines.push({ y: f1(yOf(0)), label: yl(0) });
			yLines.push({ y: f1(yOf(total)), label: yl(total) });
		}
		return { linePath, predPath, dots, etaDate, paceLabel, xLabels, yLines, hasEnoughData };
	}

	async function loadProgressLog() {
		if (!selectedBook) return;
		try {
			const res = await fetch(`/api/tema/${themeId}/books/${selectedBook.id}/progress-log`);
			if (res.ok) progressLog = await res.json();
		} catch { /* ignore */ }
		progressLogLoaded = true;
	}

	function statusLabel(s: Book['status']): string {
		return s === 'not_started' ? 'Ikke startet' : s === 'reading' ? 'Leser' : s === 'completed' ? 'Ferdig' : 'Pause';
	}

	function statusEmoji(s: Book['status']): string {
		return s === 'not_started' ? '📚' : s === 'reading' ? '📖' : s === 'completed' ? '✅' : '⏸️';
	}

	function fmtDate(iso: string): string {
		return new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
	}
</script>

{#if selectedBook}
	<!-- ── Book view ── -->
	<div class="bk-view">
		{#if progressAutoSaved}
			<div class="bk-autosave-toast">✅ Fremdrift oppdatert automatisk</div>
		{/if}
		<div class="bk-header" class:collapsed={headerCollapsed}>
			<div class="bk-header-top">
				<button class="bk-back" onclick={closeBook}>
					<Icon name="back" size={16} /> Bibliotek
				</button>
				{#if headerCollapsed}
					<span class="bk-title-inline">{selectedBook.title}</span>
				{/if}
				<button class="bk-collapse-toggle" onclick={() => (headerCollapsed = !headerCollapsed)} aria-label="{headerCollapsed ? 'Vis detaljer' : 'Skjul detaljer'}">
					{headerCollapsed ? '▾' : '▴'}
				</button>
			</div>
			{#if !headerCollapsed}
				<div class="bk-meta">
					<span class="bk-title">{selectedBook.title}</span>
					{#if selectedBook.author}
						<span class="bk-author">{selectedBook.author}</span>
					{/if}
				</div>
				<div class="bk-status-row">
					<span class="bk-status-badge" class:reading={selectedBook.status === 'reading'} class:completed={selectedBook.status === 'completed'} class:paused={selectedBook.status === 'paused'}>
						{statusEmoji(selectedBook.status)} {statusLabel(selectedBook.status)}
					</span>
					{#if selectedBook.contextStatus === 'pending'}
						<span class="bk-ctx-badge pending">⏳ Samler bokkontekst…</span>
					{:else if selectedBook.contextStatus === 'ready'}
						<span class="bk-ctx-badge ready">✦ Kontekst klar</span>
					{/if}
				</div>
				{#if selectedBook.format !== 'audio' && selectedBook.totalPages}
					{@const pct = progressPct(selectedBook)}
					<div class="bk-progress-bar" title="{selectedBook.currentPage} av {selectedBook.totalPages} sider ({pct}%)">
						<div class="bk-progress-fill" style="width:{pct}%"></div>
					</div>
					<p class="bk-progress-label">{selectedBook.currentPage} / {selectedBook.totalPages} sider</p>
				{/if}
				{#if selectedBook.format !== 'print' && selectedBook.totalMinutes}
					{@const pct = minutesPct(selectedBook)}
					<div class="bk-progress-bar" title="🎧 {formatMinutes(selectedBook.currentMinutes)} av {formatMinutes(selectedBook.totalMinutes)} ({pct}%)">
						<div class="bk-progress-fill" style="width:{pct}%"></div>
					</div>
					<p class="bk-progress-label">🎧 {formatMinutes(selectedBook.currentMinutes)} / {formatMinutes(selectedBook.totalMinutes)}</p>
				{/if}
			{/if}
		</div>

		<!-- Tabs -->
		<div class="bk-tabs">
			<button class="bk-tab" class:active={bookTab === 'chat'} onclick={() => (bookTab = 'chat')}>💬 Chat</button>
			<button class="bk-tab" class:active={bookTab === 'klipp'} onclick={() => (bookTab = 'klipp')}>🔖 Klipp</button>
			<button class="bk-tab" class:active={bookTab === 'fremdrift'} onclick={() => (bookTab = 'fremdrift')}>📈 Fremdrift</button>
		</div>

		{#if bookTab === 'chat'}
			<!-- ── Chat ── -->
			<div class="bk-chat">
				<div class="bk-chat-messages" bind:this={chatMessagesEl} aria-live="polite">
					{#if !chatMessagesLoaded}
						<p class="bk-empty">Laster…</p>
					{:else if chatMessages.length === 0}
						<p class="bk-empty">
							{#if selectedBook.contextStatus === 'pending'}
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
					placeholder="Hva tenker du om «{selectedBook.title}»?"
					disabled={chatLoading || imageUploadLoading || audioUploadLoading}
					onsubmit={(msg) => sendChatMessage(msg)}
					onAttachment={(kind) => {
						if (kind === 'camera') bookImageInput?.click();
						else if (kind === 'voice') bookAudioInput?.click();
					}}
				/>

				<!-- ── Audio clips drawer ── -->
				{#if clipsLoaded && clips.some((c) => c.audioUrl)}
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

		{:else if bookTab === 'klipp'}
			<!-- ── Clips ── -->
			<div class="bk-clips-panel">
				<div class="bk-clips-actions">
					<button class="bk-action-btn" onclick={() => (showAddClip = !showAddClip)}>
						{showAddClip ? '× Avbryt' : '+ Nytt klipp'}
					</button>
				</div>

				{#if showAddClip}
					<div class="bk-clip-form">
						<textarea
							class="bk-clip-textarea"
							placeholder="Passasje, setning eller moment du vil huske…"
							bind:value={clipText}
							rows={3}
						></textarea>
						<div class="bk-clip-meta-row">
							<input class="bk-clip-input" type="number" min="1" placeholder="Side" bind:value={clipPage} />
							<input class="bk-clip-input" placeholder="Tid f.eks. 1:24:35" bind:value={clipPosition} />
						</div>
						<input
							class="bk-clip-input bk-clip-input-full"
							placeholder="Karakterer, f.eks. Line, Morgan (kommasepparert)"
							bind:value={clipCharacters}
						/>
						<textarea
							class="bk-clip-textarea"
							placeholder="Din refleksjon (valgfritt)…"
							bind:value={clipNote}
							rows={2}
						></textarea>
						{#if clipError}<p class="bk-error">{clipError}</p>{/if}
						<button class="bk-save-btn" onclick={addClip} disabled={clipSaving}>
							{clipSaving ? 'Lagrer…' : 'Lagre klipp'}
						</button>
					</div>
				{/if}

				{#if !clipsLoaded}
					<p class="bk-empty">Laster…</p>
				{:else if clips.length === 0}
					<p class="bk-empty">Ingen klipp ennå — lagre passasjer og øyeblikk du vil huske.</p>
				{:else}
					<div class="bk-clips-list">
						{#each clips as clip}
							{@const hasAudio = !!clip.audioUrl}
							<div class="bk-clip-card" class:bk-clip-audio={hasAudio}>

								<!-- Audio player (self-contained, handles scrubbing + karaoke) -->
								{#if hasAudio}
									<AudioKaraokePlayer
										src={clip.audioUrl!}
										words={clip.words}
										text={clip.text}
									/>
								{:else}
									<blockquote class="bk-clip-text">{clip.text}</blockquote>
								{/if}

								<!-- Footer: position, characters, date, delete -->
								<div class="bk-clip-footer">
									{#if clip.page}<span class="bk-clip-loc">📄 Side {clip.page}</span>{/if}
									{#if clip.position}<span class="bk-clip-loc">⏱ {clip.position}</span>{/if}
									{#if clip.characters?.length}
										{#each clip.characters as char}
											<span class="bk-clip-char">{char}</span>
										{/each}
									{/if}
									<span class="bk-clip-date">{fmtDate(clip.createdAt)}</span>
									<button class="bk-clip-delete" onclick={() => deleteClip(clip.id)} aria-label="Slett klipp">×</button>
								</div>
								{#if clip.note}
									<p class="bk-clip-note">{clip.note}</p>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>

		{:else if bookTab === 'fremdrift'}
			<!-- ── Progress ── -->
			<div class="bk-fremdrift-panel">
				<div class="bk-fremdrift-section">
					<p class="bk-fremdrift-label">Status</p>
					<div class="bk-status-btns">
						{#each (['not_started', 'reading', 'paused', 'completed'] as const) as s}
							<button
								class="bk-status-btn"
								class:active={selectedBook.status === s}
								onclick={() => setStatus(s)}
							>{statusEmoji(s)} {statusLabel(s)}</button>
						{/each}
					</div>
				</div>

				{#if selectedBook.format !== 'audio'}
					<div class="bk-fremdrift-section">
						<p class="bk-fremdrift-label">Sider lest</p>
						<div class="bk-page-row">
							<input
								class="bk-page-input"
								type="number"
								min="0"
								placeholder="Side"
								bind:value={progressPage}
							/>
							{#if selectedBook.totalPages}
								<span class="bk-page-of">av {selectedBook.totalPages}</span>
							{/if}
						</div>
					</div>
				{/if}

				{#if selectedBook.format !== 'print'}
					<div class="bk-fremdrift-section">
						<p class="bk-fremdrift-label">Posisjon</p>
						{#if (totalDurHours || 0) * 60 + (totalDurMins || 0) > 0}
							{@const sliderMax = (totalDurHours || 0) * 60 + (totalDurMins || 0)}
							<input
								type="range"
								class="bk-time-slider"
								min="0"
								max={sliderMax}
								value={(posHours || 0) * 60 + (posMins || 0)}
								oninput={(e) => {
									const v = parseInt((e.target as HTMLInputElement).value);
									posHours = Math.floor(v / 60);
									posMins = v % 60;
								}}
							/>
						{/if}
						<div class="bk-hm-row">
							<div class="bk-hm-field">
								<input type="number" class="bk-hm-input" min="0" bind:value={posHours} />
								<span class="bk-hm-label">t</span>
							</div>
							<div class="bk-hm-field">
								<input type="number" class="bk-hm-input" min="0" max="59" bind:value={posMins} />
								<span class="bk-hm-label">min</span>
							</div>
							{#if (totalDurHours || 0) * 60 + (totalDurMins || 0) > 0}
								<span class="bk-hm-of">av {totalDurHours}t {totalDurMins < 10 ? '0' : ''}{totalDurMins}m</span>
							{/if}
						</div>

						{#if !selectedBook.totalMinutes || totalDurExpanded}
							<p class="bk-fremdrift-label" style="margin-top:0.75rem">Total varighet</p>
							<div class="bk-hm-row">
								<div class="bk-hm-field">
									<input type="number" class="bk-hm-input" min="0" bind:value={totalDurHours} />
									<span class="bk-hm-label">t</span>
								</div>
								<div class="bk-hm-field">
									<input type="number" class="bk-hm-input" min="0" max="59" bind:value={totalDurMins} />
									<span class="bk-hm-label">min</span>
								</div>
							</div>
						{:else}
							<p class="bk-fremdrift-meta">Varighet: {formatMinutes(selectedBook.totalMinutes)} <button class="bk-link" onclick={() => (totalDurExpanded = true)}>Endre</button></p>
						{/if}
					</div>
				{/if}

				<div class="bk-fremdrift-section">
					<button class="bk-save-btn bk-save-btn-sm" onclick={saveProgress} disabled={progressSaving}>
						{progressSaving ? '…' : 'Lagre fremdrift'}
					</button>
					{#if progressError}<p class="bk-error">{progressError}</p>{/if}
				</div>

				{#if selectedBook.format !== 'audio' && selectedBook.totalPages}
					{@const pct = progressPct(selectedBook)}
					<div class="bk-big-progress" title="{selectedBook.currentPage}/{selectedBook.totalPages} sider">
						<div class="bk-big-fill" style="width:{pct}%"></div>
						<span class="bk-big-pct">{pct}% sider</span>
					</div>
				{/if}

				{#if selectedBook.format !== 'print' && selectedBook.totalMinutes}
					{@const pct = minutesPct(selectedBook)}
					<div class="bk-big-progress" title="{formatMinutes(selectedBook.currentMinutes)} av {formatMinutes(selectedBook.totalMinutes)}">
						<div class="bk-big-fill" style="width:{pct}%"></div>
						<span class="bk-big-pct">{pct}% lyd · {formatMinutes(selectedBook.currentMinutes)}</span>
					</div>
				{/if}

				<div class="bk-fremdrift-section">
					<p class="bk-fremdrift-label">Format</p>
					<div class="bk-format-btns">
						{#each ([['print', '📖 Papir'], ['audio', '🎧 Lydbok'], ['both', '📖🎧 Begge']] as const) as [f, label]}
							<button
								class="bk-status-btn"
								class:active={selectedBook.format === f}
								onclick={async () => {
									const res = await fetch(`/api/tema/${themeId}/books/${selectedBook!.id}`, {
										method: 'PATCH', headers: { 'Content-Type': 'application/json' },
										body: JSON.stringify({ format: f })
									});
									if (res.ok) { const u: Book = await res.json(); selectedBook = u; books = books.map(b => b.id === u.id ? u : b); }
								}}
							>{label}</button>
						{/each}
					</div>
				</div>

				{#if selectedBook.startedAt}
					<p class="bk-fremdrift-info">Startet: {fmtDate(selectedBook.startedAt)}</p>
				{/if}
				{#if selectedBook.finishedAt}
					<p class="bk-fremdrift-info">Ferdig: {fmtDate(selectedBook.finishedAt)}</p>
				{/if}

				<!-- Progress chart -->
				<div class="bk-fremdrift-section">
					<p class="bk-fremdrift-label">Fremdriftsgraf</p>
					{#if !progressLogLoaded}
						<p class="bk-empty" style="padding:4px 0">Laster…</p>
					{:else if !progressChart}
						<p class="bk-empty" style="padding:4px 0">Logg fremdrift for å se graf.</p>
					{:else}
						<svg class="bk-chart-svg" viewBox="0 0 {CHART_VW} {CHART_VH}" aria-label="Fremdriftsgraf">
							{#each progressChart.yLines as yl}
								<line class="bk-chart-grid" x1={CHART_PL} y1={yl.y} x2={CHART_PL + CHART_CW} y2={yl.y} />
								<text class="bk-chart-ylabel" x={CHART_PL - 4} y={yl.y + 4} text-anchor="end">{yl.label}</text>
							{/each}
							{#if progressChart.predPath}
								<path class="bk-chart-pred" d={progressChart.predPath} />
							{/if}
							<path class="bk-chart-line" d={progressChart.linePath} />
							{#each progressChart.dots as dot}
								<circle class="bk-chart-dot" cx={dot.cx} cy={dot.cy} r="3.5"><title>{dot.label}</title></circle>
							{/each}
							<line class="bk-chart-axis" x1={CHART_PL} y1={CHART_PT + CHART_CH} x2={CHART_PL + CHART_CW} y2={CHART_PT + CHART_CH} />
							{#each progressChart.xLabels as xl}
								<text class="bk-chart-xlabel" class:bk-chart-xlabel-eta={xl.star} x={xl.x} y={CHART_VH - 2} text-anchor="middle">{xl.label}</text>
							{/each}
						</svg>
						<div class="bk-chart-meta">
							{#if progressChart.paceLabel}<span class="bk-chart-pace">⚡ {progressChart.paceLabel}</span>{/if}
							{#if progressChart.etaDate}<span class="bk-chart-eta">📅 Est. ferdig: <strong>{fmtEta(progressChart.etaDate)}</strong></span>{/if}
							{#if !progressChart.hasEnoughData}<span class="bk-chart-hint">Logg på flere dager for prediksjon.</span>{/if}
						</div>
					{/if}
				</div>

				<div class="bk-fremdrift-section" style="margin-top:1.5rem">
					<button class="bk-delete-btn" onclick={deleteBook}>🗑 Slett bok</button>
				</div>
			</div>
		{/if}
	</div>

{:else}
	<!-- ── Library view ── -->
	<div class="bk-library">
		<div class="bk-lib-actions">
			<button class="bk-action-btn" onclick={() => { showSearch = !showSearch; if (!showSearch) closeSearch(); }}>
				{showSearch ? '× Avbryt' : '+ Legg til bok'}
			</button>
		</div>

		{#if showSearch}
			<div class="bk-search-panel">
				{#if !manualMode}
					<div class="bk-search-row">
						<input
							class="bk-search-input"
							placeholder="Søk på tittel eller forfatter…"
							bind:value={searchQuery}
							oninput={onSearchInput}
						/>
						{#if searchLoading}
							<span class="bk-search-spinner">⏳</span>
						{/if}
					</div>

					{#if searchError}
						<p class="bk-error">{searchError}</p>
					{/if}

					{#if searchResults.length > 0}
						<div class="bk-results">
							{#each searchResults as result}
								<button
									class="bk-result-row"
									disabled={addSaving}
									onclick={() => addBook(result)}
								>
									{#if result.coverUrl}
										<img class="bk-result-cover" src={result.coverUrl} alt="" loading="lazy" />
									{:else}
										<div class="bk-result-cover bk-result-cover-placeholder">📚</div>
									{/if}
									<div class="bk-result-info">
										<span class="bk-result-title">{result.title}</span>
										{#if result.author}<span class="bk-result-author">{result.author}</span>{/if}
										<span class="bk-result-meta">
											{#if result.year}{result.year}{/if}
											{#if result.year && result.totalPages} · {/if}
											{#if result.totalPages}{result.totalPages} s.{/if}
										</span>
									</div>
								</button>
							{/each}
						</div>
					{/if}

					{#if addError}<p class="bk-error">{addError}</p>{/if}

					<button class="bk-manual-link" onclick={() => (manualMode = true)}>
						Legg til manuelt
					</button>
					<button class="bk-manual-link" onclick={() => bookDiscoverInput?.click()} disabled={discoverLoading}>
						{discoverLoading ? '⏳ Analyserer bilde…' : '📷 Oppdag bok fra bilde'}
					</button>
					{#if discoverError}<p class="bk-error">{discoverError}</p>{/if}
					<input type="file" accept="image/*" style="display:none" bind:this={bookDiscoverInput} onchange={discoverBookFromImage} />
				{:else}
					<div class="bk-add-form">
						<input class="bk-add-input" placeholder="Tittel *" bind:value={manualTitle} />
						<input class="bk-add-input" placeholder="Forfatter (valgfritt)" bind:value={manualAuthor} />
						<div class="bk-format-btns" style="margin-bottom:0.5rem">
							{#each ([['print', '📖 Papir'], ['audio', '🎧 Lydbok'], ['both', '📖🎧 Begge']] as const) as [f, label]}
								<button type="button" class="bk-status-btn" class:active={manualFormat === f} onclick={() => (manualFormat = f)}>{label}</button>
							{/each}
						</div>
						{#if manualFormat !== 'audio'}
							<input class="bk-add-input" type="number" min="1" placeholder="Antall sider (valgfritt)" bind:value={manualPages} />
						{/if}
						{#if manualFormat !== 'print'}
							<input class="bk-add-input" placeholder="Total lydboktid, minutter (valgfritt)" bind:value={manualTotalMinutes} />
						{/if}
						{#if addError}<p class="bk-error">{addError}</p>{/if}
						<div class="bk-manual-actions">
							<button class="bk-manual-link" onclick={() => (manualMode = false)}>← Tilbake til søk</button>
							<button
								class="bk-save-btn"
								onclick={() => addBook({
									title: manualTitle.trim(),
									author: manualAuthor.trim() || null,
									coverUrl: null,
									totalPages: manualPages ? Number(manualPages) : null,
									format: manualFormat,
									totalMinutes: manualTotalMinutes ? Number(manualTotalMinutes) : null
								})}
								disabled={addSaving || !manualTitle.trim()}
							>
								{addSaving ? 'Legger til…' : 'Legg til bok'}
							</button>
						</div>
					</div>
				{/if}
			</div>
		{/if}

		{#if booksLoading}
			<p class="bk-empty">Laster bøker…</p>
		{:else if booksError}
			<p class="bk-error">{booksError}</p>
		{:else if books.length === 0}
			<div class="bk-empty-state">
				<p class="bk-empty-icon">📚</p>
				<p>Ingen bøker ennå.</p>
				<p class="bk-empty-sub">Legg til en bok for å starte en samtale om den.</p>
			</div>
		{:else}
			<div class="bk-grid">
				{#each books as book}
					{@const pct = progressPct(book)}
					<button class="bk-card" onclick={() => openBook(book)}>
						<div class="bk-card-top">
							<div class="bk-card-info">
								<span class="bk-card-title">{book.title}</span>
								{#if book.author}<span class="bk-card-author">{book.author}</span>{/if}
							</div>
							<span class="bk-card-status-dot" class:reading={book.status === 'reading'} class:completed={book.status === 'completed'} title={statusLabel(book.status)}></span>
						</div>
						{#if book.format !== 'audio' && book.totalPages}
							{@const pct = progressPct(book)}
							<div class="bk-card-bar"><div class="bk-card-fill" style="width:{pct}%"></div></div>
							<p class="bk-card-pct">{pct}% · {book.currentPage}/{book.totalPages} s.</p>
						{:else if book.format !== 'print' && book.totalMinutes}
							{@const pct = minutesPct(book)}
							<div class="bk-card-bar"><div class="bk-card-fill" style="width:{pct}%"></div></div>
							<p class="bk-card-pct">🎧 {pct}% · {formatMinutes(book.currentMinutes)}</p>
						{:else}
							<p class="bk-card-pct">{statusEmoji(book.status)} {statusLabel(book.status)}</p>
						{/if}
					</button>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	/* ── Book view ──────────────────────────────────────── */
	.bk-view {
		position: fixed;
		inset: 0;
		z-index: 80;
		background: #0c0c14;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.bk-header {
		padding: 10px 16px 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
		border-bottom: 1px solid #1e1e1e;
		padding-bottom: 10px;
		flex-shrink: 0;
	}
	.bk-header.collapsed {
		padding-bottom: 6px;
	}

	.bk-header-top {
		display: flex;
		align-items: center;
	}

	.bk-title-inline {
		flex: 1;
		font-size: 0.88rem;
		font-weight: 600;
		color: #d0d0e8;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		padding: 0 8px;
	}

	.bk-collapse-toggle {
		margin-left: auto;
		background: none;
		border: none;
		color: #555;
		font-size: 0.85rem;
		cursor: pointer;
		padding: 2px 4px;
		line-height: 1;
		border-radius: 4px;
		transition: color 0.15s;
	}
	.bk-collapse-toggle:hover { color: #aaa; }

	.bk-back {
		display: flex;
		align-items: center;
		gap: 6px;
		background: none;
		border: none;
		color: #7c8ef5;
		font-size: 0.82rem;
		cursor: pointer;
		padding: 0;
	}

	.bk-meta {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-top: 4px;
	}

	.bk-title {
		font-size: 1rem;
		font-weight: 700;
		color: #f0f0f0;
		line-height: 1.2;
	}

	.bk-author {
		font-size: 0.8rem;
		color: #8a8a8a;
	}

	.bk-status-row {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		margin-top: 4px;
	}

	.bk-status-badge {
		font-size: 0.72rem;
		padding: 2px 8px;
		border-radius: 99px;
		border: 1px solid #2a2a2a;
		color: #8a8a8a;
	}
	.bk-status-badge.reading { color: #7c8ef5; border-color: #3b3e6a; }
	.bk-status-badge.completed { color: #48b581; border-color: #2a4a3a; }
	.bk-status-badge.paused { color: #e0a050; border-color: #4a3a1a; }

	.bk-ctx-badge {
		font-size: 0.7rem;
		padding: 2px 8px;
		border-radius: 99px;
	}
	.bk-ctx-badge.pending { background: #1e1e10; color: #8a8a50; border: 1px solid #3a3a20; }
	.bk-ctx-badge.ready { background: #0f1e1a; color: #48b581; border: 1px solid #2a4a3a; }

	.bk-progress-bar {
		height: 4px;
		background: #1e1e1e;
		border-radius: 99px;
		overflow: hidden;
		margin-top: 6px;
	}

	.bk-progress-fill {
		height: 100%;
		background: linear-gradient(90deg, #7c8ef5, #5a70ee);
		border-radius: 99px;
		transition: width 0.4s ease;
	}

	.bk-progress-label {
		font-size: 0.72rem;
		color: #6a6a6a;
		margin: 0;
	}

	/* Tabs */
	.bk-tabs {
		display: flex;
		gap: 4px;
		padding: 8px 16px 0;
		flex-shrink: 0;
	}

	.bk-tab {
		flex: 1;
		font: inherit;
		font-size: 0.78rem;
		padding: 6px 4px;
		background: none;
		border: 1px solid #1e1e1e;
		border-radius: 8px;
		color: #666;
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
	}
	.bk-tab.active {
		color: #c8ccff;
		border-color: #3b3e6a;
		background: #111a2a;
	}

	/* Chat */
	.bk-chat {
		display: flex;
		flex-direction: column;
		flex: 1;
		overflow: hidden;
		padding-top: 8px;
	}

	.bk-chat-messages {
		flex: 1;
		overflow-y: auto;
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

	/* Clips */
	.bk-clips-panel {
		padding: 12px 16px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 12px;
		flex: 1;
	}

	.bk-clips-actions {
		display: flex;
		justify-content: flex-end;
	}

	.bk-clip-form {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px;
		background: #0f0f10;
		border: 1px solid #1e1e1e;
		border-radius: 10px;
	}

	.bk-clip-textarea {
		width: 100%;
		background: #141414;
		border: 1px solid #2a2a2a;
		border-radius: 8px;
		color: #e8e8e8;
		font: inherit;
		font-size: 0.85rem;
		padding: 8px 10px;
		resize: vertical;
		box-sizing: border-box;
	}

	.bk-clip-meta-row {
		display: flex;
		gap: 8px;
	}

	.bk-clip-input {
		flex: 1;
		background: #141414;
		border: 1px solid #2a2a2a;
		border-radius: 8px;
		color: #e8e8e8;
		font: inherit;
		font-size: 0.82rem;
		padding: 6px 10px;
	}

	.bk-clips-list {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.bk-clip-card {
		background: #0f0f10;
		border: 1px solid #1e1e1e;
		border-radius: 10px;
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.bk-clip-text {
		margin: 0;
		font-style: italic;
		font-size: 0.88rem;
		color: #d0d0d0;
		line-height: 1.5;
		border-left: 3px solid #3b3e6a;
		padding-left: 10px;
	}

	.bk-clip-footer {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
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

	.bk-clip-delete {
		background: none;
		border: none;
		color: #555;
		font-size: 1rem;
		cursor: pointer;
		padding: 0 2px;
		line-height: 1;
	}
	.bk-clip-delete:hover { color: #e07070; }

	.bk-clip-note {
		margin: 0;
		font-size: 0.8rem;
		color: #7a7a7a;
		padding-top: 4px;
		border-top: 1px solid #1a1a1a;
	}

	.bk-clip-input-full {
		width: 100%;
		box-sizing: border-box;
	}

	/* Audio clip card accent */
	.bk-clip-audio {
		border-color: #2a2a4a;
	}

	/* Character tags */
	.bk-clip-char {
		font-size: 0.7rem;
		padding: 2px 7px;
		border-radius: 99px;
		background: #1a1a2a;
		border: 1px solid #3a3a5a;
		color: #9090c8;
	}

	/* ── Audio clips drawer in chat tab ── */
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

	/* Progress */
	.bk-fremdrift-panel {
		padding: 16px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 20px;
		flex: 1;
	}

	.bk-fremdrift-section {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.bk-fremdrift-label {
		font-size: 0.78rem;
		font-weight: 600;
		color: #888;
		margin: 0;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.bk-status-btns {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.bk-status-btn {
		font: inherit;
		font-size: 0.78rem;
		padding: 6px 12px;
		border-radius: 8px;
		border: 1px solid #2a2a2a;
		background: #141414;
		color: #888;
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
	}
	.bk-status-btn.active {
		color: #c8ccff;
		border-color: #3b3e6a;
		background: #111a2a;
	}

	.bk-page-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.bk-page-input {
		width: 80px;
		background: #141414;
		border: 1px solid #2a2a2a;
		border-radius: 8px;
		color: #e8e8e8;
		font: inherit;
		font-size: 0.9rem;
		padding: 8px 10px;
	}

	.bk-page-of {
		font-size: 0.82rem;
		color: #666;
	}

	.bk-time-slider {
		width: 100%;
		margin: 4px 0 10px;
		accent-color: #6b7fff;
		cursor: pointer;
	}

	.bk-hm-row {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}

	.bk-hm-field {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.bk-hm-input {
		width: 58px;
		text-align: center;
		background: #141414;
		border: 1px solid #2a2a2a;
		border-radius: 8px;
		color: #e8e8e8;
		font: inherit;
		font-size: 1rem;
		padding: 6px 8px;
	}

	.bk-hm-label {
		font-size: 0.82rem;
		color: #888;
	}

	.bk-hm-of {
		font-size: 0.82rem;
		color: #555;
		margin-left: 4px;
	}

	.bk-big-progress {
		position: relative;
		height: 24px;
		background: #1a1a1a;
		border-radius: 12px;
		overflow: hidden;
	}

	.bk-big-fill {
		height: 100%;
		background: linear-gradient(90deg, #7c8ef5, #5a70ee);
		transition: width 0.4s ease;
	}

	.bk-big-pct {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		font-size: 0.78rem;
		font-weight: 700;
		color: #fff;
		pointer-events: none;
	}

	.bk-fremdrift-info {
		font-size: 0.78rem;
		color: #666;
		margin: 0;
	}

	.bk-fremdrift-meta {
		font-size: 0.82rem;
		color: #888;
		margin: 0.4rem 0 0;
	}

	.bk-link {
		background: none;
		border: none;
		color: #7c8ef5;
		font-size: inherit;
		cursor: pointer;
		padding: 0;
		text-decoration: underline;
	}

	.bk-autosave-toast {
		position: absolute;
		top: 8px;
		left: 50%;
		transform: translateX(-50%);
		background: #1a2a1a;
		border: 1px solid #2d5a2d;
		color: #7ec87e;
		font-size: 0.82rem;
		padding: 6px 14px;
		border-radius: 20px;
		z-index: 90;
		white-space: nowrap;
		pointer-events: none;
	}

	/* Library */
	.bk-library {
		padding: 12px 16px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 12px;
		flex: 1;
	}

	.bk-lib-actions {
		display: flex;
		justify-content: flex-end;
	}

	/* ── Search panel ── */
	.bk-search-panel {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.bk-search-row {
		position: relative;
		display: flex;
		align-items: center;
	}

	.bk-search-input {
		flex: 1;
		background: #141414;
		border: 1px solid #2a2a2a;
		border-radius: 10px;
		color: #e8e8e8;
		font: inherit;
		font-size: 0.92rem;
		padding: 10px 36px 10px 12px;
		outline: none;
		transition: border-color 0.15s;
	}
	.bk-search-input:focus { border-color: #444; }

	.bk-search-spinner {
		position: absolute;
		right: 10px;
		font-size: 0.9rem;
		animation: spin 1s linear infinite;
	}

	@keyframes spin { to { transform: rotate(360deg); } }

	.bk-results {
		display: flex;
		flex-direction: column;
		gap: 4px;
		max-height: 320px;
		overflow-y: auto;
	}

	.bk-result-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 10px;
		background: #0f0f10;
		border: 1px solid #1e1e1e;
		border-radius: 8px;
		cursor: pointer;
		text-align: left;
		width: 100%;
		transition: border-color 0.12s, background 0.12s;
	}
	.bk-result-row:hover:not(:disabled) { background: #161616; border-color: #333; }
	.bk-result-row:disabled { opacity: 0.5; cursor: not-allowed; }

	.bk-result-cover {
		width: 38px;
		height: 54px;
		object-fit: cover;
		border-radius: 4px;
		flex-shrink: 0;
	}
	.bk-result-cover-placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		background: #1a1a1a;
		font-size: 1.2rem;
	}

	.bk-result-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.bk-result-title {
		font-size: 0.9rem;
		font-weight: 500;
		color: #e8e8e8;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.bk-result-author {
		font-size: 0.8rem;
		color: #888;
	}
	.bk-result-meta {
		font-size: 0.75rem;
		color: #555;
	}

	.bk-manual-link {
		background: none;
		border: none;
		color: #555;
		cursor: pointer;
		font: inherit;
		font-size: 0.8rem;
		padding: 4px 0;
		text-decoration: underline;
		text-align: left;
		width: fit-content;
	}
	.bk-manual-link:hover { color: #888; }

	.bk-manual-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	/* ── Add form (manual fallback) ── */
	.bk-add-form {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px;
		background: #0f0f10;
		border: 1px solid #1e1e1e;
		border-radius: 10px;
	}

	.bk-add-input {
		background: #141414;
		border: 1px solid #2a2a2a;
		border-radius: 8px;
		color: #e8e8e8;
		font: inherit;
		font-size: 0.88rem;
		padding: 8px 10px;
	}

	.bk-empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 48px 20px;
		color: #666;
		font-size: 0.85rem;
		text-align: center;
	}

	.bk-empty-icon { font-size: 2rem; margin: 0; }
	.bk-empty-sub { font-size: 0.78rem; color: #444; }

	.bk-grid {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.bk-card {
		background: #0f0f10;
		border: 1px solid #1e1e1e;
		border-radius: 12px;
		padding: 12px 14px;
		text-align: left;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		gap: 6px;
		transition: border-color 0.15s;
	}
	.bk-card:hover { border-color: #3b3e6a; }

	.bk-card-top {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 8px;
	}

	.bk-card-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.bk-card-title {
		font-size: 0.9rem;
		font-weight: 600;
		color: #e0e0e0;
		line-height: 1.3;
	}

	.bk-card-author {
		font-size: 0.78rem;
		color: #7a7a7a;
	}

	.bk-card-status-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
		margin-top: 4px;
		background: #3a3a3a;
	}
	.bk-card-status-dot.reading { background: #7c8ef5; }
	.bk-card-status-dot.completed { background: #48b581; }

	.bk-card-bar {
		height: 3px;
		background: #1a1a1a;
		border-radius: 99px;
		overflow: hidden;
	}

	.bk-card-fill {
		height: 100%;
		background: #7c8ef5;
	}

	.bk-card-pct {
		font-size: 0.72rem;
		color: #666;
		margin: 0;
	}

	/* Shared */
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

	.bk-action-btn {
		font: inherit;
		font-size: 0.8rem;
		padding: 7px 14px;
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		color: #7c8ef5;
		border-radius: 99px;
		cursor: pointer;
	}
	.bk-action-btn:hover { border-color: #7c8ef5; }

	.bk-save-btn {
		font: inherit;
		font-size: 0.82rem;
		padding: 8px 16px;
		background: #1e2244;
		border: 1px solid #3b3e6a;
		color: #c8ccff;
		border-radius: 8px;
		cursor: pointer;
		align-self: flex-start;
	}
	.bk-save-btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.bk-save-btn:hover:not(:disabled) { background: #252b55; }

	.bk-save-btn-sm {
		padding: 6px 12px;
	}
	.bk-delete-btn {
		font: inherit;
		font-size: 0.82rem;
		padding: 6px 12px;
		background: transparent;
		border: 1px solid #6a3b3b;
		color: #ff9999;
		border-radius: 8px;
		cursor: pointer;
	}
	.bk-delete-btn:hover { background: #3b1e1e; }

	/* ── Progress chart ──────────────────────────────────── */
	.bk-chart-svg { width: 100%; height: auto; display: block; overflow: visible; }
	.bk-chart-grid { stroke: #1e1e2a; stroke-width: 1; }
	.bk-chart-axis { stroke: #2a2a3a; stroke-width: 1; }
	.bk-chart-line { fill: none; stroke: #6b7fff; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
	.bk-chart-pred { fill: none; stroke: #6b7fff; stroke-width: 1.5; stroke-dasharray: 4 3; opacity: 0.5; }
	.bk-chart-dot { fill: #6b7fff; stroke: #0d0d14; stroke-width: 1.5; cursor: default; }
	.bk-chart-ylabel { fill: #555; font-size: 9px; }
	.bk-chart-xlabel { fill: #555; font-size: 9px; }
	.bk-chart-xlabel-eta { fill: #88aaff; }
	.bk-chart-meta { display: flex; flex-wrap: wrap; gap: 6px 14px; padding: 6px 0 2px; font-size: 0.79rem; }
	.bk-chart-pace { color: #a0a8ff; }
	.bk-chart-eta { color: #c8d4ff; }
	.bk-chart-hint { color: #555; font-size: 0.76rem; }
</style>
