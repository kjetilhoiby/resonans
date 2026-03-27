<!--
  HomeScreen — tre-sone hjemskjerm.

  Sone 1: WidgetRow (3 sensor-sirkler)
  Sone 2: ThemeRail (horisontal tema-stripe)
  Sone 3: ChatBar (flytende chat-inndata) → åpner chat-overlay

  Paner:
    SensorPane — vises ved klikk på widget (bottom sheet)
    ChatOverlay — vises ved klikk på chat-bar (bottom sheet)

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

	interface Theme {
		id: string;
		name: string;
		emoji: string;
	}

	interface Props {
		themes: Theme[];
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

	// -- Chat-overlay-tilstand --
	interface ChatMsg {
		role: 'user' | 'assistant';
		text: string;
	}

	let chatOpen = $state(false);
	let chatMessages = $state<ChatMsg[]>([]);
	let chatLoading = $state(false);
	let chatPrefill = $state('');

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

	function openChat(prefill = '') {
		chatPrefill = prefill;
		chatOpen = true;
	}

	async function sendChat(text: string) {
		chatMessages.push({ role: 'user', text });
		chatLoading = true;
		try {
			const res = await fetch('/api/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: text })
			});
			if (!res.ok) throw new Error();
			const data = await res.json();
			chatMessages.push({ role: 'assistant', text: data.message });
		} catch {
			chatMessages.push({ role: 'assistant', text: 'Noe gikk galt. Prøv igjen.' });
		} finally {
			chatLoading = false;
		}
	}
</script>

<div class="home-screen">
	<!-- ── SONE 1: Sensor-sirkler ── -->
	<section class="zone zone-widgets" aria-label="Sensor-oversikt">
		<p class="zone-label">Nå</p>
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
		</div>
	</section>

	<!-- ── SONE 2: Tema-stripe ── -->
	<section class="zone zone-themes" aria-label="Temaer">
		<p class="zone-label">Temaer</p>
		{#if themes.length}
			<ThemeRail
				{themes}
				activeId={null}
				onselect={(id) => goto(`/tema/${id}`)}
			/>
		{:else}
			<p class="empty-hint">Ingen aktive temaer ennå</p>
		{/if}
	</section>

	<!-- ── SONE 3: Chat-bar ── -->
	<section class="zone zone-chat" aria-label="Chat">
		<ChatInput
			placeholder="Hva tenker du på…"
			onsubmit={(text) => {
				openChat();
				sendChat(text);
			}}
		/>
	</section>

	<!-- ── BUNN-NAV ── -->
	<nav class="bottom-nav" aria-label="Navigasjon">
		<a href="/" class="nav-item" class:active={$page.url.pathname === '/'} aria-current={$page.url.pathname === '/' ? 'page' : undefined}>
			<span class="nav-icon">⬡</span>
			<span class="nav-label">Hjem</span>
		</a>
		<a href="/maal" class="nav-item" class:active={$page.url.pathname === '/maal'} aria-current={$page.url.pathname === '/maal' ? 'page' : undefined}>
			<span class="nav-icon">◎</span>
			<span class="nav-label">Mål</span>
		</a>
		<a href="/economics" class="nav-item" class:active={$page.url.pathname.startsWith('/economics')} aria-current={$page.url.pathname.startsWith('/economics') ? 'page' : undefined}>
			<span class="nav-icon">◈</span>
			<span class="nav-label">Økonomi</span>
		</a>
		<a href="/settings" class="nav-item" class:active={$page.url.pathname === '/settings'} aria-current={$page.url.pathname === '/settings' ? 'page' : undefined}>
			<span class="nav-icon">⚙</span>
			<span class="nav-label">Innstillinger</span>
		</a>
	</nav>
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

<!-- ── CHAT-OVERLAY ── -->
{#if chatOpen}
	<div class="chat-overlay" role="dialog" aria-modal="true" aria-label="Chat">
		<div class="chat-ov-header">
			<span class="chat-ov-title">◈ Resonans</span>
			<button class="chat-ov-close" onclick={() => (chatOpen = false)} aria-label="Lukk">✕</button>
		</div>

		<div class="chat-ov-messages" aria-live="polite">
			{#if chatMessages.length === 0 && !chatLoading}
				<p class="chat-ov-empty">Si hva du tenker på…</p>
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

		<div class="chat-ov-input">
			<ChatInput
				placeholder="Svar…"
				initialValue={chatPrefill}
				disabled={chatLoading}
				onsubmit={sendChat}
			/>
		</div>
	</div>
	<button class="backdrop" onclick={() => (chatOpen = false)} aria-label="Lukk chat" tabindex="-1"></button>
{/if}

<style>
	.home-screen {
		min-height: 100dvh;
		background: #0f0f0f;
		color: #ccc;
		font-family: 'Inter', system-ui, sans-serif;
		display: flex;
		flex-direction: column;
		padding: env(safe-area-inset-top, 16px) 0 72px;
	}

	/* ── Soner ── */
	.zone {
		padding: 24px 20px 12px;
	}

	.zone-widgets {
		padding-top: 48px;
	}

	.zone-themes {
		border-top: 1px solid #1e1e1e;
	}

	.zone-chat {
		margin-top: auto;
		padding-bottom: 24px;
	}

	.zone-label {
		font-size: 0.6rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: #444;
		margin: 0 0 12px;
	}

	/* ── Widget-rad ── */
	.widget-row {
		display: grid;
		grid-template-columns: repeat(2, 72px);
		gap: 16px;
		justify-content: start;
	}

	/* ── Chat-bar (wrapping ChatInput) ── */
	.zone-chat {
		padding-top: 12px;
	}

	.empty-hint {
		font-size: 0.8rem;
		color: #444;
		font-style: italic;
	}

	/* ── Chat overlay (bottom sheet) ── */
	.chat-overlay {
		position: fixed;
		inset: auto 0 0;
		z-index: 100;
		background: #111;
		border-top: 1px solid #242424;
		border-radius: 20px 20px 0 0;
		display: flex;
		flex-direction: column;
		max-height: 85dvh;
		overflow: hidden;
	}

	.chat-ov-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 16px 10px;
		border-bottom: 1px solid #1a1a1a;
		flex-shrink: 0;
	}

	.chat-ov-title {
		font-size: 0.85rem;
		font-weight: 600;
		color: #7c8ef5;
	}

	.chat-ov-close {
		background: none;
		border: none;
		color: #555;
		font-size: 1rem;
		cursor: pointer;
		padding: 4px 8px;
	}
	.chat-ov-close:hover {
		color: #aaa;
	}

	.chat-ov-messages {
		flex: 1;
		overflow-y: auto;
		padding: 14px 14px 8px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		scrollbar-width: thin;
		scrollbar-color: #222 transparent;
	}

	.chat-ov-empty {
		color: #333;
		font-size: 0.82rem;
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
		max-width: 78%;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.chat-ov-input {
		padding: 10px 12px env(safe-area-inset-bottom, 12px);
		border-top: 1px solid #1a1a1a;
		flex-shrink: 0;
	}

	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 99;
		background: rgba(0, 0, 0, 0.5);
		border: none;
		cursor: pointer;
	}

	/* ── Bottom nav ── */
	.bottom-nav {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		display: flex;
		justify-content: space-around;
		align-items: center;
		padding: 8px 0 env(safe-area-inset-bottom, 10px);
		border-top: 1px solid #1e1e1e;
		background: #0f0f0f;
		z-index: 50;
	}

	.nav-item {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
		color: #444;
		text-decoration: none;
		flex: 1;
		padding: 6px 0;
		transition: color 0.15s;
	}

	.nav-item.active,
	.nav-item:hover {
		color: #7c8ef5;
	}

	.nav-icon {
		font-size: 1.1rem;
		line-height: 1;
	}

	.nav-label {
		font-size: 0.62rem;
		letter-spacing: 0.03em;
	}
</style>
