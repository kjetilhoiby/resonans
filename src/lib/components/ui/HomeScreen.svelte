<!--
  HomeScreen — fire-sone hjemskjerm.

  Layout: 10 / 35 / 20 / 35  (tittel / widgets / tema / input)
  Ingen tab-bar, ingen overlays. Soner animerer til fullskjerm ved tap.

  Props:
    themes    aktive temaer fra DB (for ThemeRail)
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import WidgetCircle from './WidgetCircle.svelte';
	import DynamicWidget from './DynamicWidget.svelte';
	import WidgetConfigSheet from './WidgetConfigSheet.svelte';
	import ThemeRail from './ThemeRail.svelte';
	import ChatInput from './ChatInput.svelte';
	import TriageCard from './TriageCard.svelte';
	import ChecklistWidget, { type Checklist } from './ChecklistWidget.svelte';
	import ChecklistSheet from './ChecklistSheet.svelte';

	interface Theme {
		id: string;
		name: string;
		emoji: string;
	}

	interface Props {
		themes: Theme[];
	}

	type QuickActionId = 'chat' | 'camera' | 'voice' | 'mood' | 'file';

	interface QuickAction {
		id: QuickActionId;
		label: string;
		icon: string;
		description: string;
		placeholder: string;
		helper: string;
	}

	let { themes }: Props = $props();

	// -- Sensor-data (oppdateres fra API ved mount) --
	interface SensorSummary {
		weight: { current: number | null; unit: string; delta: number; sparkline: number[] };
		sleep: { current: number | null; unit: string; sparkline: number[] };
		steps: { current: number | null; unit: string; sparkline: number[] };
		running: { weekKm: number; unit: string; sparkline: number[] };
		spending: { current: number; unit: string; delta: number; sparkline: number[] };
	}

	let sensorSummary = $state<SensorSummary | null>(null);

	// -- Pinned user-widgets fra DB --
	interface UserWidget {
		id: string;
		title: string;
		unit: string;
		color: string;
		pinned: boolean;
		metricType: string;
		goal: number | null;
		thresholdWarn: number | null;
		thresholdSuccess: number | null;
	}
	let pinnedWidgets = $state<UserWidget[]>([]);
	let configWidget = $state<UserWidget | null>(null);

	// -- Sjekklister --
	let activeChecklists = $state<Checklist[]>([]);
	let openChecklist = $state<Checklist | null>(null);

	async function fetchChecklists() {
		try {
			const res = await fetch('/api/checklists?active=true');
			if (res.ok) activeChecklists = await res.json();
		} catch { /* stille */ }
	}

	onMount(async () => {
		try {
			const [summaryRes, widgetsRes] = await Promise.all([
				fetch('/api/sensor-summary'),
				fetch('/api/user-widgets?pinned=true')
			]);
			if (summaryRes.ok) sensorSummary = await summaryRes.json();
			if (widgetsRes.ok) pinnedWidgets = await widgetsRes.json();
		} catch {
			// Stille feil — fallback til mock-data
		}
		await fetchChecklists();
		// Åpne chat-overlay automatisk hvis ?chat=1 er satt i URL
		if ($page.url.searchParams.get('chat') === '1') {
			openChat();
		}
	});

	// -- Widgets (live eller mock) --
	const WIDGETS = $derived([
		{
			label: 'Vekt',
			sensorType: 'weight' as const,
			val: sensorSummary?.weight.current != null
				? String(sensorSummary.weight.current)
				: '–',
			unit: 'kg',
			color: '#e07070',
			delta: sensorSummary?.weight.delta
				? `${sensorSummary.weight.delta > 0 ? '+' : ''}${sensorSummary.weight.delta} kg`
				: '',
			pct: sensorSummary?.weight.current != null
				? Math.max(0, Math.min(100, Math.round((1 - (sensorSummary.weight.current - 88) / 88) * 100)))
				: 68,
		},
		{
			label: 'Søvn',
			sensorType: 'sleep' as const,
			val: sensorSummary?.sleep.current != null
				? String(sensorSummary.sleep.current)
				: '–',
			unit: 'h',
			color: '#5fa0a0',
			delta: '',
			pct: sensorSummary?.sleep.current != null
				? Math.min(100, Math.round((sensorSummary.sleep.current / 7.5) * 100))
				: 84,
		},
		{
			label: 'Løping',
			sensorType: 'running' as const,
			val: sensorSummary
				? String(sensorSummary.running.weekKm)
				: '–',
			unit: 'km',
			color: '#7c8ef5',
			delta: '',
			pct: sensorSummary
				? Math.min(100, Math.round((sensorSummary.running.weekKm / 30) * 100))
				: 55,
			isRelation: false,
		},
		{
			label: 'Økonomi',
			sensorType: 'spending' as const,
			val: sensorSummary?.spending.current
				? `${Math.round(sensorSummary.spending.current / 1000)}k`
				: '–',
			unit: 'kr',
			color: '#f0b429',
			delta: sensorSummary?.spending.delta
				? `${sensorSummary.spending.delta > 0 ? '+' : ''}${Math.round(sensorSummary.spending.delta / 1000)}k`
				: '',
			pct: sensorSummary?.spending.current
				? Math.max(0, Math.min(100, Math.round((1 - sensorSummary.spending.current / 25000) * 100)))
				: 72,
		},
	]);

	// -- Chat-sone --
	let chatOpen = $state(false);
	let chatPrefill = $state('');
	let chatMessages = $state<{ role: 'user' | 'assistant'; text: string; imageUrl?: string }[]>([]);
	let chatLoading = $state(false);
	let currentConversationId = $state<string | null>(null);
	let latestClosedConversationId = $state<string | null>(null);
	let createdThemeLink = $state<{ id: string; name: string; emoji?: string | null } | null>(null);
	let launchingThemeId = $state<string | null>(null);

	// ── Kamera-flyt ────────────────────────────────────────────────────────────
	let cameraOpen = $state(false);
	let cameraFileInput = $state<HTMLInputElement | null>(null);
	let cameraSelectedFile = $state<File | null>(null);
	let cameraPreview = $state<string | null>(null);
	let cameraCaption = $state('');
	let cameraUploading = $state(false);
	let cameraError = $state(false);

	// ── Lyd-flyt ───────────────────────────────────────────────────────────────
	let voiceOpen = $state(false);
	let voiceText = $state('');

	// ── Sjekkin-flyt ──────────────────────────────────────────────────────────
	let moodOpen = $state(false);
	let moodSlider = $state(50);
	let moodFactors = $state<string[]>([]);
	let moodNote = $state('');
	const MOOD_FACTORS = [
		{ id: 'søvn',       label: 'Søvn',      icon: '💤' },
		{ id: 'trening',    label: 'Trening',   icon: '🏃' },
		{ id: 'mat',        label: 'Mat',       icon: '🥗' },
		{ id: 'jobb',       label: 'Jobb',      icon: '💼' },
		{ id: 'familie',    label: 'Familie',   icon: '🧑‍👧' },
		{ id: 'sosialt',    label: 'Sosialt',   icon: '👥' },
		{ id: 'vær',        label: 'Vær',      icon: '☀️' },
		{ id: 'økonomi',    label: 'Økonomi',  icon: '💸' },
		{ id: 'helse',      label: 'Helse',     icon: '🩺' },
		{ id: 'kreativitet', label: 'Kreativitet', icon: '🎨' },
		{ id: 'tid-alene',  label: 'Tid alene', icon: '🧘' },
		{ id: 'natur',      label: 'Natur',     icon: '🌿' },
	];
	const moodLabel = $derived(
		moodSlider < 20  ? 'Veldig lav' :
		moodSlider < 40  ? 'Lav' :
		moodSlider < 60  ? 'OK' :
		moodSlider < 80  ? 'Bra' : 'Strålende'
	);
	const moodEmoji = $derived(
		moodSlider < 20  ? '😔' :
		moodSlider < 40  ? '😐' :
		moodSlider < 60  ? '🙂' :
		moodSlider < 80  ? '😊' : '🤩'
	);
	const moodColor = $derived(
		moodSlider < 20  ? '#e07070' :
		moodSlider < 40  ? '#f0b429' :
		moodSlider < 60  ? '#aaa' :
		moodSlider < 80  ? '#82c882' : '#7c8ef5'
	);

	// ── Fil-flyt ───────────────────────────────────────────────────────────────
	let fileFlowOpen = $state(false);
	let fileFlowInput = $state<HTMLInputElement | null>(null);
	let fileFlowSelected = $state<File | null>(null);
	let fileFlowNote = $state('');

	const QUICK_ACTIONS: QuickAction[] = [
		{
			id: 'chat',
			label: 'Prat',
			icon: '◈',
			description: 'Start med en fri tanke, et spørsmål eller et behov for retning.',
			placeholder: 'Hva vil du tenke høyt om akkurat nå?',
			helper: 'Fin start når du bare vil tømme hodet eller få hjelp til å sortere noe.'
		},
		{
			id: 'camera',
			label: 'Kamera',
			icon: '◉',
			description: 'Fang et bilde av noe som bør registreres eller forstås.',
			placeholder: 'Beskriv bildet, eller lim inn det viktigste du ser i det.',
			helper: 'Tenk skjermtid, kvittering, måling, notat eller en annen visuell observasjon.'
		},
		{
			id: 'voice',
			label: 'Lyd',
			icon: '∿',
			description: 'Bruk stemmen når du vil få noe ut raskt uten å formulere deg perfekt.',
			placeholder: 'Skriv stikkord for det du ville sagt høyt.',
			helper: 'Bra for raske tanker, refleksjoner etter noe som nettopp skjedde, eller en spontan idé.'
		},
		{
			id: 'mood',
			label: 'Sjekkin',
			icon: '◐',
			description: 'Registrer dagsform, energi eller følelsen du står i akkurat nå.',
			placeholder: 'Hvordan har du det akkurat nå, og hva tror du påvirker det?',
			helper: 'Fint for korte emosjonelle snapshots som senere kan kobles til tema eller mønster.'
		},
		{
			id: 'file',
			label: 'Fil',
			icon: '▣',
			description: 'Ta inn dokumenter, utsnitt eller annet innhold som bør triageres videre.',
			placeholder: 'Hva inneholder filen, og hva vil du at vi skal gjøre med den?',
			helper: 'Kan være PDF, eksport, skjermdump eller annet materiale du vil rute til riktig tema.'
		}
	];
	let selectedQuickAction = $state<QuickActionId>('chat');
	const activeQuickAction = $derived(
		QUICK_ACTIONS.find((action) => action.id === selectedQuickAction) ?? QUICK_ACTIONS[0]
	);

	function openChat(prefill = '', actionId: QuickActionId = selectedQuickAction) {
		selectedQuickAction = actionId;
		chatPrefill = prefill;
		chatOpen = true;
	}

	function startQuickAction(action: QuickAction) {
		chatMessages = [];
		chatPrefill = '';
		createdThemeLink = null;
		currentConversationId = null;
		if (action.id === 'chat') {
			openChat('', 'chat');
		} else if (action.id === 'camera') {
			cameraOpen = true;
		} else if (action.id === 'voice') {
			voiceOpen = true;
		} else if (action.id === 'mood') {
			moodOpen = true;
		} else if (action.id === 'file') {
			fileFlowOpen = true;
		}
	}

	// ── Kamera-flyt ─────────────────────────────────────────────────────────────
	function closeCameraFlow() {
		cameraOpen = false;
		cameraSelectedFile = null;
		cameraPreview = null;
		cameraCaption = '';
		cameraError = false;
	}

	function handleCameraFileSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		cameraSelectedFile = file;
		const reader = new FileReader();
		reader.onload = (e) => { cameraPreview = e.target?.result as string; };
		reader.readAsDataURL(file);
	}

	async function submitCamera() {
		if (!cameraSelectedFile) return;
		cameraUploading = true;
		cameraError = false;
		try {
			const formData = new FormData();
			formData.append('image', cameraSelectedFile);
			const uploadRes = await fetch('/api/upload-image', { method: 'POST', body: formData });
			if (!uploadRes.ok) throw new Error('Upload failed');
			const { url } = await uploadRes.json();
			const caption = cameraCaption.trim();
			closeCameraFlow();
			chatOpen = true;
			await sendChat(caption || '📷 [Bilde]', url);
		} catch {
			cameraError = true;
		} finally {
			cameraUploading = false;
		}
	}

	// ── Lyd-flyt ─────────────────────────────────────────────────────────────────
	function closeVoiceFlow() { voiceOpen = false; voiceText = ''; }

	function submitVoice() {
		const t = voiceText.trim();
		if (!t) return;
		closeVoiceFlow();
		chatOpen = true;
		sendChat(t);
	}

	// ── Sjekkin-flyt ─────────────────────────────────────────────────────────────
	function closeMoodFlow() { moodOpen = false; moodSlider = 50; moodFactors = []; moodNote = ''; }

	function toggleFactor(id: string) {
		if (moodFactors.includes(id)) {
			moodFactors = moodFactors.filter(f => f !== id);
		} else {
			moodFactors = [...moodFactors, id];
		}
	}

	function submitMood() {
		const factors = moodFactors
			.map(id => MOOD_FACTORS.find(f => f.id === id))
			.filter(Boolean)
			.map(f => `${f!.icon} ${f!.label}`)
			.join(', ');
		const note = moodNote.trim();
		const msg = [
			`Sjekkin: ${moodEmoji} ${moodLabel} (${moodSlider}/100)`,
			factors ? `Påvirket av: ${factors}` : null,
			note || null,
		].filter(Boolean).join('\n');
		closeMoodFlow();
		chatOpen = true;
		sendChat(msg);
	}

	// ── Fil-flyt ──────────────────────────────────────────────────────────────────
	function closeFileFlow() { fileFlowOpen = false; fileFlowSelected = null; fileFlowNote = ''; }

	function handleFileFlowSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (file) fileFlowSelected = file;
	}

	function submitFile() {
		if (!fileFlowSelected) return;
		const note = fileFlowNote.trim();
		const filename = fileFlowSelected.name;
		closeFileFlow();
		chatOpen = true;
		sendChat(`Fil: ${filename}${note ? '\n\n' + note : ''}`);
	}

	function switchQuickAction(action: QuickAction) {
		selectedQuickAction = action.id;
		chatPrefill = '';
	}

	function closeChat() {
		if (currentConversationId && chatMessages.length > 0) {
			latestClosedConversationId = currentConversationId;
		}
		chatMessages = [];
		chatPrefill = '';
		createdThemeLink = null;
		launchingThemeId = null;
		currentConversationId = null;
		chatOpen = false;
	}

	async function openCreatedTheme(themeId: string) {
		launchingThemeId = themeId;
		await goto(`/tema/${themeId}?handoff=1`);
	}

	async function sendChat(text: string, imageUrl?: string) {
		const displayText = text || (imageUrl ? '📷 [Bilde]' : '');
		chatMessages = [...chatMessages, { role: 'user', text: displayText, imageUrl }];
		chatLoading = true;
		try {
			if (!currentConversationId) {
				try {
					const newConversationRes = await fetch('/api/conversations/new', { method: 'POST' });
					if (newConversationRes.ok) {
						const newConversationData = await newConversationRes.json();
						currentConversationId = newConversationData.conversationId ?? null;
					}
				} catch {
					// Lar API-et håndtere fallback hvis ny samtale ikke kan opprettes her.
				}
			}

			const res = await fetch('/api/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: displayText, conversationId: currentConversationId, imageUrl })
			});
			if (!res.ok) throw new Error();
			const data = await res.json();
			currentConversationId = data.conversationId ?? currentConversationId;
			if (data.themeCreated && data.theme?.id) {
				createdThemeLink = {
					id: data.theme.id,
					name: data.theme.name,
					emoji: data.theme.emoji ?? null
				};
			}
			chatMessages = [...chatMessages, { role: 'assistant', text: data.message }];
			if (data.checklistCreated) await fetchChecklists();
		} catch {
			chatMessages = [...chatMessages, { role: 'assistant', text: 'Noe gikk galt. Prøv igjen.' }];
		} finally {
			chatLoading = false;
		}
	}

	async function unpinWidget(id: string) {
		pinnedWidgets = pinnedWidgets.filter((w) => w.id !== id);
		await fetch(`/api/user-widgets/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ pinned: false })
		});
	}

	async function saveWidgetConfig(id: string, updates: Partial<UserWidget>) {
		configWidget = null;
		const res = await fetch(`/api/user-widgets/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(updates)
		});
		if (res.ok) {
			const updated = await res.json();
			pinnedWidgets = pinnedWidgets.map((w) => w.id === id ? { ...w, ...updated } : w);
		}
	}



	const dateLabel = $derived(
		new Intl.DateTimeFormat('nb-NO', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())
	);
</script>

<div class="home-screen">

	<!-- ── SONE 1: Tittel ── -->
	<section class="zone zone-title" class:hidden={chatOpen}>
		<div class="title-row">
			<div class="title-left">
				<span class="app-name">Resonans</span>
				<span class="date-chip">{dateLabel}</span>
			</div>
			<div class="title-right">
				<a href="/goals" class="icon-link" aria-label="Mål">◎</a>
				<a href="/settings" class="icon-link" aria-label="Innstillinger">⚙</a>
			</div>
		</div>
	</section>

	<!-- ── SONE 2: Widgets ── -->
	<section class="zone zone-widgets" class:hidden={chatOpen} aria-label="Sensor-oversikt">

		<div class="widget-row">
			{#if pinnedWidgets.length > 0}
				{#each pinnedWidgets as w}
					<DynamicWidget
						widgetId={w.id}
						title={w.title}
						unit={w.unit}
						color={w.color}
						pinned={w.pinned}
						onpress={() => openChat(`Fortell meg mer om ${w.title.toLowerCase()}`)}
						onunpin={() => unpinWidget(w.id)}
						onconfig={() => (configWidget = w)}
					/>
				{/each}
			{:else}
				{#each WIDGETS as w}
					<WidgetCircle
						label={w.label}
						val={w.val}
						unit={w.unit}
						color={w.color}
						active={false}
						onpress={() => goto(w.sensorType === 'spending' ? '/economics' : `/sensor/${w.sensorType}`)}
						onchat={() => openChat(`Spør om ${w.label.toLowerCase()}`)}
					/>
				{/each}
			{/if}

			{#each activeChecklists as cl (cl.id)}
				<ChecklistWidget
					checklist={cl}
					onclick={() => (openChecklist = cl)}
					onremove={async () => {
						await fetch(`/api/checklists/${cl.id}`, { method: 'DELETE' });
						activeChecklists = activeChecklists.filter((c) => c.id !== cl.id);
					}}
				/>
			{/each}
		</div>
	</section>

	<!-- ── SONE 3: Tema ── -->
	<section class="zone zone-tema" class:hidden={chatOpen} aria-label="Temaer">
		<p class="zone-label">Temaer</p>
		{#if themes.length}
			<ThemeRail
				{themes}
				activeId={null}
				onselect={(id) => goto(`/tema/${id}`)}
			/>
		{:else}
			<button class="onboarding-cta" onclick={() => openChat('Jeg vil sette opp mitt første tema. Hjelp meg å definere hva jeg ønsker å fokusere på.')}>
			<span class="cta-icon">◎</span>
			<span class="cta-text">Kom i gang med temaer</span>
			<span class="cta-arrow">→</span>
		</button>
		{/if}
	</section>

	<!-- ── SONE 4: Chat ── -->
	<section class="zone zone-input" class:zone-chat-open={chatOpen} aria-label="Chat">
		{#if chatOpen}
			<div class="chat-header">
				<button class="chat-back" onclick={closeChat} aria-label="Lukk chat">←</button>
				<div class="chat-heading-wrap">
					<span class="chat-heading">{activeQuickAction.label}</span>
					<span class="chat-subheading">{activeQuickAction.description}</span>
				</div>
				<button class="chat-link" onclick={() => goto(currentConversationId ? `/samtaler?conversation=${currentConversationId}` : '/samtaler')} aria-label="Åpne samtaler">Samtaler</button>
			</div>
			<div class="chat-messages" aria-live="polite">
				{#if chatMessages.length === 0 && !chatLoading}
					<div class="quick-flow-card">
						<div class="quick-flow-mark">{activeQuickAction.icon}</div>
						<div class="quick-flow-copy">
							<p class="quick-flow-title">{activeQuickAction.label}</p>
							<p class="quick-flow-text">{activeQuickAction.helper}</p>
						</div>
					</div>
					<p class="chat-empty">Skriv første utkast, så hjelper vi deg å plassere det videre etterpå.</p>
				{/if}
				{#each chatMessages as msg}
					{#if msg.role === 'user'}
						<div class="bubble-user">
							{#if msg.imageUrl}
								<img class="bubble-img" src={msg.imageUrl} alt="Bilde" />
							{/if}
							{#if msg.text && msg.text !== '📷 [Bilde]'}<span>{msg.text}</span>{/if}
						</div>
					{:else}
						<TriageCard text={msg.text} />
					{/if}
				{/each}
				{#if chatLoading}
					<TriageCard loading={true} />
				{/if}
			</div>
			<div class="chat-input-area">
				{#if createdThemeLink}
					{@const themeLink = createdThemeLink}
					<button
						class="theme-link-banner"
						class:is-launching={launchingThemeId === themeLink.id}
						disabled={launchingThemeId === themeLink.id}
						onclick={() => openCreatedTheme(themeLink.id)}
					>
						<span class="theme-link-icon">{themeLink.emoji ?? '◎'}</span>
						<span>{launchingThemeId === themeLink.id ? `Åpner ${themeLink.name}…` : `Åpne ${themeLink.name}`}</span>
						<span class="theme-link-arrow">→</span>
					</button>
				{/if}
				{#key `${activeQuickAction.id}:${chatPrefill}`}
					<ChatInput
						placeholder={activeQuickAction.placeholder}
						initialValue={chatPrefill}
						disabled={chatLoading}
						onsubmit={sendChat}
					/>
				{/key}
			</div>
		{:else if cameraOpen}
			<!-- ── Kamera-flyt ── -->
			<div class="flow-panel">
				<div class="flow-header">
					<button class="flow-back" onclick={closeCameraFlow} aria-label="Tilbake">←</button>
					<span class="flow-title">Kamera</span>
				</div>
				<input
					type="file"
					accept="image/*"
					style="display:none"
					bind:this={cameraFileInput}
					onchange={handleCameraFileSelect}
				/>
				<div class="flow-body">
					{#if !cameraPreview}
						<button class="upload-zone" onclick={() => cameraFileInput?.click()}>
							<span class="upload-zone-icon">◉</span>
							<p class="upload-zone-label">Velg bilde eller ta foto</p>
							<p class="upload-zone-sub">Skjermtid · Kvittering · Blodprøve · Notat</p>
						</button>
					{:else}
						<div class="img-preview">
							<img src={cameraPreview} alt="Forhåndsvisning" />
							<button class="preview-clear" onclick={() => { cameraPreview = null; cameraSelectedFile = null; }} aria-label="Fjern bilde">✕</button>
						</div>
						<textarea
							class="flow-textarea"
							placeholder="Beskriv eller legg til kontekst (valgfritt)…"
							bind:value={cameraCaption}
							rows="2"
						></textarea>
						{#if cameraError}
							<p class="flow-error">Noe gikk galt. Prøv igjen.</p>
						{/if}
						<button class="flow-submit" onclick={submitCamera} disabled={cameraUploading}>
							{cameraUploading ? 'Laster opp…' : 'Send til chat →'}
						</button>
					{/if}
				</div>
			</div>
		{:else if voiceOpen}
			<!-- ── Lyd-flyt ── -->
			<div class="flow-panel">
				<div class="flow-header">
					<button class="flow-back" onclick={closeVoiceFlow} aria-label="Tilbake">←</button>
					<span class="flow-title">Lyd</span>
				</div>
				<div class="flow-body">
					<p class="flow-hint">Skriv det du ville sagt — fritt og uformelt.</p>
					<textarea
						class="flow-textarea flow-textarea--lg"
						placeholder="Bare si det…"
						bind:value={voiceText}
						rows="5"
					></textarea>
					<button class="flow-submit" onclick={submitVoice} disabled={!voiceText.trim()}>
						Send til chat →
					</button>
				</div>
			</div>
		{:else if moodOpen}
			<!-- ── Stemning-flyt ── -->
			<div class="flow-panel">
				<div class="flow-header">
					<button class="flow-back" onclick={closeMoodFlow} aria-label="Tilbake">←</button>
					<span class="flow-title">Stemning</span>
				</div>
				<div class="flow-body">
					<!-- Slider -->
					<div class="ci-slider-wrap">
						<div class="ci-slider-display" style:color={moodColor}>
							<span class="ci-slider-emoji">{moodEmoji}</span>
							<span class="ci-slider-label">{moodLabel}</span>
							<span class="ci-slider-num">{moodSlider}</span>
						</div>
						<input
							type="range"
							class="ci-slider"
							min="0" max="100" step="1"
							bind:value={moodSlider}
							style:--thumb-color={moodColor}
							aria-label="Stemningsnivå"
						/>
						<div class="ci-slider-ends">
							<span>😔</span>
							<span>🤩</span>
						</div>
					</div>

					<!-- Faktor-grid -->
					<div class="ci-factors-label">Hva påvirker stemningen din mest?</div>
					<div class="ci-factors-grid">
						{#each MOOD_FACTORS as factor}
							<button
								class="ci-factor-btn"
								class:is-active={moodFactors.includes(factor.id)}
								onclick={() => toggleFactor(factor.id)}
								aria-pressed={moodFactors.includes(factor.id)}
							>
								<span class="ci-factor-icon">{factor.icon}</span>
								<span class="ci-factor-label">{factor.label}</span>
							</button>
						{/each}
					</div>

					<!-- Notat -->
					<textarea
						class="flow-textarea"
						placeholder="Vil du legge til noe? (valgfritt)"
						bind:value={moodNote}
						rows="2"
					></textarea>
					<button class="flow-submit" onclick={submitMood}>
						Send til chat →
					</button>
				</div>
			</div>
		{:else if fileFlowOpen}
			<!-- ── Fil-flyt ── -->
			<div class="flow-panel">
				<div class="flow-header">
					<button class="flow-back" onclick={closeFileFlow} aria-label="Tilbake">←</button>
					<span class="flow-title">Fil</span>
				</div>
				<input
					type="file"
					accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,text/*"
					style="display:none"
					bind:this={fileFlowInput}
					onchange={handleFileFlowSelect}
				/>
				<div class="flow-body">
					{#if !fileFlowSelected}
						<button class="upload-zone" onclick={() => fileFlowInput?.click()}>
							<span class="upload-zone-icon">▣</span>
							<p class="upload-zone-label">Velg fil</p>
							<p class="upload-zone-sub">PDF · Word · Excel · Tekst</p>
						</button>
					{:else}
						<div class="file-chip">
							<span class="file-chip-icon">▣</span>
							<span class="file-chip-name">{fileFlowSelected.name}</span>
							<button class="preview-clear" onclick={() => fileFlowSelected = null} aria-label="Fjern fil">✕</button>
						</div>
						<textarea
							class="flow-textarea"
							placeholder="Hva vil du gjøre med denne filen? (valgfritt)"
							bind:value={fileFlowNote}
							rows="2"
						></textarea>
						<button class="flow-submit" onclick={submitFile}>
							Send til chat →
						</button>
					{/if}
				</div>
			</div>
		{:else}
			<div class="capture-panel">
				{#if latestClosedConversationId}
					<button class="resume-chat-btn" onclick={() => goto(`/samtaler?conversation=${latestClosedConversationId}`)}>
						<span class="resume-chat-label">Fortsett sist samtale</span>
						<span class="resume-chat-arrow">→</span>
					</button>
				{/if}
				<div class="capture-grid">
					<button class="capture-action capture-action--primary" onclick={() => startQuickAction(QUICK_ACTIONS[0])}>
						<span class="capture-action-icon">{QUICK_ACTIONS[0].icon}</span>
						<span class="capture-action-label">{QUICK_ACTIONS[0].label}</span>
					</button>
					{#each QUICK_ACTIONS.slice(1) as action}
						<button class="capture-action" onclick={() => startQuickAction(action)}>
							<span class="capture-action-icon">{action.icon}</span>
							<span class="capture-action-label">{action.label}</span>
						</button>
					{/each}
				</div>
			</div>
		{/if}
	</section>

</div>

<!-- ── WIDGET CONFIG SHEET ── -->
{#if configWidget}
	<WidgetConfigSheet
		widget={configWidget}
		open={true}
		onclose={() => (configWidget = null)}
		onsave={(updates) => saveWidgetConfig(configWidget!.id, updates)}
	/>
{/if}

<!-- ── CHECKLIST SHEET ── -->
{#if openChecklist}
	<ChecklistSheet
		checklist={openChecklist}
		onclose={() => (openChecklist = null)}
		onDeleted={() => {
			activeChecklists = activeChecklists.filter((c) => c.id !== openChecklist?.id);
			openChecklist = null;
		}}
	/>
{/if}

<style>
	/* ── Grunnlayout ── */
	.home-screen {
		height: 100dvh;
		background: #0f0f0f;
		color: #ccc;
		font-family: 'Inter', system-ui, sans-serif;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	/* ── Soner ── */
	.zone {
		overflow: hidden;
		flex-shrink: 0;
	}

	.hidden {
		display: none;
	}

	/* ── Tittel-sone ── */
	.zone-title {
		display: flex;
		align-items: center;
		padding: env(safe-area-inset-top, 12px) 20px 0;
		min-height: 0;
	}

	.title-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
	}

	.title-left {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.app-name {
		font-size: 1.25rem;
		font-weight: 700;
		color: #eee;
		letter-spacing: -0.03em;
	}

	.date-chip {
		font-size: 0.7rem;
		color: #444;
	}

	.title-right {
		display: flex;
		gap: 4px;
	}

	.icon-link {
		color: #555;
		text-decoration: none;
		font-size: 1.2rem;
		min-width: 40px;
		min-height: 40px;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: color 0.15s;
	}

	.icon-link:hover {
		color: #aaa;
	}

	/* ── Widget-sone (35 %) ── */
	.zone-widgets {
		padding: 12px 20px 8px;
		border-top: 1px solid #1e1e1e;
	}

	/* ── Tema-sone (20 %) ── */
	.zone-tema {
		padding: 12px 20px 8px;
		border-top: 1px solid #1e1e1e;
	}

	/* ── Zone-label ── */
	.zone-label {
		font-size: 0.6rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: #444;
		margin: 0 0 10px;
	}

	/* ── Widget-rad ── */
	.widget-row {
		display: grid;
		grid-template-columns: repeat(2, 72px);
		gap: 16px;
		justify-content: start;
	}

	.onboarding-cta {
		display: flex;
		align-items: center;
		gap: 10px;
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 10px;
		padding: 10px 14px;
		cursor: pointer;
		width: 100%;
		color: #888;
		font-size: 0.82rem;
		transition: background 0.15s, border-color 0.15s;
	}

	.onboarding-cta:hover {
		background: #222;
		border-color: #4a5af0;
		color: #aaa;
	}

	.cta-icon {
		font-size: 1rem;
		color: #4a5af0;
	}

	.cta-text {
		flex: 1;
		text-align: left;
	}

	.cta-arrow {
		color: #555;
	}

	/* ── Input-sone: kollapset → pill-knapp, utvidet → full chat ── */
	.zone-input {
		padding: 16px 20px env(safe-area-inset-bottom, 20px);
		border-top: 1px solid #1e1e1e;
		display: flex;
		align-items: stretch;
		margin-top: auto;
	}

	.zone-chat-open {
		flex: 1;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		padding: 0;
		border-top: 1px solid #1e1e1e;
		margin-top: 0;
		/* Fyller resten av skjermen etter at de andre sonene er skjult */
		height: calc(100dvh - 1px);
	}

	/* ── Chat: åpne-knapp (kollapset) ── */
	.capture-panel {
		display: flex;
		flex-direction: column;
		gap: 14px;
		width: 100%;
	}

	.capture-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}

	.resume-chat-btn {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		background: #12151d;
		border: 1px solid #252d40;
		border-radius: 14px;
		padding: 11px 13px;
		color: #c9d1f5;
		font: inherit;
		font-size: 0.8rem;
		cursor: pointer;
		text-align: left;
	}

	.resume-chat-btn:hover {
		border-color: #3c4f9f;
		background: #151923;
	}

	.resume-chat-label {
		font-weight: 600;
	}

	.resume-chat-arrow {
		margin-left: auto;
		color: #8f9bd0;
	}

	.capture-action {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		background: linear-gradient(180deg, #181818 0%, #121212 100%);
		border: 1px solid #2a2a2a;
		border-radius: 18px;
		padding: 22px 12px;
		cursor: pointer;
		color: #888;
		font: inherit;
		font-size: 0.9rem;
		transition: border-color 0.15s, background 0.15s, transform 0.15s;
		text-align: center;
		width: 100%;
	}

	.capture-action--primary {
		grid-column: 1 / -1;
		flex-direction: row;
		justify-content: flex-start;
		text-align: left;
		padding: 16px 20px;
		gap: 14px;
	}
	.capture-action:hover {
		background: linear-gradient(180deg, #1d1d1d 0%, #151515 100%);
		border-color: #3c4f9f;
		transform: translateY(-1px);
		color: #c1c7e8;
	}

	.capture-action-icon {
		width: 34px;
		height: 34px;
		border-radius: 10px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: #111827;
		border: 1px solid #27304e;
		color: #aeb8ef;
		font-size: 0.95rem;
	}

	.capture-action-label {
		font-size: 0.82rem;
		font-weight: 700;
		color: #ddd;
	}

	/* ── Flow-panel (kamera / lyd / stemning / fil) ──────────────────────── */
	.flow-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
	}

	.flow-header {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 16px;
		border-bottom: 1px solid #1a1a1a;
		flex-shrink: 0;
	}

	.flow-back {
		background: none;
		border: none;
		color: #555;
		font: inherit;
		font-size: 1.1rem;
		cursor: pointer;
		padding: 4px 8px 4px 0;
		transition: color 0.12s;
	}
	.flow-back:hover { color: #ccc; }

	.flow-title {
		font-size: 0.9rem;
		font-weight: 700;
		color: #aaa;
	}

	.flow-body {
		flex: 1;
		overflow-y: auto;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.flow-hint {
		margin: 0;
		font-size: 0.85rem;
		color: #555;
	}

	.flow-textarea {
		width: 100%;
		background: #161616;
		border: 1px solid #2a2a2a;
		border-radius: 12px;
		padding: 12px 14px;
		color: #ccc;
		font: inherit;
		font-size: 0.88rem;
		line-height: 1.5;
		resize: none;
		box-sizing: border-box;
	}
	.flow-textarea:focus {
		outline: none;
		border-color: #3c4f9f;
	}
	.flow-textarea::placeholder { color: #3a3a3a; }
	.flow-textarea--lg { min-height: 120px; }

	.flow-submit {
		background: #4a5af0;
		border: none;
		color: #fff;
		border-radius: 14px;
		padding: 13px 20px;
		font: inherit;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
		width: 100%;
		transition: background 0.15s, opacity 0.15s;
	}
	.flow-submit:hover:not(:disabled) { background: #3a4adf; }
	.flow-submit:disabled { opacity: 0.4; cursor: default; }

	.flow-error {
		margin: 0;
		font-size: 0.8rem;
		color: #e07070;
	}

	/* Upload zone (kamera + fil) */
	.upload-zone {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		background: #111;
		border: 2px dashed #2a2a2a;
		border-radius: 18px;
		padding: 36px 20px;
		cursor: pointer;
		width: 100%;
		transition: border-color 0.15s, background 0.15s;
		font: inherit;
	}
	.upload-zone:hover { border-color: #3c4f9f; background: #121218; }

	.upload-zone-icon {
		font-size: 2rem;
		color: #4a5af0;
		opacity: 0.7;
	}

	.upload-zone-label {
		margin: 0;
		font-size: 0.9rem;
		font-weight: 600;
		color: #ccc;
	}

	.upload-zone-sub {
		margin: 0;
		font-size: 0.75rem;
		color: #555;
	}

	/* Image preview */
	.img-preview {
		position: relative;
		border-radius: 14px;
		overflow: hidden;
		max-height: 200px;
	}
	.img-preview img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.preview-clear {
		position: absolute;
		top: 8px;
		right: 8px;
		background: rgba(0,0,0,0.7);
		border: none;
		color: #fff;
		border-radius: 50%;
		width: 28px;
		height: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		font-size: 0.8rem;
	}

	/* File chip */
	.file-chip {
		display: flex;
		align-items: center;
		gap: 10px;
		background: #161616;
		border: 1px solid #2a2a2a;
		border-radius: 12px;
		padding: 12px 14px;
	}

	.file-chip-icon {
		color: #7c8ef5;
		font-size: 1.2rem;
		flex-shrink: 0;
	}

	.file-chip-name {
		flex: 1;
		font-size: 0.85rem;
		color: #ccc;
		word-break: break-all;
	}

	/* ── Sjekkin-flyt ────────────────────────────────────────────────────────── */
	.ci-slider-wrap {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.ci-slider-display {
		display: flex;
		align-items: baseline;
		gap: 10px;
		transition: color 0.2s;
	}

	.ci-slider-emoji {
		font-size: 2rem;
		line-height: 1;
		transition: filter 0.2s;
	}

	.ci-slider-label {
		font-size: 1.1rem;
		font-weight: 700;
		letter-spacing: -0.02em;
	}

	.ci-slider-num {
		font-size: 0.75rem;
		opacity: 0.5;
		font-variant-numeric: tabular-nums;
		margin-left: auto;
	}

	.ci-slider {
		-webkit-appearance: none;
		appearance: none;
		width: 100%;
		height: 6px;
		border-radius: 999px;
		background: #222;
		outline: none;
		cursor: pointer;
	}
	.ci-slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: var(--thumb-color, #4a5af0);
		border: 3px solid #0f0f0f;
		box-shadow: 0 0 0 1px var(--thumb-color, #4a5af0);
		transition: background 0.2s, box-shadow 0.2s;
		cursor: grab;
	}
	.ci-slider::-moz-range-thumb {
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: var(--thumb-color, #4a5af0);
		border: 3px solid #0f0f0f;
		cursor: grab;
	}

	.ci-slider-ends {
		display: flex;
		justify-content: space-between;
		font-size: 0.9rem;
		opacity: 0.4;
	}

	.ci-factors-label {
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #555;
		margin-top: 4px;
	}

	.ci-factors-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 8px;
	}

	.ci-factor-btn {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 5px;
		background: #141414;
		border: 1.5px solid #252525;
		border-radius: 14px;
		padding: 10px 6px;
		cursor: pointer;
		font: inherit;
		transition: border-color 0.12s, background 0.12s, transform 0.1s;
	}
	.ci-factor-btn:hover { border-color: #3c4f9f; background: #16191f; }
	.ci-factor-btn.is-active {
		border-color: #4a5af0;
		background: #12152a;
		transform: scale(1.04);
	}

	.ci-factor-icon { font-size: 1.3rem; line-height: 1; }
	.ci-factor-label {
		font-size: 0.62rem;
		font-weight: 600;
		color: #888;
		text-align: center;
		line-height: 1.2;
	}
	.ci-factor-btn.is-active .ci-factor-label { color: #c5cdf8; }

	/* Bubble image */
	.bubble-img {
		display: block;
		max-width: 100%;
		border-radius: 10px;
		margin-bottom: 6px;
	}
	.chat-header {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 16px;
		border-bottom: 1px solid #1a1a1a;
		flex-shrink: 0;
	}

	.chat-back {
		background: none;
		border: none;
		color: #555;
		font: inherit;
		font-size: 1.1rem;
		cursor: pointer;
		padding: 4px 8px 4px 0;
		transition: color 0.12s;
	}
	.chat-back:hover { color: #ccc; }

	.chat-heading {
		font-size: 0.9rem;
		font-weight: 700;
		color: #aaa;
		letter-spacing: -0.01em;
	}

	.chat-heading-wrap {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
	}

	.chat-subheading {
		font-size: 0.74rem;
		color: #5d5d5d;
	}

	.chat-link {
		border: 1px solid #292929;
		background: #111;
		color: #8f8f8f;
		border-radius: 999px;
		padding: 7px 11px;
		font: inherit;
		font-size: 0.74rem;
		cursor: pointer;
		white-space: nowrap;
	}

	.chat-link:hover {
		border-color: #3c4f9f;
		color: #d4daf6;
	}


	.quick-flow-card {
		align-self: stretch;
		display: flex;
		gap: 12px;
		background: linear-gradient(180deg, #13151c 0%, #101114 100%);
		border: 1px solid #222839;
		border-radius: 18px;
		padding: 14px;
	}

	.quick-flow-mark {
		width: 42px;
		height: 42px;
		border-radius: 12px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #161b28;
		border: 1px solid #2a3557;
		color: #b6c2f8;
		font-size: 1rem;
		flex-shrink: 0;
	}

	.quick-flow-copy {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.quick-flow-title {
		margin: 0;
		font-size: 0.88rem;
		font-weight: 700;
		color: #e3e6f6;
	}

	.quick-flow-text {
		margin: 0;
		font-size: 0.79rem;
		line-height: 1.45;
		color: #8d93aa;
	}

	.chat-messages {
		flex: 1;
		overflow-y: auto;
		padding: 14px 16px 8px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		-webkit-overflow-scrolling: touch;
		scrollbar-width: thin;
		scrollbar-color: #222 transparent;
	}

	.chat-empty {
		color: #2e2e2e;
		font-size: 0.85rem;
		text-align: center;
		margin: auto;
		font-style: italic;
	}

	.bubble-user {
		align-self: flex-end;
		background: #1a1a2e;
		border: 1px solid #2a2a4a;
		border-radius: 14px 14px 4px 14px;
		padding: 9px 14px;
		font-size: 0.88rem;
		line-height: 1.5;
		max-width: 80%;
		white-space: pre-wrap;
		word-break: break-word;
		color: #ccc;
	}

	.chat-input-area {
		padding: 10px 14px env(safe-area-inset-bottom, 14px);
		border-top: 1px solid #1a1a1a;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.theme-link-banner {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		background: linear-gradient(180deg, #141924 0%, #11141b 100%);
		border: 1px solid #263250;
		border-radius: 14px;
		padding: 11px 12px;
		color: #d7ddf8;
		font: inherit;
		font-size: 0.82rem;
		cursor: pointer;
		text-align: left;
		transition: transform 0.18s ease, opacity 0.18s ease, border-color 0.18s ease;
	}

	.theme-link-banner:hover {
		border-color: #3a4e84;
	}

	.theme-link-banner.is-launching {
		opacity: 0.75;
		transform: scale(0.99);
		cursor: default;
	}

	.theme-link-icon {
		width: 28px;
		height: 28px;
		border-radius: 9px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: #1a2233;
		border: 1px solid #334468;
		flex-shrink: 0;
	}

	.theme-link-arrow {
		margin-left: auto;
		color: #8f9bd0;
	}


	@media (max-width: 560px) {
		.zone-input {
			padding-left: 16px;
			padding-right: 16px;
		}
	}
</style>


