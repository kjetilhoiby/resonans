<script lang="ts">
	import { onMount } from 'svelte';
	import CompactRecordList from '../ui/CompactRecordList.svelte';
	import SectionLabel from '../ui/SectionLabel.svelte';
	import PeriodPills from '../ui/PeriodPills.svelte';
	import DynamicWidget from '../composed/DynamicWidget.svelte';
	import HealthActivityList from './health/HealthActivityList.svelte';
	import HealthEffortSection from './health/HealthEffortSection.svelte';
	import HealthMetricGrid from './health/HealthMetricGrid.svelte';
	import HealthScreenTime from './health/HealthScreenTime.svelte';
	import HealthProgramCard from './health/HealthProgramCard.svelte';
	import HealthGoalsSection from './health/HealthGoalsSection.svelte';
	import {
		type WindowMode,
		type AggregatePeriod,
		type Goal,
		type WorkoutActivity,
		type MetricSettingsMap,
		type ThemeWidget,
		type ProgramSummary,
		type TodaySession,
		type RecentEvent,
		type SourceItem,
		buildQuarterData,
		computeEffortPeriodRange,
		aggregateEffortForPeriod,
		buildRunningTrackSet,
		buildWeightTrackSet,
		toWidgetWindow,
		computeSleepHoursAvg,
		computeAvgStepsPerDay,
		computeAvgActiveMinutesPerDay,
		computeWeightDelta,
		evaluateWeightProgress,
		buildMetricCards,
		formatEvent,
		formatDate,
		describeWindow,
		windowStart,
		daysInWindow,
		runningColorFromRatio,
		selectGoalTrackForWidget,
		evaluateProgress,
		projectTrackTargetForWindow,
		computeTrainingLoad,
		type GoalTrack,
	} from './health/health-data';

	interface Props {
		weekly: AggregatePeriod[];
		monthly: AggregatePeriod[];
		yearly: AggregatePeriod[];
		dailyEffort?: Array<{ date: string; effort: number }>;
		sources?: SourceItem[];
		recentEvents?: RecentEvent[];
		tooling?: {
			querySensorDataTool: boolean;
			tables: { sensorEvents: string; sensorAggregates: string };
			weightEventCount: number;
			weightAggregateCount: number;
			healthSensorsCount: number;
		};
		embedded?: boolean;
		goals?: Goal[];
		activities?: WorkoutActivity[];
		metricSettings?: MetricSettingsMap;
		themeId?: string;
	}

	let {
		weekly,
		monthly,
		yearly,
		dailyEffort = [],
		sources = [],
		recentEvents = [],
		tooling,
		embedded = false,
		goals = [],
		activities = [],
		metricSettings = {},
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
	let runningGoalWeekInput = $state('20');
	let runningGoalQuarterInput = $state('150');
	let runningGoalYearInput = $state('1000');
	let weightGoalShortInput = $state('-3');
	let weightGoalLongInput = $state('-20');
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
	const lastPeriod = $derived(periodData.length ? periodData[periodData.length - 1] : null);
	const lastMetrics = $derived(lastPeriod?.metrics ?? null);

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

	// ── Window-filtered events & metrics ──────────────────
	const windowStartDate = $derived(windowStart(selectedWindow));
	const filteredEvents = $derived(
		recentEvents.filter((event) => new Date(event.timestamp) >= windowStartDate)
	);
	const selectedDays = $derived(daysInWindow(selectedWindow));
	const windowCopy = $derived(describeWindow(selectedWindow));

	// ── Running metrics ───────────────────────────────────
	// Bruk det deduplikerte kanoniske aktivitetslaget (activities), ikke rå
	// sensor_events. Rå events double-teller samme tur på tvers av kilder
	// (Strava + Withings + manuell logg) og gir kunstig høye «løpt»-tall.
	// activities ekskluderer også skjulte (dismissed) økter.
	const runningKm = $derived(
		activities
			.filter((a) => new Date(a.startTime) >= windowStartDate)
			.filter((a) => (a.sportType ?? '').toLowerCase().includes('run'))
			.reduce((sum, a) => sum + ((a.distanceMeters ?? 0) / 1000), 0)
	);
	const runningTrackSet = $derived(buildRunningTrackSet(runningGoalWeekInput, runningGoalQuarterInput, runningGoalYearInput));
	const runningWidgetWindow = $derived(toWidgetWindow(selectedWindow));
	const runningTrackMatch = $derived(selectGoalTrackForWidget(runningTrackSet, 'running_distance', runningWidgetWindow));
	const runningProgress = $derived(
		runningTrackMatch
			? evaluateProgress(runningKm, runningTrackMatch.track, runningWidgetWindow)
			: { ratio: 0, pct: 0, projectedTarget: 0 }
	);
	const runningTargetForWindow = $derived(runningProgress.projectedTarget);
	const runningPct = $derived(runningProgress.pct);
	const runningRingColor = $derived(runningColorFromRatio(runningProgress.ratio));

	// ── Weight metrics ────────────────────────────────────
	const weightTrackSet = $derived(buildWeightTrackSet(weightGoalShortInput, weightGoalLongInput));
	const weightTrackMatch = $derived(selectGoalTrackForWidget(weightTrackSet, 'weight_change', runningWidgetWindow));
	const weightProjectedTarget = $derived(
		weightTrackMatch ? projectTrackTargetForWindow(weightTrackMatch.track, runningWidgetWindow) : 0
	);
	const weightDelta = $derived(computeWeightDelta(selectedWindow, filteredEvents, lastMetrics));
	const weightProgressRatio = $derived(evaluateWeightProgress(weightDelta, weightProjectedTarget));
	const weightProgressPct = $derived(Math.max(0, Math.min(100, Math.round(weightProgressRatio * 100))));
	const weightProgressColor = $derived(
		weightProgressRatio >= 1 ? '#82c882' : weightProgressRatio >= 0.7 ? '#f0b429' : '#e07070'
	);

	// ── Sleep / steps / active minutes ────────────────────
	const sleepHoursAvg = $derived(computeSleepHoursAvg(selectedWindow, filteredEvents, lastMetrics));
	const sleepLagComposite = $derived((() => {
		const lag = typeof lastMetrics?.sleepLag === 'number' ? lastMetrics.sleepLag : null;
		const early = typeof lastMetrics?.earlyWake === 'number' ? lastMetrics.earlyWake : null;
		if (lag != null && early != null) return lag + early;
		if (lag != null) return lag;
		if (early != null) return early;
		return undefined;
	})());
	const avgStepsPerDay = $derived(computeAvgStepsPerDay(selectedWindow, filteredEvents, lastMetrics, selectedDays));

	const stepsComparisonPoints = $derived.by(() => {
		const points = periodData
			.map((period, index) => {
				const current = period.metrics?.steps?.avg;
				if (typeof current !== 'number') return null;
				const label = period.periodKey || String(index + 1);
				return { label, current };
			})
			.filter((point): point is { label: string; current: number } => point != null)
			.slice(-8);
		if (points.length === 0) return [];
		const reference = points.reduce((sum, point) => sum + point.current, 0) / points.length;
		return points.map((point) => ({ label: point.label, current: point.current, reference }));
	});
	const stepsReferenceAvg = $derived.by(() => {
		if (stepsComparisonPoints.length === 0) return undefined;
		return stepsComparisonPoints.reduce((sum, point) => sum + point.reference, 0) / stepsComparisonPoints.length;
	});

	const avgActiveMinutesPerDay = $derived(
		computeAvgActiveMinutesPerDay(selectedWindow, filteredEvents, lastMetrics, selectedDays)
	);

	// ── Metric settings ───────────────────────────────────
	const sleepGoal = $derived(metricSettings.sleep?.goal ?? 7.5);
	const sleepLagMax = $derived(metricSettings.sleepLag?.goal ?? 8);
	const stepsGoal = $derived(metricSettings.steps?.goal ?? 8000);
	const activeMinutesGoal = $derived(metricSettings.activeMinutes?.goal ?? 30);

	// ── Metric cards ──────────────────────────────────────
	const metricCards = $derived(buildMetricCards({
		runningKm, runningTrackMatch, runningTargetForWindow, runningPct, runningRingColor,
		sleepHoursAvg, sleepGoal, sleepLagComposite, sleepLagMax,
		avgStepsPerDay, stepsGoal, stepsReferenceAvg, stepsComparisonPoints,
		avgActiveMinutesPerDay, activeMinutesGoal,
		weightDelta, weightTrackMatch, weightProgressColor, weightProgressPct, weightProjectedTarget,
		windowCopy
	}));

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
		void loadGoalTracks();
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

	async function loadGoalTracks() {
		try {
			const [runningRes, weightRes] = await Promise.all([
				fetch('/api/goal-tracks/running_distance'),
				fetch('/api/goal-tracks/weight_change')
			]);
			if (runningRes.ok) {
				const json = (await runningRes.json()) as { tracks?: GoalTrack[] };
				const tracks = json.tracks ?? [];
				const wk = tracks.find((t) => t.id === 'run-week');
				const qt = tracks.find((t) => t.id === 'run-quarter');
				const yr = tracks.find((t) => t.id === 'run-year');
				if (wk?.targetValue) runningGoalWeekInput = String(wk.targetValue);
				if (qt?.targetValue) runningGoalQuarterInput = String(qt.targetValue);
				if (yr?.targetValue) runningGoalYearInput = String(yr.targetValue);
			}
			if (weightRes.ok) {
				const json = (await weightRes.json()) as { tracks?: GoalTrack[] };
				const tracks = json.tracks ?? [];
				const sh = tracks.find((t) => t.id === 'weight-short');
				const lo = tracks.find((t) => t.id === 'weight-long');
				if (sh?.targetValue) weightGoalShortInput = String(sh.targetValue);
				if (lo?.targetValue) weightGoalLongInput = String(lo.targetValue);
			}
		} catch { /* stille feil, defaults brukes */ }
	}
</script>

<div class:hd-embedded={embedded} class="health-dashboard">
	{#if !embedded}
		<div class="hd-header">
			<h1 class="hd-title">Helse</h1>
			<p class="hd-copy">Vekt, løp, aktive minutter og søvn samlet i ett bilde.</p>
		</div>
	{/if}

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

	{#if tooling}
		<div class="hd-tooling-card">
			<div class="hd-table-head">
				<SectionLabel tag="h2">Datatilgang og tool-sjekk</SectionLabel>
				<p class="hd-table-copy">
					query_sensor_data: {tooling.querySensorDataTool ? 'aktiv' : 'mangler'} · {tooling.tables.sensorEvents}: {tooling.weightEventCount} vektmålinger · {tooling.tables.sensorAggregates}: {tooling.weightAggregateCount} perioder med vekt
				</p>
			</div>
		</div>
	{/if}

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

		<HealthGoalsSection {goals} {recentEvents} />

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

	.hd-header {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.hd-title {
		margin: 0;
		font-size: 1.5rem;
		font-weight: 700;
		letter-spacing: -0.03em;
		color: #eee;
	}

	.hd-copy,
	.hd-table-copy,
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
	.hd-widget-card,
	.hd-tooling-card {
		background: var(--card-bg-subtle, #141414);
		border-radius: var(--card-radius, 16px);
	}

	.hd-widget-card {
		padding: 16px 12px;
	}

	.hd-tooling-card {
		padding: 14px 16px;
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

	.hd-table-head {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	@media (max-width: 640px) {
		.hd-title {
			font-size: 1.32rem;
		}

		.hd-copy,
		.hd-table-copy,
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
