<!--
  ThemeDataTab — Data-fanen i ThemePage.
  Dispatcher for tema-spesifikke dashboards, signal-kontrakter, prosjekter og mål-oversikt.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import SectionLabel from '../../ui/SectionLabel.svelte';
	import HealthDashboard from '../HealthDashboard.svelte';
	import EconomicsDashboard from '../EconomicsDashboard.svelte';
	import FoodDashboard from '../FoodDashboard.svelte';
	import FamilyDashboard from '../FamilyDashboard.svelte';
	import TripDashboard from '../TripDashboard.svelte';
	import FerieDashboard from '../FerieDashboard.svelte';
	import BookDashboard from '../BookDashboard.svelte';
	import EgenfrekvensDashboard from '../EgenfrekvensDashboard.svelte';
	import HomeDashboard from '../HomeDashboard.svelte';
	import GoalRing from '../../ui/GoalRing.svelte';
	import ProjectCard from '../../composed/ProjectCard.svelte';
	import ThemeMetricSettingsSheet from '../ThemeMetricSettingsSheet.svelte';
	import type { MetricSettingsMap } from '../ThemeMetricSettingsSheet.svelte';
	import { fetchDashboard, getCachedDashboard, type EconomicsDashboardData, type HealthDashboardData, type TravelDashboardData, type FoodDashboardData, type FamilyDashboardData, type EgenfrekvensDashboardData, type HomeDashboardData } from '$lib/client/dashboard-cache';
	import { getThemeDashboardDefinition, resolveThemeDashboardKind } from '$lib/domain/theme-dashboard-registry';
	import { FLOWS } from '$lib/flows/registry';
	import type { Flow } from '$lib/flows/types';

	/* ── Types ──────────────────────────────────────────── */
	interface Theme {
		id: string;
		name: string;
		emoji: string | null;
		parentTheme?: string | null;
		description?: string | null;
	}

	interface Goal {
		id: string;
		title: string;
		status: string;
		description?: string | null;
		metadata?: Record<string, unknown>;
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

	interface ThemeSignalContract {
		signalType: string;
		ownerDomain: string;
		allowedConsumerDomains: string[];
		description: string | null;
		enabled: boolean;
		config: Record<string, unknown>;
		latest: {
			valueNumber: number | null;
			valueText: string | null;
			valueBool: boolean | null;
			severity: string;
			confidence: string;
			observedAt: string;
			context: Record<string, unknown>;
		} | null;
	}

	interface Props {
		theme: Theme;
		goals: Goal[];
		projects: ThemeProject[];
		initialMetricSettings?: MetricSettingsMap;
		tripProfile?: Record<string, unknown> | null;
		ferieProfile?: Record<string, unknown> | null;
		onSwitchToChat?: (draft?: string) => void;
		onStartFlow?: (flow: Flow) => void;
	}

	let {
		theme,
		goals,
		projects,
		initialMetricSettings = {},
		tripProfile = null,
		ferieProfile = null,
		onSwitchToChat,
		onStartFlow
	}: Props = $props();

	/* ── Dashboard resolution ──────────────────────────── */
	const activeDashboardKind = $derived(resolveThemeDashboardKind(theme?.name));
	const activeDashboard = $derived(getThemeDashboardDefinition(theme?.name));
	const hasThemeDashboard = $derived(activeDashboardKind !== null);
	const isTravel = $derived(activeDashboardKind === 'travel');
	const isFerie = $derived(activeDashboardKind === 'ferie');
	const isBooks = $derived(activeDashboardKind === 'books');

	/* ── Dashboard state ───────────────────────────────── */
	let healthDashboard = $state<HealthDashboardData | null>(null);
	let economicsDashboard = $state<EconomicsDashboardData | null>(null);
	let travelDashboard = $state<TravelDashboardData | null>(null);
	let foodDashboard = $state<FoodDashboardData | null>(null);
	let familyDashboard = $state<FamilyDashboardData | null>(null);
	let egenfrekvensDashboard = $state<EgenfrekvensDashboardData | null>(null);
	let homeDashboard = $state<HomeDashboardData | null>(null);
	let dashboardLoading = $state(false);
	let dashboardLoaded = $state(false);
	let dashboardError = $state('');
	let dashboardRequestId = 0;
	let dashboardCachedAt = $state<string | null>(null);

	/* ── Reise/Ferie state ─────────────────────────────── */
	let currentTripProfile = $state(tripProfile as import('../trip-api').TripProfile | null);
	let currentFerieProfile = $state(ferieProfile as import('../trip-api').FerieProfile | null);

	/* ── Signal state ──────────────────────────────────── */
	let signalContracts = $state<ThemeSignalContract[]>([]);
	let signalsLoading = $state(false);
	let signalsLoaded = $state(false);
	let signalsError = $state('');
	let savingSignalType = $state<string | null>(null);
	const enabledSignalCount = $derived(signalContracts.filter((item) => item.enabled).length);

	/* ── Metric settings ───────────────────────────────── */
	let currentMetricSettings = $state<MetricSettingsMap>(initialMetricSettings);
	let metricSettingsSheetOpen = $state(false);

	/* ── Dashboard props (derived) ─────────────────────── */
	const healthDashboardProps = $derived.by(() => {
		if (activeDashboardKind !== 'health' || !healthDashboard) return null;
		return {
			weekly: healthDashboard.weekly as any,
			monthly: healthDashboard.monthly as any,
			yearly: healthDashboard.yearly as any,
			dailyEffort: healthDashboard.dailyEffort ?? [],
			sources: healthDashboard.sources ?? [],
			recentEvents: healthDashboard.recentEvents ?? [],
			activities: (healthDashboard.activityLayer?.workouts ?? []) as any,
			themeId: theme.id
		};
	});

	const economicsDashboardProps = $derived.by(() => {
		if (activeDashboardKind !== 'economics' || !economicsDashboard) return null;
		return {
			accounts: economicsDashboard.accounts,
			totalBalance: economicsDashboard.totalBalance,
			currentMonth: economicsDashboard.currentMonth,
			monthSpending: economicsDashboard.monthSpending,
			recentTransactions: economicsDashboard.recentTransactions.map((tx) => ({
				...tx,
				category: (tx as { category?: string }).category ?? 'ukategorisert'
			})),
			paydaySpend: economicsDashboard.paydaySpend,
			generatedAt: dashboardCachedAt
		};
	});

	const foodDashboardProps = $derived.by(() => {
		if (activeDashboardKind !== 'food' || !foodDashboard) return null;
		return {
			weekContext: foodDashboard.weekContext,
			mealPlans: foodDashboard.mealPlans,
			pantry: foodDashboard.pantry,
			expiringSoon: foodDashboard.expiringSoon
		};
	});

	const familyDashboardProps = $derived.by(() => {
		if (activeDashboardKind !== 'family' || !familyDashboard) return null;
		return { data: familyDashboard };
	});

	const egenfrekvensDashboardProps = $derived.by(() => {
		if (activeDashboardKind !== 'egenfrekvens' || !egenfrekvensDashboard) return null;
		return { data: egenfrekvensDashboard };
	});

	const homeDashboardProps = $derived.by(() => {
		if (activeDashboardKind !== 'home' || !homeDashboard) return null;
		return homeDashboard;
	});

	/* ── Goal helpers (for non-dashboard themes) ───────── */
	const GOAL_COLORS: Record<string, string> = {
		active: '#7c8ef5',
		completed: '#5fa0a0',
		paused: '#888',
		abandoned: '#e07070',
	};

	function goalPct(goal: Goal): number {
		if (goal.status === 'completed') return 100;
		if (goal.status === 'paused') return 35;

		const metadata = goal.metadata as any;
		if (!metadata?.startDate || !metadata?.endDate || !metadata?.targetValue) return 0;

		const now = new Date();
		const start = new Date(metadata.startDate);
		const end = new Date(metadata.endDate || metadata.targetDate);

		if (now < start) return 0;
		if (now > end) return 100;

		const totalDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
		const elapsedDays = (now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
		const expectedProgress = (elapsedDays / totalDays) * 100;

		return Math.min(100, Math.max(0, Math.round(expectedProgress)));
	}

	function goalDelta(goal: Goal): { value: number; unit: string } | null {
		const metadata = goal.metadata as any;
		if (!metadata?.metricId || !metadata?.targetValue) return null;

		if (metadata.metricId === 'running_distance' && healthDashboard?.recentEvents) {
			const startDate = metadata.startDate ? new Date(metadata.startDate) : new Date(0);
			const endDate = metadata.endDate ? new Date(metadata.endDate) : new Date();
			const now = new Date();

			const runningEvents = healthDashboard.recentEvents.filter(e => {
				const eventDate = new Date(e.timestamp);
				return e.dataType === 'workout' &&
				       eventDate >= startDate &&
				       eventDate <= now;
			});

			let totalKm = 0;
			for (const event of runningEvents) {
				const sportType = typeof event.data.sportType === 'string' ? event.data.sportType.toLowerCase() : '';
				if (sportType && sportType !== 'running') continue;

				const distance = typeof event.data.distance === 'number' ? event.data.distance :
				                 typeof event.data.distanceMeters === 'number' ? event.data.distanceMeters : null;

				if (distance !== null) {
					totalKm += distance > 80 ? distance / 1000 : distance;
				}
			}

			const totalDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
			const elapsedDays = Math.min(totalDays, (now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
			const expectedKm = (elapsedDays / totalDays) * metadata.targetValue;

			const delta = totalKm - expectedKm;
			return { value: delta, unit: 'km' };
		}

		if (metadata.metricId === 'weight_change' && healthDashboard?.recentEvents) {
			const startDate = metadata.startDate ? new Date(metadata.startDate) : new Date(0);
			const now = new Date();

			const weightEvents = healthDashboard.recentEvents
				.filter(e => e.dataType === 'weight' && new Date(e.timestamp) >= startDate)
				.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

			if (weightEvents.length === 0) return null;

			const latestWeight = typeof weightEvents[0].data.weight === 'number' ? weightEvents[0].data.weight : null;
			const startWeight = metadata.startValue;

			if (latestWeight === null || startWeight === null) return null;

			const actualChange = latestWeight - startWeight;
			const targetChange = metadata.targetValue;

			const totalDays = metadata.endDate ?
				(new Date(metadata.endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24) : 90;
			const elapsedDays = Math.min(totalDays, (now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
			const expectedChange = (elapsedDays / totalDays) * targetChange;

			const delta = actualChange - expectedChange;
			return { value: delta, unit: 'kg' };
		}

		return null;
	}

	/* ── Signal helpers ────────────────────────────────── */
	function formatSignalValue(latest: ThemeSignalContract['latest']) {
		if (!latest) return 'Ingen data ennå';
		if (latest.valueText) return latest.valueText;
		if (latest.valueNumber !== null) return Number(latest.valueNumber).toFixed(1);
		if (latest.valueBool !== null) return latest.valueBool ? 'Ja' : 'Nei';
		return 'Ingen data';
	}

	function formatSignalObservedAt(iso: string) {
		return new Intl.DateTimeFormat('nb-NO', {
			day: '2-digit',
			month: '2-digit',
			hour: '2-digit',
			minute: '2-digit'
		}).format(new Date(iso));
	}

	/* ── Dashboard loading ─────────────────────────────── */
	function dashboardKind() {
		return activeDashboardKind;
	}

	function applyCachedDashboard() {
		const kind = dashboardKind();
		if (!kind) return null;

		const cached = getCachedDashboard(theme.id, kind);
		if (!cached) return null;

		dashboardCachedAt = cached.cachedAt;
		dashboardLoaded = true;
		if (kind === 'health') {
			healthDashboard = cached.data as HealthDashboardData;
		} else if (kind === 'economics') {
			economicsDashboard = cached.data as EconomicsDashboardData;
		} else if (kind === 'travel') {
			travelDashboard = cached.data as TravelDashboardData;
		} else if (kind === 'food') {
			foodDashboard = cached.data as FoodDashboardData;
		} else if (kind === 'family') {
			familyDashboard = cached.data as FamilyDashboardData;
		} else if (kind === 'egenfrekvens') {
			egenfrekvensDashboard = cached.data as EgenfrekvensDashboardData;
		} else if (kind === 'home') {
			homeDashboard = cached.data as HomeDashboardData;
		}

		return cached;
	}

	async function ensureDashboardLoaded(force = false) {
		if (!hasThemeDashboard || dashboardLoading) return;

		const kind = dashboardKind();
		if (!kind) return;

		const cached = applyCachedDashboard();
		if (!force && cached) {
			const age = Date.now() - new Date(cached.cachedAt).getTime();
			if (age < 60_000) return;
		}
		if (dashboardLoaded && !force && !cached) return;

		dashboardLoading = true;
		dashboardError = '';
		const requestId = ++dashboardRequestId;

		try {
			const result = await fetchDashboard(theme.id, kind, force);
			if (requestId !== dashboardRequestId) return;

			dashboardCachedAt = result.cachedAt;

			if (kind === 'health') {
				healthDashboard = result.data as HealthDashboardData;
			} else if (kind === 'economics') {
				economicsDashboard = result.data as EconomicsDashboardData;
			} else if (kind === 'travel') {
				travelDashboard = result.data as TravelDashboardData;
			} else if (kind === 'food') {
				foodDashboard = result.data as FoodDashboardData;
			} else if (kind === 'family') {
				familyDashboard = result.data as FamilyDashboardData;
			} else if (kind === 'egenfrekvens') {
				egenfrekvensDashboard = result.data as EgenfrekvensDashboardData;
			} else if (kind === 'home') {
				homeDashboard = result.data as HomeDashboardData;
			}
			dashboardLoaded = true;
		} catch {
			if (requestId !== dashboardRequestId) return;
			dashboardError = 'Kunne ikke laste dashboarddata.';
			dashboardLoaded = true; // Prevent retry spam
		} finally {
			if (requestId === dashboardRequestId) {
				dashboardLoading = false;
			}
		}
	}

	/* ── Signal loading ────────────────────────────────── */
	async function loadThemeSignals(force = false) {
		if (signalsLoading) return;
		if (signalsLoaded && !force) return;

		signalsLoading = true;
		signalsError = '';
		try {
			const res = await fetch(`/api/tema/${theme.id}/signals`);
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.error ?? 'Kunne ikke laste signaler');
			}
			const data = await res.json() as { contracts: ThemeSignalContract[] };
			signalContracts = data.contracts ?? [];
			signalsLoaded = true;
		} catch (err) {
			signalsError = err instanceof Error ? err.message : 'Kunne ikke laste signaler';
		} finally {
			signalsLoading = false;
		}
	}

	async function setThemeSignalEnabled(signalType: string, enabled: boolean) {
		savingSignalType = signalType;
		signalsError = '';
		const previous = signalContracts;
		signalContracts = signalContracts.map((item) =>
			item.signalType === signalType ? { ...item, enabled } : item
		);

		try {
			const res = await fetch(`/api/tema/${theme.id}/signals`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ signalType, enabled })
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.error ?? 'Kunne ikke oppdatere signal');
			}
		} catch (err) {
			signalContracts = previous;
			signalsError = err instanceof Error ? err.message : 'Kunne ikke oppdatere signal';
		} finally {
			savingSignalType = null;
		}
	}

	/* ── Auto-load on mount ────────────────────────────── */
	$effect(() => {
		if (hasThemeDashboard) {
			void ensureDashboardLoaded();
		}
	});

	$effect(() => {
		void loadThemeSignals();
	});

	/** Refresh dashboard + signals (called from parent) */
	export async function refresh() {
		await Promise.allSettled([
			hasThemeDashboard ? ensureDashboardLoaded(true) : Promise.resolve(),
			loadThemeSignals(true)
		]);
	}
</script>

{#if isBooks}
	<BookDashboard themeId={theme.id} />
{:else}
<!-- TripDashboard har egne horisontale gutters per seksjon — flush panel unngår dobbel margin -->
<div class="data-panel" class:data-panel-flush={isTravel}>
	{#if isTravel}
		<TripDashboard
			themeId={theme.id}
			themeEmoji={theme.emoji}
			bind:tripProfile={currentTripProfile}
		/>
	{:else if isFerie}
		<FerieDashboard
			themeId={theme.id}
			themeEmoji={theme.emoji}
			bind:ferieProfile={currentFerieProfile}
		/>
	{:else}
	{#if hasThemeDashboard && dashboardLoading && !dashboardLoaded}
		<div class="data-empty data-empty-tight">
			<p>Laster dashboard…</p>
		</div>
	{/if}

	{#if hasThemeDashboard && dashboardError}
		<div class="data-empty data-empty-tight">
			<p>{dashboardError}</p>
			<button class="data-new-btn" onclick={() => void ensureDashboardLoaded(true)}>
				Prøv igjen
			</button>
		</div>
	{/if}

	{#if healthDashboardProps}
		<div class="health-dashboard-wrap">
			<button
				class="metric-settings-btn"
				onclick={() => metricSettingsSheetOpen = true}
				type="button"
				title="Konfigurer terskelverdier"
			>⚙</button>
			<HealthDashboard
				{...healthDashboardProps}
				embedded={true}
				metricSettings={currentMetricSettings}
			/>
		</div>
	{/if}

	<ThemeMetricSettingsSheet
		open={metricSettingsSheetOpen}
		settings={currentMetricSettings}
		themeId={theme.id}
		onclose={() => metricSettingsSheetOpen = false}
		onsave={(updated) => { currentMetricSettings = updated; metricSettingsSheetOpen = false; }}
	/>

	{#if economicsDashboardProps}
		<EconomicsDashboard
			{...economicsDashboardProps}
			embedded={true}
		/>
	{/if}

	{#if foodDashboardProps}
		<FoodDashboard
			{...foodDashboardProps}
		/>
	{/if}

	{#if familyDashboardProps}
		<FamilyDashboard
			{...familyDashboardProps}
		/>
	{/if}

	{#if egenfrekvensDashboardProps}
		<EgenfrekvensDashboard
			{...egenfrekvensDashboardProps}
			onstartCheckin={() => onStartFlow?.(FLOWS['egenfrekvens_checkin'])}
			onstartQuick={() => onStartFlow?.(FLOWS['egenfrekvens_quick'])}
			ondelete={async (eventIds) => {
				await Promise.all(eventIds.map((id) =>
					fetch(`/api/egenfrekvens/checkin?id=${id}`, { method: 'DELETE' })
				));
				void ensureDashboardLoaded(true);
			}}
		/>
	{/if}

	{#if homeDashboardProps}
		<HomeDashboard
			{...homeDashboardProps}
			onOpenProject={(id) => goto(`/prosjekt/${id}`)}
			onOpenAppliance={(href) => goto(href)}
			onOpenChat={(prefill) => onSwitchToChat?.(prefill)}
		/>
	{/if}

	{#if projects.length > 0}
		<section class="theme-projects">
			<SectionLabel>Prosjekter</SectionLabel>
			<div class="theme-projects-grid">
				{#each projects as project (project.id)}
					<ProjectCard
						id={project.id}
						title={project.title}
						description={project.description}
						emoji={project.emoji}
						domain={project.domain}
						type={project.type}
						status={project.status}
						progress={project.progress}
						onOpen={(id) => goto(`/prosjekt/${id}`)}
					/>
				{/each}
			</div>
		</section>
	{/if}

	{#if hasThemeDashboard && dashboardLoading && dashboardLoaded}
		<p class="data-refreshing">Oppdaterer dashboard…</p>
	{/if}

	{#if hasThemeDashboard && dashboardCachedAt}
		<p class="data-refreshing">Sist lagret: {new Intl.DateTimeFormat('nb-NO', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }).format(new Date(dashboardCachedAt))}</p>
	{/if}

	{#if !hasThemeDashboard}
	{#if goals.length === 0}
		<div class="data-empty" class:data-empty-tight={false}>
			<p>Ingen aktive mål i dette temaet ennå.</p>
			<button
				class="data-new-btn"
				onclick={() => onSwitchToChat?.()}
			>
				+ Si til AI at du vil sette et mål
			</button>
		</div>
	{:else}
		<div class="goals-grid">
			{#each goals as goal}
				{@const pct = goalPct(goal)}
				{@const color = GOAL_COLORS[goal.status] ?? '#7c8ef5'}
				{@const delta = goalDelta(goal)}
				<div class="goal-card">
					<div class="goal-ring">
						<GoalRing {pct} {color} r={28} strokeWidth={5} size={80}>
							{#snippet children()}
								{#if delta}
									<text
										x="40"
										y="40"
										text-anchor="middle"
										fill={delta.value >= 0 ? '#48b581' : '#ee8c8c'}
										font-size="14"
										font-weight="700"
									>{delta.value >= 0 ? '+' : ''}{delta.value.toFixed(1)}</text>
									<text
										x="40"
										y="52"
										text-anchor="middle"
										fill={delta.value >= 0 ? '#48b581' : '#ee8c8c'}
										font-size="9"
										font-weight="600"
									>{delta.unit}</text>
								{:else}
									<text
										x="40"
										y="44"
										text-anchor="middle"
										fill={color}
										font-size="12"
										font-weight="700"
									>{pct}%</text>
								{/if}
							{/snippet}
						</GoalRing>
					</div>
					<div class="goal-info">
						<span class="goal-title">{goal.title}</span>
						{#if goal.description}
							<span class="goal-desc">{goal.description}</span>
						{/if}
						<span
							class="goal-status"
							style="color:{color}"
						>{goal.status}</span>
					</div>
				</div>
			{/each}
		</div>
	{/if}
	{/if}
	{/if}

	<details class="signal-collapsed-wrap">
		<summary class="signal-collapsed-summary">
			<span>Signalinput</span>
			<span class="signal-collapsed-count">{enabledSignalCount} aktiv{enabledSignalCount === 1 ? '' : 'e'}</span>
		</summary>
		<div class="signal-collapsed-body">
			<p class="signal-panel-copy">Velg hvilke kontrakter dette temaet skal bruke som datainput.</p>

			{#if signalsLoading && !signalsLoaded}
				<p class="signal-state">Laster signaler…</p>
			{:else if signalsError}
				<div class="signal-state signal-state-error">
					<span>{signalsError}</span>
					<button class="signal-retry-btn" onclick={() => void loadThemeSignals(true)}>Prøv igjen</button>
				</div>
			{:else if signalContracts.length === 0}
				<p class="signal-state">Ingen signal-kontrakter tilgjengelig ennå.</p>
			{:else}
				<div class="signal-list">
					{#each signalContracts as signal}
						<label class="signal-item" for={`signal-${signal.signalType}`}>
							<div class="signal-item-main">
								<div class="signal-item-title-row">
									<strong>{signal.signalType}</strong>
									<span class="signal-owner">{signal.ownerDomain}</span>
								</div>
								{#if signal.description}
									<p class="signal-item-desc">{signal.description}</p>
								{/if}
								{#if signal.latest}
									<p class="signal-item-latest">
										Sist: {formatSignalValue(signal.latest)} · {formatSignalObservedAt(signal.latest.observedAt)}
									</p>
								{/if}
							</div>
							<input
								id={`signal-${signal.signalType}`}
								type="checkbox"
								checked={signal.enabled}
								disabled={savingSignalType === signal.signalType}
								onchange={(event) => setThemeSignalEnabled(signal.signalType, (event.currentTarget as HTMLInputElement).checked)}
							/>
						</label>
					{/each}
				</div>
			{/if}
		</div>
	</details>
</div>
{/if}

<style>
	/* ── Data tab ── */
	.data-panel {
		padding: 16px var(--page-px);
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.data-panel-flush {
		padding-left: 0;
		padding-right: 0;
	}

	.data-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		padding: 48px 20px;
		color: #444;
		font-size: 0.85rem;
		text-align: center;
	}

	.data-empty-tight {
		padding-top: 8px;
	}

	.data-new-btn {
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		color: #7c8ef5;
		font: inherit;
		font-size: 0.8rem;
		padding: 8px 16px;
		border-radius: 99px;
		cursor: pointer;
	}

	.data-refreshing {
		margin: 0;
		font-size: 0.72rem;
		color: #555;
		text-align: center;
	}

	.health-dashboard-wrap {
		position: relative;
	}

	.metric-settings-btn {
		position: absolute;
		top: 4px;
		right: 4px;
		z-index: 10;
		background: transparent;
		border: none;
		color: #555;
		font-size: 1rem;
		cursor: pointer;
		padding: 4px 6px;
		line-height: 1;
	}

	.metric-settings-btn:hover {
		color: #999;
	}

	/* ── Signal panel ── */
	.signal-collapsed-wrap {
		margin-top: 6px;
		border: 1px solid #242424;
		border-radius: 12px;
		background: #0f0f0f;
		overflow: hidden;
	}

	.signal-collapsed-summary {
		list-style: none;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		padding: 10px 12px;
		cursor: pointer;
		font-size: 0.82rem;
		font-weight: 600;
		color: #d7d7d7;
	}

	.signal-collapsed-summary::-webkit-details-marker {
		display: none;
	}

	.signal-collapsed-count {
		font-size: 0.72rem;
		color: #8e9cff;
	}

	.signal-collapsed-body {
		padding: 0 12px 12px;
		display: flex;
		flex-direction: column;
		gap: 10px;
		border-top: 1px solid #1e1e1e;
	}

	.signal-panel-copy {
		margin: 0;
		font-size: 0.78rem;
		color: #7d7d7d;
	}

	.signal-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.signal-item {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		justify-content: space-between;
		padding: 10px;
		border-radius: 10px;
		border: 1px solid #242424;
		background: #141414;
	}

	.signal-item-main {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.signal-item-title-row {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.signal-item-title-row strong {
		font-size: 0.8rem;
		color: #ddd;
		word-break: break-word;
	}

	.signal-owner {
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #9a9a9a;
	}

	.signal-item-desc,
	.signal-item-latest {
		margin: 0;
		font-size: 0.72rem;
		line-height: 1.4;
		color: #8a8a8a;
	}

	.signal-item input[type='checkbox'] {
		width: 18px;
		height: 18px;
		margin-top: 2px;
	}

	.signal-state {
		margin: 0;
		font-size: 0.78rem;
		color: #9a9a9a;
	}

	.signal-state-error {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		color: #ee8c8c;
	}

	.signal-retry-btn {
		border: 1px solid #3a3a3a;
		background: #1a1a1a;
		color: #ddd;
		border-radius: 999px;
		padding: 6px 10px;
		font: inherit;
		font-size: 0.74rem;
		cursor: pointer;
	}

	/* ── Projects ── */
	.theme-projects {
		margin-top: 8px;
	}
	.theme-projects :global(.section-label) {
		margin-bottom: 10px;
	}
	.theme-projects-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 10px;
	}

	/* ── Goals (non-dashboard themes) ── */
	.goals-grid {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.goal-card {
		background: var(--card-bg-subtle, #141414);
		border: 1px solid var(--card-border, #242424);
		border-radius: var(--radius-md, 12px);
		padding: 14px;
		display: flex;
		gap: 14px;
		align-items: center;
		position: relative;
	}

	.goal-ring {
		flex-shrink: 0;
	}

	.goal-info {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
		flex: 1;
	}

	.goal-title {
		font-size: 0.9rem;
		font-weight: 600;
		color: #ddd;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.goal-desc {
		font-size: 0.72rem;
		color: #555;
		line-height: 1.4;
	}

	.goal-status {
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.07em;
	}
</style>
