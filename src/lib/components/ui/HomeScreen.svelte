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
	let chatMessages = $state<{ role: 'user' | 'assistant'; text: string }[]>([]);
	let chatLoading = $state(false);
	let currentConversationId = $state<string | null>(null);
	let latestClosedConversationId = $state<string | null>(null);
	let createdThemeLink = $state<{ id: string; name: string; emoji?: string | null } | null>(null);
	let launchingThemeId = $state<string | null>(null);
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
			label: 'Stemning',
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

	async function startQuickAction(action: QuickAction) {
		chatMessages = [];
		chatPrefill = '';
		createdThemeLink = null;
		currentConversationId = null;
		openChat('', action.id);

		try {
			const res = await fetch('/api/conversations/new', { method: 'POST' });
			if (res.ok) {
				const data = await res.json();
				currentConversationId = data.conversationId ?? null;
			}
		} catch {
			// Hvis dette feiler faller vi tilbake til serverens default-strategi ved første melding.
		}
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

	async function sendChat(text: string) {
		chatMessages = [...chatMessages, { role: 'user', text }];
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
				body: JSON.stringify({ message: text, conversationId: currentConversationId })
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
			<div class="quick-action-switcher" aria-label="Velg hurtigflyt">
				{#each QUICK_ACTIONS as action}
					<button
						class="quick-action-chip"
						class:is-active={action.id === activeQuickAction.id}
						onclick={() => switchQuickAction(action)}
					>
						<span class="quick-action-icon">{action.icon}</span>
						<span>{action.label}</span>
					</button>
				{/each}
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
						<div class="bubble-user">{msg.text}</div>
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
				<div class="composer-tools" aria-label="Tilgjengelige inndata">
					{#each QUICK_ACTIONS as action}
						<button
							type="button"
							class="composer-tool"
							class:is-active={action.id === activeQuickAction.id}
							onclick={() => switchQuickAction(action)}
						>
							<span class="composer-tool-icon">{action.icon}</span>
							<span>{action.label}</span>
						</button>
					{/each}
				</div>
				{#key `${activeQuickAction.id}:${chatPrefill}`}
					<ChatInput
						placeholder={activeQuickAction.placeholder}
						initialValue={chatPrefill}
						disabled={chatLoading}
						onsubmit={sendChat}
					/>
				{/key}
			</div>
		{:else}
			<div class="capture-panel">
				<div class="capture-intro">
					<p class="capture-kicker">Hurtigregistrering</p>
					<h2 class="capture-title">Hva vil du fange akkurat nå?</h2>
					<p class="capture-text">Velg format først. Deretter åpner vi en enkel flyt hvor du kan skrive, lime inn eller starte med råinnhold.</p>
				{#if latestClosedConversationId}
					<button class="resume-chat-btn" onclick={() => goto(`/samtaler?conversation=${latestClosedConversationId}`)}>
						<span class="resume-chat-label">Fortsett sist samtale</span>
						<span class="resume-chat-arrow">→</span>
					</button>
				{/if}
				</div>
				<div class="capture-grid">
					{#each QUICK_ACTIONS as action}
						<button class="capture-action" onclick={() => startQuickAction(action)}>
							<span class="capture-action-icon">{action.icon}</span>
							<span class="capture-action-label">{action.label}</span>
							<span class="capture-action-text">{action.description}</span>
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

	.capture-intro {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.capture-kicker {
		margin: 0;
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: #4b4b4b;
	}

	.capture-title {
		margin: 0;
		font-size: 1rem;
		line-height: 1.2;
		color: #e8e8e8;
		letter-spacing: -0.03em;
	}

	.capture-text {
		margin: 0;
		font-size: 0.82rem;
		line-height: 1.45;
		color: #7b7b7b;
		max-width: 34rem;
	}

	.capture-grid {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 10px;
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
		align-items: flex-start;
		gap: 8px;
		background: linear-gradient(180deg, #181818 0%, #121212 100%);
		border: 1px solid #2a2a2a;
		border-radius: 18px;
		padding: 14px 12px 13px;
		cursor: pointer;
		color: #888;
		font: inherit;
		font-size: 0.9rem;
		transition: border-color 0.15s, background 0.15s, transform 0.15s;
		text-align: left;
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

	.capture-action-text {
		font-size: 0.72rem;
		line-height: 1.35;
		color: #777;
	}

	/* ── Chat: utvidet innhold ── */
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

	.quick-action-switcher {
		display: flex;
		gap: 8px;
		overflow-x: auto;
		padding: 10px 14px 0;
		scrollbar-width: none;
	}

	.quick-action-switcher::-webkit-scrollbar {
		display: none;
	}

	.quick-action-chip {
		border: 1px solid #2a2a2a;
		background: #131313;
		color: #767676;
		border-radius: 999px;
		padding: 8px 12px;
		display: inline-flex;
		align-items: center;
		gap: 7px;
		font: inherit;
		font-size: 0.78rem;
		cursor: pointer;
		white-space: nowrap;
	}

	.quick-action-chip.is-active {
		background: #1a1f31;
		border-color: #3c4f9f;
		color: #d3dafb;
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

	.composer-tools {
		display: flex;
		gap: 8px;
		overflow-x: auto;
		scrollbar-width: none;
	}

	.composer-tools::-webkit-scrollbar {
		display: none;
	}

	.composer-tool {
		border: 1px solid #252525;
		background: #111;
		color: #6f6f6f;
		border-radius: 999px;
		padding: 7px 11px;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font: inherit;
		font-size: 0.76rem;
		cursor: pointer;
		white-space: nowrap;
	}

	.composer-tool.is-active {
		background: #1a1f31;
		border-color: #3a4e9a;
		color: #ced5f8;
	}

	.composer-tool-icon,
	.quick-action-icon {
		font-size: 0.82rem;
		line-height: 1;
	}

	@media (max-width: 860px) {
		.capture-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}

	@media (max-width: 560px) {
		.zone-input {
			padding-left: 16px;
			padding-right: 16px;
		}

		.capture-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.capture-action {
			min-height: 112px;
		}
	}
</style>


