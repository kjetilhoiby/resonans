<script lang="ts">
	import { onMount } from 'svelte';
	import CompactRecordList from '../ui/CompactRecordList.svelte';
	import PeriodPills from '../ui/PeriodPills.svelte';
	import DynamicWidget from '../composed/DynamicWidget.svelte';
	import HealthActivityList from './health/HealthActivityList.svelte';
	import HealthEffortSection from './health/HealthEffortSection.svelte';
	import EffortWeightCard from './health/EffortWeightCard.svelte';
	import HealthMetricGrid from './health/HealthMetricGrid.svelte';
	import HealthScreenTime from './health/HealthScreenTime.svelte';
	import HealthProgramCard from './health/HealthProgramCard.svelte';
	import {
		type WindowMode,
		type AggregatePeriod,
		type WorkoutActivity,
		type ThemeWidget,
		type ProgramSummary,
		type TodaySession,
		type RecentEvent,
		type SourceItem,
		buildQuarterData,
		computeEffortPeriodRange,
		aggregateEffortForPeriod,
		formatEvent,
		formatDate,
		computeTrainingLoad
	} from './health/health-data';

	interface Props {
		weekly: AggregatePeriod[];
		monthly: AggregatePeriod[];
		yearly: AggregatePeriod[];
		dailyEffort?: Array<{ date: string; effort: number }>;
		sources?: SourceItem[];
		recentEvents?: RecentEvent[];
		activities?: WorkoutActivity[];
		themeId?: string;
	}

	let {
		weekly,
		monthly,
		yearly,
		dailyEffort = [],
		sources = [],
		recentEvents = [],
		activities = [],
		themeId
	}: Props = $props();

	// ── Screen time ────────────────────────────────────────
	const screenWeeks = $derived(
		[...weekly]
			.filter((w) => w.metrics?.screenTime)
			.sort((a, b) => (a.periodKey < b.periodKey ? 1 : -1))
	);
	const thisWeekScreen = $derived(screenWeeks[0]?.metrics?.screenTime ?? null);
	const prevWeekScreen = $derived(screenWeeks[1]?.metrics?.screenTime ?? null);

	// ── Theme widgets ──────────────────────────────────────
	let themeWidgets = $state<ThemeWidget[]>([]);
	let themeWidgetsLoading = $state(true);

	// ── Program widget ─────────────────────────────────────
	let activeProgram = $state<ProgramSummary | null>(null);
	let todaySession = $state<TodaySession>(null);
	let programWidgetLoading = $state(true);

	onMount(async () => {
		try {
			const res = await fetch('/api/apps/programs');
			if (!res.ok) { programWidgetLoading = false; return; }
			const body = (await res.json()) as { programs?: ProgramSummary[] };
			const active = body.programs?.find((p) => p.status === 'active') ?? null;
			activeProgram = active;
			if (active) {
				const todayRes = await fetch(`/api/apps/programs/${active.id}/today`);
				if (todayRes.ok) {
					const todayBody = await todayRes.json();
					todaySession = todayBody.session ?? null;
				}
			}
		} catch {
			// Stille feil — widget skjules
		} finally {
			programWidgetLoading = false;
		}
	});

	// ── Period selection ───────────────────────────────────
	let selectedWindow = $state<WindowMode>('30d');
	let showEventDetails = $state(false);

	const aggregatePeriod = $derived<'week' | 'month' | 'year'>(
		selectedWindow === '30d' || selectedWindow === 'month' || selectedWindow === 'quarter' ? 'month' :
		selectedWindow === '365d' || selectedWindow === 'year' ? 'year' :
		'week'
	);

	const widgetRange = $derived<string>(
		selectedWindow === '7d' ? 'last7'
		: selectedWindow === '30d' ? 'last30'
		: selectedWindow === '365d' ? 'last365'
		: selectedWindow === 'week' ? 'current_week'
		: selectedWindow === 'month' ? 'current_month'
		: selectedWindow === 'quarter' ? 'last90'
		: 'current_year'
	);

	const quarterData = $derived(buildQuarterData(monthly));

	const periodData = $derived(
		selectedWindow === 'quarter' ? quarterData :
		aggregatePeriod === 'week' ? weekly : aggregatePeriod === 'month' ? monthly : yearly
	);
	const trainingLoadSeries = $derived(computeTrainingLoad(dailyEffort));

	const latestWeekWithEffort = $derived(
		[...weekly].reverse().find((w) => w.metrics?.weeklyEffort) ?? null
	);
	const latestWeeklyEffort = $derived(latestWeekWithEffort?.metrics?.weeklyEffort ?? null);
	const latestWeekLabel = $derived.by(() => {
		if (!latestWeekWithEffort) return undefined;
		const start = latestWeekWithEffort.startDate ? new Date(latestWeekWithEffort.startDate) : null;
		const end = latestWeekWithEffort.endDate ? new Date(latestWeekWithEffort.endDate) : null;
		if (!start || !end) return latestWeekWithEffort.periodKey;
		const fmt = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short' });
		return `${fmt.format(start)}–${fmt.format(end)}`;
	});

	const effortPeriodMode = $derived<'daily' | 'weekly'>(
		selectedWindow === '7d' || selectedWindow === 'week' ? 'daily' : 'weekly'
	);

	const effortPeriodRange = $derived(computeEffortPeriodRange(selectedWindow));
	const periodEffortAggregate = $derived(
		effortPeriodRange ? aggregateEffortForPeriod(weekly, effortPeriodRange) : null
	);

	// ── Source / event items for CompactRecordList ─────────
	const sourceItems = $derived(
		sources.map((source) => ({
			id: source.id,
			title: source.name,
			subtitle: source.provider,
			meta: source.lastSync ? `Synket ${formatDate(source.lastSync)}` : 'Aldri synket',
			amount: source.isActive ? 'Aktiv' : 'Inaktiv',
			amountTone: source.isActive ? ('positive' as const) : ('neutral' as const)
		}))
	);
	const eventItems = $derived(recentEvents.slice(0, 24).map((item) => formatEvent(item)));

	// ── Data loading ──────────────────────────────────────
	onMount(() => {
		void loadThemeWidgets();
	});

	async function loadThemeWidgets() {
		if (!themeId) { themeWidgetsLoading = false; return; }
		try {
			const res = await fetch(`/api/tema/${themeId}/widgets`);
			if (res.ok) themeWidgets = await res.json();
		} catch { /* stille feil */ } finally { themeWidgetsLoading = false; }
	}

	async function removeThemeWidget(id: string) {
		const previous = themeWidgets;
		themeWidgets = themeWidgets.filter((w) => w.id !== id);
		try {
			const res = await fetch(`/api/user-widgets/${id}`, { method: 'DELETE' });
			if (!res.ok && res.status !== 204) themeWidgets = previous;
		} catch { themeWidgets = previous; }
	}

</script>

<div class="health-dashboard hd-embedded">
	<HealthProgramCard {activeProgram} {todaySession} loading={programWidgetLoading} />

	<HealthScreenTime {thisWeekScreen} {prevWeekScreen} />

	<div class="hd-pills" role="tablist" aria-label="Helseperioder">
		<PeriodPills
			options={['7d', '30d', '365d', 'Uke', 'Måned', 'Kvartal', 'År']}
			value={selectedWindow === '7d' ? '7d' : selectedWindow === '30d' ? '30d' : selectedWindow === '365d' ? '365d' : selectedWindow === 'week' ? 'Uke' : selectedWindow === 'month' ? 'Måned' : selectedWindow === 'quarter' ? 'Kvartal' : 'År'}
			onchange={(value) => {
				selectedWindow =
					value === '7d' ? '7d' :
					value === '30d' ? '30d' :
					value === '365d' ? '365d' :
					value === 'Uke' ? 'week' :
					value === 'Måned' ? 'month' :
					value === 'Kvartal' ? 'quarter' :
					'year';
			}}
		/>
	</div>

	<HealthEffortSection
		{effortPeriodMode}
		{latestWeeklyEffort}
		{latestWeekLabel}
		{periodEffortAggregate}
		{trainingLoadSeries}
	/>

	<EffortWeightCard />

	{#if themeId}
		<div class="hd-widget-card">
			<div class="hd-widget-grid">
				{#if themeWidgetsLoading && themeWidgets.length === 0}
					{#each Array.from({ length: 4 }) as _}
						<div class="hd-widget-skeleton" aria-hidden="true"></div>
					{/each}
				{:else}
					{#each themeWidgets as widget (widget.id)}
						<DynamicWidget
							widgetId={widget.id}
							title={widget.title}
							unit={widget.unit}
							color={widget.color}
							pinned={widget.pinned}
							range={widgetRange}
							onunpin={() => removeThemeWidget(widget.id)}
						/>
					{/each}
				{/if}
			</div>
		</div>
	{/if}

	{#if periodData.length === 0}
		<div class="hd-empty">
			<p>Ingen data tilgjengelig ennå.</p>
			<p class="hd-empty-sub">Koble til eller synkroniser Withings for å fylle Helse-dashbordet.</p>
		</div>
	{:else}
		<HealthMetricGrid {periodData} {weekly} />

		{#if activities.length > 0}
			<HealthActivityList {activities} />
		{/if}

		<div class="hd-sources-section">
			<CompactRecordList title="Kilder" items={sourceItems} emptyText="Ingen aktive helsekilder ennå." />
		</div>

		<details class="hd-events-details" bind:open={showEventDetails}>
			<summary class="hd-events-summary">
				<span class="hd-events-title">Hendelsesdetaljer</span>
				<span class="hd-events-count">({eventItems.length} hendelser)</span>
			</summary>
			<div class="hd-events-content">
				<CompactRecordList title="" items={eventItems} emptyText="Ingen hendelser registrert ennå." />
			</div>
		</details>
	{/if}
</div>

<style>
	.health-dashboard {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}

	.hd-embedded {
		padding-top: 4px;
	}

	.hd-empty-sub {
		margin: 0;
		font-size: 0.82rem;
		line-height: 1.5;
		color: #777;
	}

	.hd-pills {
		display: inline-flex;
	}

	.hd-empty,
	.hd-widget-card {
		background: var(--card-bg-subtle, #141414);
		border-radius: var(--card-radius, 16px);
	}

	.hd-widget-card {
		padding: 16px 12px;
	}

	.hd-empty {
		padding: 28px 20px;
		text-align: center;
		color: #aaa;
	}

	.hd-widget-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
		gap: 12px;
		justify-items: center;
		padding: 4px 0 8px;
	}

	.hd-widget-skeleton {
		width: 90px;
		height: 106px;
		border-radius: 14px;
		background: linear-gradient(120deg, #1c1c1c 0%, #232323 50%, #1c1c1c 100%);
		background-size: 200% 100%;
		animation: hd-skeleton-shimmer 1.4s ease-in-out infinite;
	}

	@keyframes hd-skeleton-shimmer {
		0% { background-position: 200% 0; }
		100% { background-position: -200% 0; }
	}

	@media (max-width: 640px) {
		.hd-empty-sub {
			font-size: 0.84rem;
		}
	}

	.hd-sources-section {
		margin-top: 12px;
	}

	.hd-events-details {
		background: #141414;
		border-radius: 18px;
		margin-top: 12px;
		padding: 0;
	}

	.hd-events-summary {
		cursor: pointer;
		padding: 16px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		list-style: none;
		user-select: none;
	}

	.hd-events-summary::-webkit-details-marker {
		display: none;
	}

	.hd-events-summary::marker {
		display: none;
	}

	.hd-events-title {
		font-size: 0.88rem;
		font-weight: 700;
		color: #e7e7e7;
	}

	.hd-events-count {
		font-size: 0.74rem;
		color: #777;
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 12px;
		padding: 3px 10px;
	}

	.hd-events-content {
		padding: 0 16px 16px 16px;
	}
</style>
