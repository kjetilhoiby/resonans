<!--
  ThemePage — tab-visning for ett tema.
	Tabs: Chat | Data | Mål | Flyter | Filer | Lister (reise)

  Props:
    theme           tema-objekt fra DB
    initialMessages meldinger for dette temaets samtale
    goals           aktive mål koblet til temaet
    conversationId  UUID til temaets conversation (for API-kall)
-->
<script lang="ts">
	import { goto, preloadCode } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { PageHeader } from '../ui';
	import { getThemeHueStyle } from '$lib/domain/theme-hues';
	import { resolveThemeDashboardKind, getThemeDashboardDefinition } from '$lib/domain/theme-dashboard-registry';
	import { finishNavMetric, startNavMetric } from '$lib/client/nav-metrics';
	import FlowSheet from '../flows/FlowSheet.svelte';
	import { getFlowsByTheme } from '$lib/flows/registry';
	import type { Flow } from '$lib/flows/types';
	import type { MetricSettingsMap } from './ThemeMetricSettingsSheet.svelte';
	import TripListsPanel from './TripListsPanel.svelte';
	import ThemeGoalsTab from './theme/ThemeGoalsTab.svelte';
	import ThemeFlowsTab from './theme/ThemeFlowsTab.svelte';
	import ThemeFilesTab from './theme/ThemeFilesTab.svelte';
	import ThemeChatTab from './theme/ThemeChatTab.svelte';
	import ThemeTasksTab from './theme/ThemeTasksTab.svelte';
	import ThemeKapplisteTab from './theme/ThemeKapplisteTab.svelte';
	import ThemeDataTab from './theme/ThemeDataTab.svelte';

	/* ── Types ──────────────────────────────────────────── */
	interface Theme {
		id: string;
		name: string;
		emoji: string | null;
		parentTheme?: string | null;
		description?: string | null;
	}

	interface Message {
		id: string;
		role: 'user' | 'assistant' | 'system';
		content: string;
		timestamp: string;
	}

	interface Goal {
		id: string;
		title: string;
		status: string;
		description?: string | null;
		metadata?: Record<string, unknown>;
	}

	interface ThemeConversation {
		id: string;
		title: string;
		preview: string | null;
		starred: boolean;
		archived: boolean;
		updatedAt: string;
		createdAt: string;
	}

	interface SelectedWorkout {
		id: string;
		timestamp: string;
		sportType: string;
		title: string;
		distanceMeters: number | null;
		distanceKm: number | null;
		durationSeconds: number | null;
		paceSecondsPerKm: number | null;
		elevationMeters: number | null;
		avgHeartRate: number | null;
		maxHeartRate: number | null;
		source: string | null;
		sourceName: string | null;
		sourceFormat: string | null;
		chatPrompt: string;
	}

	interface ThemeProject {
		id: string;
		title: string;
		description: string | null;
		domain: string | null;
		type: string | null;
		status: string;
		emoji: string | null;
		progress: import('$lib/server/services/project-metrics-service').ProjectProgress | null;
	}

	interface ThemeFile {
		id: string;
		name: string;
		url: string;
		fileType: string | null;
		mimeType: string | null;
		sizeBytes: number | null;
		createdAt: string;
	}

	interface Props {
		theme: Theme;
		initialMessages: Message[];
		goals: Goal[];
		conversationId: string;
		themeConversations?: ThemeConversation[];
		themeInstruction?: string;
		selectedWorkout?: SelectedWorkout | null;
		tripProfile?: Record<string, unknown> | null;
		tripLists?: import('./trip-api').ThemeList[];
		ferieProfile?: Record<string, unknown> | null;
		themeFiles?: ThemeFile[];
		metricSettings?: MetricSettingsMap;
		projects?: ThemeProject[];
		isHomeProject?: boolean;
		projectProfile?: Record<string, unknown> | null;
		tasks?: import('./theme/ThemeTasksTab.svelte').ProjectTask[];
		cutLists?: Array<{ id: string; title: string; kerfMm: number; transportMaxLengthMm: number; transportMaxWidthMm: number; materials: import('$lib/kappliste/calc').Material[]; sortOrder: number; updatedAt: string }>;
	}

	let { theme, initialMessages, goals, conversationId, themeConversations = [], themeInstruction = '', selectedWorkout = null, tripProfile = null, tripLists = [], ferieProfile = null, themeFiles: initialThemeFiles = [], metricSettings: initialMetricSettings = {}, projects = [], isHomeProject = false, projectProfile = null, tasks = [], cutLists = [] }: Props = $props();

	/* ── Subtab-tilstand ────────────────────────────────── */
	type Tab = 'chat' | 'data' | 'mål' | 'flyter' | 'filer' | 'lister' | 'oppgaver' | 'kapp';
	const activeDashboardKind = $derived(resolveThemeDashboardKind(theme?.name));
	const activeDashboard = $derived(getThemeDashboardDefinition(theme?.name));
	const hasThemeDashboard = $derived(activeDashboardKind !== null);
	const requestedTab = get(page).url.searchParams.get('tab');
	const availableTabs = $derived<Tab[]>(
		isHomeProject
			? ['chat', 'oppgaver', 'kapp', 'filer']
			: activeDashboardKind === 'health'
			? ['chat', 'data', 'mål', 'flyter', 'filer']
			: activeDashboardKind === 'economics'
				? ['chat', 'data', 'mål', 'flyter', 'filer']
				: activeDashboardKind === 'travel'
					? ['chat', 'data', 'lister', 'filer']
					: activeDashboardKind === 'ferie'
					? ['chat', 'data', 'lister', 'filer']
					: activeDashboardKind === 'books'
						? ['chat', 'data', 'filer']
						: activeDashboardKind === 'egenfrekvens'
							? ['chat', 'data', 'mål', 'flyter', 'filer']
							: ['chat', 'data', 'mål', 'filer']
	);
	const requestedPrompt = get(page).url.searchParams.get('prompt') ?? '';
	const hasLinkedWorkout = $derived(Boolean(selectedWorkout));
	const isHandoff = get(page).url.searchParams.get('handoff') === '1';
	const validTabs: Tab[] = ['chat', 'data', 'mål', 'flyter', 'filer', 'lister', 'oppgaver', 'kapp'];
	let tab = $state<Tab>(
		hasLinkedWorkout
			? 'chat'
			: validTabs.includes(requestedTab as Tab)
			? requestedTab as Tab
			: isHomeProject
				? 'oppgaver'
				: hasThemeDashboard
					? 'data'
					: 'chat'
	);
	let handoffPhase = $state<'intro' | 'content'>('content');

	/* ── Reise-state ────────────────────────────────────── */
	let tripListsState = $state<import('./trip-api').ThemeList[]>(tripLists);

	/* ── Archive redirect (from chat tab) ──────────────── */
	let archiveRedirect = $state<{ name: string; emoji?: string | null } | null>(null);

	/* ── Data tab ref ──────────────────────────────────── */
	let dataTabRef = $state<ThemeDataTab | null>(null);

	/* ── Chat starts open? ─────────────────────────────── */
	// Draft satt fra et dashboard (f.eks. "+ Nytt prosjekt"-knappen) som vil åpne chatten forhåndsfylt.
	let composedDraft = $state('');
	const chatStartOpen = $derived(isHandoff || hasLinkedWorkout || Boolean(requestedPrompt) || Boolean(composedDraft));
	const chatInitialDraft = $derived(composedDraft || requestedPrompt || selectedWorkout?.chatPrompt || '');

	function goToChat(draft?: string) {
		if (draft) composedDraft = draft;
		tab = 'chat';
	}

	onMount(() => {
		finishNavMetric('tema');
		void preloadCode('/');

		document.documentElement.classList.add('tp-theme-bg');
		document.body.classList.add('tp-theme-bg');

		let timer: ReturnType<typeof setTimeout> | null = null;

		if (get(page).url.searchParams.get('handoff') === '1') {
			handoffPhase = 'intro';
			timer = setTimeout(() => {
				handoffPhase = 'content';
			}, 950);
		}

		return () => {
			if (timer) clearTimeout(timer);
			document.documentElement.classList.remove('tp-theme-bg');
			document.body.classList.remove('tp-theme-bg');
		};
	});

	/* ── Flyter-tab: flow discovery ─────────── */
	let selectedFlow = $state<Flow | null>(null);
	const availableFlows = $derived(getFlowsByTheme(theme?.name ?? '', theme?.parentTheme));

	async function handleFlowComplete(flowId: string, data: Record<string, any>) {
		if (flowId === 'health_weight_onboarding') {
			const startWeight = typeof data.startWeight === 'number' ? data.startWeight : null;
			const targetWeight = typeof data.targetWeight === 'number' ? data.targetWeight : null;
			const targetChange = startWeight && targetWeight ? targetWeight - startWeight : undefined;

			try {
				const response = await fetch('/api/health/weight-onboarding', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						historyText: data.historyText || '',
						startDate: data.startDate || '',
						endDate: data.endDate || '',
						startWeight,
						targetWeight,
						targetChange
					})
				});

				const payload = await response.json();
				if (!response.ok || payload.success === false) {
					throw new Error(payload?.message || 'Kunne ikke lagre onboarding');
				}

				if (activeDashboardKind === 'health') {
					void dataTabRef?.refresh();
				}
			} catch (error) {
				console.error('Flow completion error:', error);
			}
		} else if (flowId === 'economics_category_budget') {
			try {
				const category = data.category as string;
				const monthlyBudget = Number(data.monthlyBudget);

				if (!category || !Number.isFinite(monthlyBudget) || monthlyBudget <= 0) {
					throw new Error('Invalid category or budget value');
				}

				const metricId = category === 'dagligvarer' ? 'grocery_spend' : `${category}_spend`;
				const categoryLabels: Record<string, string> = {
					dagligvarer: 'Dagligvarer',
					kafe_og_restaurant: 'Kafe og restaurant',
					bil_og_transport: 'Transport og bil',
					helse_og_velvaere: 'Helse og velvære',
					medier_og_underholdning: 'Medier og underholdning',
					hobby_og_fritid: 'Hobby og fritid',
					hjem_og_hage: 'Hjem og hage',
					klaer_og_utstyr: 'Klær og utstyr',
					barn: 'Barn',
					reise: 'Reise'
				};

				const response = await fetch(`/api/goal-tracks/${metricId}`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						tracks: [
							{
								id: `${category}-month`,
								metricId,
								label: `${categoryLabels[category] || category} per måned`,
								kind: 'level',
								window: 'month',
								targetValue: monthlyBudget,
								unit: 'kr',
								priority: 100
							}
						]
					})
				});

				if (!response.ok) {
					throw new Error('Failed to save category budget');
				}

				if (activeDashboardKind === 'economics') {
					void dataTabRef?.refresh();
				}
			} catch (error) {
				console.error('Flow completion error:', error);
			}
		}
	}

	function startFlow(flow: Flow) {
		selectedFlow = flow;
	}

	function closeFlow() {
		selectedFlow = null;
	}

	function goHome() {
		startNavMetric('tema', 'home');
		void goto('/');
	}

	export async function refresh() {
		await dataTabRef?.refresh();
	}
</script>

<div class="theme-page" style={getThemeHueStyle(theme.name)}>
	{#if archiveRedirect}
		<section class="tp-archived" aria-live="polite">
			<div class="tp-archived-chip">
				<span class="tp-archived-icon">{archiveRedirect.emoji ?? '◎'}</span>
				<span>Tema arkivert</span>
			</div>
			<h1 class="tp-archived-title">{archiveRedirect.name}</h1>
			<p class="tp-archived-copy">Sender deg tilbake til hjem…</p>
		</section>
	{:else}
	{#if handoffPhase === 'intro'}
		<section class="tp-launch" aria-live="polite">
			<div class="tp-launch-chip">
				<span class="tp-launch-icon">{theme.emoji ?? '◎'}</span>
				<span>Nytt tema</span>
			</div>
			<h1 class="tp-launch-title">{theme.name}</h1>
			<p class="tp-launch-copy">Kobler deg inn i Samtaler, Mål og Filer…</p>
		</section>
	{:else}
		<!-- ── Topptekst ── -->
		<header class="tp-header tp-enter">
			<PageHeader
				title={theme.name}
				subtitle={theme.description ?? ''}
				emoji={theme.emoji ?? '🎯'}
				onTitleClick={goHome}
				titleLabel="Gå til forsiden"
			/>
		</header>

		<!-- ── Tabs ── -->
		<div class="tp-tabs tp-enter" role="tablist" aria-label="Tema-seksjoner">
			{#each availableTabs as t}
				<button
					class="tp-tab"
					class:active={tab === t}
					role="tab"
					aria-selected={tab === t}
					onclick={() => (tab = t)}
				>
					{#if t === 'chat'}💬 Samtaler
				{:else if t === 'data'}{activeDashboard ? `${activeDashboard.icon} Oversikt` : '📊 Data'}
					{:else if t === 'mål'}🎯 Mål
					{:else if t === 'flyter'}🧭 Flyter
					{:else if t === 'lister'}📋 Lister
					{:else if t === 'oppgaver'}✅ Oppgaver
					{:else if t === 'kapp'}📐 Kapp
					{:else}📁 Filer{/if}
				</button>
			{/each}
		</div>

		<!-- ── Tab-innhold ── -->
		<div class="tp-body tp-enter">
		<!-- CHAT -->
		{#if tab === 'chat'}
			<ThemeChatTab
				themeId={theme.id}
				themeName={theme.name}
				themeEmoji={theme.emoji}
				{conversationId}
				conversations={themeConversations}
				{initialMessages}
				{selectedWorkout}
				initialDraft={chatInitialDraft}
				startOpen={chatStartOpen}
				{isHandoff}
				onSwitchToData={() => { tab = 'data'; }}
				onArchiveRedirect={(info) => {
					archiveRedirect = info;
					setTimeout(() => void goto('/?archivedTheme=1'), 1050);
				}}
			/>

		<!-- DATA -->
		{:else if tab === 'data'}
			<ThemeDataTab
				bind:this={dataTabRef}
				{theme}
				{goals}
				projects={projects}
				initialMetricSettings={initialMetricSettings}
				{tripProfile}
				{ferieProfile}
				onSwitchToChat={goToChat}
				onStartFlow={startFlow}
			/>

		<!-- LISTER (reise) -->
		{:else if tab === 'lister'}
			<TripListsPanel
				themeId={theme.id}
				bind:lists={tripListsState}
			/>

		<!-- MÅL -->
		{:else if tab === 'mål'}
			<ThemeGoalsTab
				{goals}
				themeId={theme.id}
				{activeDashboardKind}
				onSwitchToChat={() => { tab = 'chat'; }}
			/>

		<!-- FLYTER -->
		{:else if tab === 'flyter'}
			<ThemeFlowsTab
				themeName={theme.name}
				{availableFlows}
				onStartFlow={startFlow}
			/>

		<!-- OPPGAVER (prosjekt-undertema) -->
		{:else if tab === 'oppgaver'}
			<ThemeTasksTab
				themeId={theme.id}
				projectName={theme.name}
				initialTasks={tasks}
				{projectProfile}
				onSwitchToChat={goToChat}
			/>

		<!-- KAPPLISTER (prosjekt-undertema) -->
		{:else if tab === 'kapp'}
			<ThemeKapplisteTab
				themeId={theme.id}
				initialCutLists={cutLists}
			/>

		<!-- FILER -->
		{:else}
			<ThemeFilesTab
				themeId={theme.id}
				themeFiles={initialThemeFiles}
				themeInstruction={themeInstruction}
			/>
		{/if}
		</div>
	{/if}
	{/if}
</div>

<!-- Flow overlay -->
{#if selectedFlow}
	{@const flow = selectedFlow}
	<FlowSheet
		flow={flow}
		onclose={closeFlow}
		oncomplete={(data) => {
			handleFlowComplete(flow.id, data);
			closeFlow();
		}}
	/>
{/if}

<style>
	:global(html.tp-theme-bg),
	:global(body.tp-theme-bg) {
		background:
			radial-gradient(120% 90% at 50% -10%, hsl(228 72% 60% / 0.12), transparent 52%),
			linear-gradient(180deg, hsl(228 20% 10%) 0%, hsl(228 22% 8%) 100%);
	}

	.theme-page {
		--theme-hue: 228;
		--tp-bg-0: hsl(var(--theme-hue) 22% 8%);
		--tp-bg-1: hsl(var(--theme-hue) 20% 10%);
		--tp-bg-2: hsl(var(--theme-hue) 24% 13%);
		--tp-border: hsl(var(--theme-hue) 16% 18%);
		--tp-border-strong: hsl(var(--theme-hue) 28% 34%);
		--tp-text: hsl(var(--theme-hue) 20% 92%);
		--tp-text-soft: hsl(var(--theme-hue) 18% 70%);
		--tp-text-muted: hsl(var(--theme-hue) 12% 46%);
		--tp-accent: hsl(var(--theme-hue) 70% 70%);
		--tp-accent-bg: hsl(var(--theme-hue) 40% 22%);
		--tp-accent-bg-strong: hsl(var(--theme-hue) 42% 28%);
		/* Kort på temasider arver hue-tint via --card-*-tokens */
		--card-bg: var(--tp-bg-2);
		--card-bg-subtle: var(--tp-bg-1);
		--card-border: var(--tp-border);
		min-height: 100dvh;
		/* Ingen horisontal padding her — tabs-båndet skal gå kant-til-kant.
		   Header og tab-innhold setter selv var(--page-px) horisontalt. */
		padding: var(--page-pt) 0 var(--page-pb);
		background:
			radial-gradient(120% 90% at 50% -10%, hsl(var(--theme-hue) 72% 60% / 0.12), transparent 52%),
			linear-gradient(180deg, var(--tp-bg-1) 0%, var(--tp-bg-0) 100%);
		color: var(--tp-text-soft);
		font-family: 'Inter', system-ui, sans-serif;
		display: flex;
		flex-direction: column;
	}

	.tp-launch {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 14px;
		padding: 20px;
		background:
			radial-gradient(110% 80% at 50% -10%, hsl(var(--theme-hue) 75% 62% / 0.22), transparent 55%),
			linear-gradient(180deg, var(--tp-bg-2) 0%, var(--tp-bg-0) 100%);
		animation: launchBackdrop 0.9s ease;
	}

	.tp-archived {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 14px;
		padding: 20px;
		background:
			radial-gradient(90% 70% at 50% -10%, hsl(var(--theme-hue) 70% 60% / 0.18), transparent 58%),
			linear-gradient(180deg, var(--tp-bg-2) 0%, var(--tp-bg-0) 100%);
		animation: launchBackdrop 0.45s ease;
	}

	.tp-archived-chip {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 9px 14px;
		border: 1px solid var(--tp-border-strong);
		border-radius: 999px;
		background: var(--tp-accent-bg);
		color: var(--tp-text);
		font-size: 0.8rem;
	}

	.tp-archived-icon {
		width: 24px;
		height: 24px;
		border-radius: 8px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: var(--tp-accent-bg-strong);
		border: 1px solid var(--tp-border-strong);
	}

	.tp-archived-title {
		margin: 0;
		font-size: clamp(1.7rem, 5.3vw, 2.2rem);
		letter-spacing: -0.03em;
		color: var(--tp-text);
	}

	.tp-archived-copy {
		margin: 0;
		font-size: 0.88rem;
		color: var(--tp-text-soft);
	}

	.tp-launch-chip {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 9px 14px;
		border: 1px solid var(--tp-border-strong);
		border-radius: 999px;
		background: var(--tp-accent-bg);
		color: var(--tp-text);
		font-size: 0.8rem;
		animation: launchDrop 0.5s cubic-bezier(0.2, 0.84, 0.24, 1);
	}

	.tp-launch-icon {
		width: 24px;
		height: 24px;
		border-radius: 8px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: var(--tp-accent-bg-strong);
		border: 1px solid var(--tp-border-strong);
	}

	.tp-launch-title {
		margin: 0;
		font-size: clamp(1.8rem, 5.4vw, 2.3rem);
		letter-spacing: -0.03em;
		color: var(--tp-text);
		animation: launchRise 0.58s ease;
	}

	.tp-launch-copy {
		margin: 0;
		font-size: 0.88rem;
		color: var(--tp-text-soft);
		animation: launchFade 0.65s ease;
	}

	@keyframes launchBackdrop {
		from {
			opacity: 0.1;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes launchDrop {
		from {
			opacity: 0;
			transform: translateY(-28px) scale(0.94);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	@keyframes launchRise {
		from {
			opacity: 0;
			transform: translateY(12px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes launchFade {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}


	/* ── Header ── */
	.tp-header {
		padding: 0 var(--page-px) var(--space-lg);
		border-bottom: 1px solid var(--tp-border);
	}

	/* ── Tabs ── */
	.tp-tabs {
		display: flex;
		border-bottom: 1px solid var(--tp-border);
		/* Båndet går kant-til-kant; første fane-label linjerer med innholdet
		   på var(--page-px) (fanen har 12px egen padding). */
		padding: 0 calc(var(--page-px) - 12px);
		gap: 4px;
		overflow-x: auto;
		overflow-y: hidden;
		-webkit-overflow-scrolling: touch;
		scrollbar-width: none;
	}

	@media (max-width: 760px) {
		.tp-tabs {
			mask-image: linear-gradient(
				to right,
				transparent 0,
				black 14px,
				black calc(100% - 14px),
				transparent 100%
			);
			-webkit-mask-image: linear-gradient(
				to right,
				transparent 0,
				black 14px,
				black calc(100% - 14px),
				transparent 100%
			);
		}
	}

	.tp-tabs::-webkit-scrollbar {
		display: none;
	}

	.tp-tab {
		flex: 0 0 auto;
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--tp-text-muted);
		font: inherit;
		font-size: 0.78rem;
		padding: 10px 12px;
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
		white-space: nowrap;
	}

	.tp-tab.active {
		color: var(--tp-text);
		border-bottom-color: var(--tp-accent);
	}

	.tp-tab:hover:not(.active) {
		color: var(--tp-text-soft);
	}

	/* ── Body ── */
	.tp-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	@media (prefers-reduced-motion: reduce) {
		.tp-launch,
		.tp-launch-chip,
		.tp-launch-title,
		.tp-launch-copy,
		.tp-archived,
		.tp-enter {
			animation: none !important;
		}
	}
</style>
