<!--
  TripHealthStats — Helsestatistikk for reise-tema.
  Viser vekt før/etter, skritt, treningsturer og søvn.
  Props:
    themeId – tema-UUID
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import SectionLabel from '$lib/components/ui/SectionLabel.svelte';
	import GpxMapSvg from '$lib/components/charts/GpxMapSvg.svelte';
	import {
		tripApi,
		type TripApi,
		type HealthData,
		type TrackPoint,
		type Workout
	} from './trip-api';

	interface Props {
		themeId: string;
		startDate?: string;
		endDate?: string;
		api?: TripApi;
	}

	let { themeId, startDate, endDate, api = tripApi }: Props = $props();

	let loading = $state(true);
	let error = $state('');
	let data = $state<HealthData | null>(null);
	let dismissedIds = $state(new Set<string>());
	let expandedIds = $state(new Set<string>());
	let trackCache = $state(new Map<string, TrackPoint[]>());
	let trackLoading = $state(new Set<string>());

	async function dismissWorkout(id: string) {
		dismissedIds = new Set([...dismissedIds, id]);
		await api.dismissWorkout(id);
	}

	async function toggleExpand(w: Workout) {
		if (expandedIds.has(w.id)) {
			expandedIds = new Set([...expandedIds].filter((x) => x !== w.id));
			return;
		}
		expandedIds = new Set([...expandedIds, w.id]);
		await loadTrack(w);
	}

	async function loadTrack(w: Workout) {
		if (!trackCache.has(w.id) && w.trackEventId) {
			trackLoading = new Set([...trackLoading, w.id]);
			try {
				const points = await api.getActivityTrack(w.trackEventId);
				if (points) {
					trackCache = new Map([...trackCache, [w.id, points]]);
				}
			} finally {
				trackLoading = new Set([...trackLoading].filter((x) => x !== w.id));
			}
		}
	}

	function fmtPace(secPerKm: number): string {
		const m = Math.floor(secPerKm / 60);
		const s = String(Math.round(secPerKm % 60)).padStart(2, '0');
		return `${m}:${s} /km`;
	}

	onMount(async () => {
		try {
			const result = await api.getHealthStats(themeId, startDate, endDate);
			if (!result) {
				error = 'Kunne ikke laste helsedata';
				return;
			}
			if (result.success && result.data) {
				data = result.data;
			} else {
				error = result.error || 'Ingen data tilgjengelig';
			}
		} catch (err) {
			error = 'Feil ved lasting av helsedata';
			console.error(err);
		} finally {
			loading = false;
		}
	});

	function fmtDate(iso: string): string {
		return new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short' }).format(new Date(iso));
	}

	function formatSportType(sport: string): string {
		const map: Record<string, string> = {
			'running': '🏃 Løping',
			'walking': '🚶 Gange',
			'cycling': '🚴 Sykling',
			'swimming': '🏊 Svømming',
			'hiking': '🥾 Fotturer',
			'strength_training': '💪 Styrketrening',
			'Unknown': '🏃 Trening'
		};
		return map[sport] || `🏃 ${sport}`;
	}

	let collapsed = $state(true);

	const summaryStats = $derived.by(() => {
		if (!data) return null;
		const parts: string[] = [];
		if (data.steps.avgPerDay) {
			parts.push(`${data.steps.avgPerDay.toLocaleString('nb-NO')} skritt/dag`);
		}
		const totalKm = data.workouts.list.reduce((s, w) => s + (w.distanceKm ?? 0), 0);
		if (totalKm > 0) {
			parts.push(`${Math.round(totalKm * 10) / 10} km trent`);
		}
		if (data.sleep.avgPerDay) {
			parts.push(`${data.sleep.avgPerDay}t søvn/natt`);
		}
		return parts.length > 0 ? parts.join(' · ') : null;
	});
</script>

<div class="ths-container">
	<button class="ths-collapse-btn" onclick={() => collapsed = !collapsed} aria-expanded={!collapsed}>
		<div class="ths-collapse-left">
			<SectionLabel tag="span">🏃 Aktivitet</SectionLabel>
			{#if collapsed && summaryStats}
				<span class="ths-summary-line">{summaryStats}</span>
			{/if}
		</div>
		<span class="ths-chevron" class:ths-chevron-open={!collapsed}>›</span>
	</button>

	{#if !collapsed}
	{#if loading}
		<p class="ths-loading">Laster helsedata...</p>
	{:else if error}
		<p class="ths-error">{error}</p>
	{:else if data}
		<!-- Weight Section -->
		{#if data.weight.avgBefore7Days || data.weight.avgAfter7Days}
			<div class="ths-section">
				<SectionLabel tag="h4">⚖️ Vekt</SectionLabel>
				<div class="ths-stat-grid">
					{#if data.weight.avgBefore7Days}
						<div class="ths-stat">
							<div class="ths-stat-label">Snittvekt 7 dager før</div>
							<div class="ths-stat-value">{data.weight.avgBefore7Days} kg</div>
							<div class="ths-stat-meta">{data.weight.measurementsBefore} målinger</div>
						</div>
					{/if}
					{#if data.weight.avgAfter7Days}
						<div class="ths-stat">
							<div class="ths-stat-label">Snittvekt 7 dager etter</div>
							<div class="ths-stat-value">{data.weight.avgAfter7Days} kg</div>
							<div class="ths-stat-meta">{data.weight.measurementsAfter} målinger</div>
						</div>
					{/if}
					{#if data.weight.change !== null}
						<div class="ths-stat">
							<div class="ths-stat-label">Endring</div>
							<div class="ths-stat-value" class:positive={data.weight.change < 0} class:negative={data.weight.change > 0}>
								{data.weight.change > 0 ? '+' : ''}{data.weight.change} kg
							</div>
						</div>
					{/if}
				</div>
			</div>
		{/if}

		<!-- Steps Section -->
		{#if data.steps.avgPerDay}
			<div class="ths-section">
				<SectionLabel tag="h4">👟 Skritt</SectionLabel>
				<div class="ths-stat">
					<div class="ths-stat-label">Gjennomsnitt per dag</div>
					<div class="ths-stat-value">{data.steps.avgPerDay.toLocaleString('nb-NO')} skritt</div>
					<div class="ths-stat-meta">{data.steps.daysWithData} dager med data</div>
				</div>
				{#if data.steps.dailySteps.length > 0}
					<div class="ths-daily-list">
						{#each data.steps.dailySteps as day}
							<div class="ths-daily-item">
								<span class="ths-daily-date">{fmtDate(day.date)}</span>
								<span class="ths-daily-value">{day.steps.toLocaleString('nb-NO')} skritt</span>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}

		<!-- Workouts Section -->
		{#if data.workouts.count > 0}
			<div class="ths-section">
				<SectionLabel tag="h4">🏃 Treningsturer</SectionLabel>
				<div class="ths-stat">
					<div class="ths-stat-label">Antall økter</div>
					<div class="ths-stat-value">{data.workouts.count}</div>
				</div>
				<div class="ths-workout-list">
					{#each data.workouts.list.filter(w => !dismissedIds.has(w.id)) as workout}
						{@const isExpanded = expandedIds.has(workout.id)}
						<div class="ths-workout-item" class:expanded={isExpanded}>
							<!-- Kompakt: alltid synlig -->
							<div class="ths-workout-row">
								<button class="ths-workout-toggle" onclick={() => toggleExpand(workout)} aria-expanded={isExpanded}>
									<div class="ths-workout-type">{formatSportType(workout.sportType)}</div>
									<span class="ths-workout-date">{fmtDate(workout.timestamp)}</span>
									<span class="ths-chevron" class:ths-chevron-open={isExpanded}>›</span>
								</button>
								<button class="ths-dismiss-btn" onclick={() => dismissWorkout(workout.id)} title="Skjul denne økten">×</button>
							</div>

							<!-- Utvidet: detaljer -->
							{#if isExpanded}
								<div class="ths-workout-details-panel">
									<div class="ths-workout-details">
										{#if workout.distanceKm}
											<span class="ths-workout-stat">{workout.distanceKm} km</span>
										{/if}
										{#if workout.durationMin}
											<span class="ths-workout-stat">{workout.durationMin} min</span>
										{/if}
										{#if workout.paceSecPerKm}
											<span class="ths-workout-stat">{fmtPace(workout.paceSecPerKm)}</span>
										{/if}
										{#if workout.elevationMeters}
											<span class="ths-workout-stat">↑{workout.elevationMeters} m</span>
										{/if}
									</div>
									{#if workout.avgHeartRate || workout.maxHeartRate}
										<div class="ths-hr-row">
											{#if workout.avgHeartRate}
												<span class="ths-hr-badge">♥ {workout.avgHeartRate} bpm snitt</span>
											{/if}
											{#if workout.maxHeartRate}
												<span class="ths-hr-badge max">♥ {workout.maxHeartRate} maks</span>
											{/if}
										</div>
									{/if}
									{#if workout.hasTrackPoints}
										<div class="ths-mini-map">
											{#if trackLoading.has(workout.id)}
												<div class="ths-map-placeholder">Laster kart...</div>
											{:else if (trackCache.get(workout.id) ?? []).length >= 2}
												<GpxMapSvg points={trackCache.get(workout.id)!} width={320} height={180} />
												{#if (trackCache.get(workout.id) ?? []).some(p => p.hr)}
													{@const pts = trackCache.get(workout.id)!}
													{@const hrPts = pts.filter(p => p.hr != null)}
													{@const minHr = Math.min(...hrPts.map(p => p.hr!))}
													{@const maxHr = Math.max(...hrPts.map(p => p.hr!))}
													{@const W = 320}
													{@const H = 48}
													{@const poly = hrPts.map((p, i) => `${(i / (hrPts.length - 1)) * W},${H - ((p.hr! - minHr) / (maxHr - minHr || 1)) * (H - 6)}`).join(' ')}
													<div class="ths-hr-chart">
														<svg viewBox="0 0 {W} {H}" width="100%" height="{H}" aria-hidden="true">
															<polyline points={poly} fill="none" stroke="#ef4444" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
														</svg>
														<div class="ths-hr-labels">
															<span>{minHr}</span><span>{maxHr} bpm</span>
														</div>
													</div>
												{/if}
											{:else}
												<div class="ths-map-placeholder">Ingen kartdata</div>
											{/if}
										</div>
									{/if}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Sleep Section -->
		{#if data.sleep.avgPerDay}
			<div class="ths-section">
				<SectionLabel tag="h4">😴 Søvn</SectionLabel>
				<div class="ths-stat">
					<div class="ths-stat-label">Gjennomsnitt per natt</div>
					<div class="ths-stat-value">{data.sleep.avgPerDay} timer</div>
					<div class="ths-stat-meta">{data.sleep.daysWithData} netter med data</div>
				</div>
				{#if data.sleep.dailySleep.length > 0}
					<div class="ths-daily-list">
						{#each data.sleep.dailySleep as day}
							<div class="ths-daily-item">
								<span class="ths-daily-date">{fmtDate(day.date)}</span>
								<span class="ths-daily-value">{day.hours} timer</span>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}

		{#if !data.weight.avgBefore7Days && !data.steps.avgPerDay && !data.workouts.count && !data.sleep.avgPerDay}
			<p class="ths-empty">Ingen helsedata tilgjengelig for denne turperioden.</p>
		{/if}
	{/if}
	{/if}
</div>

<style>
	.ths-container {
		display: flex;
		flex-direction: column;
		gap: 0;
	}

	.ths-loading,
	.ths-error,
	.ths-empty {
		color: var(--trip-text-secondary, #94a3b8);
		font-size: 0.875rem;
		padding: 8px 0;
	}

	.ths-error {
		color: var(--trip-danger, #f87171);
	}

	.ths-section {
		margin-bottom: 20px;
		padding-bottom: 20px;
		border-bottom: 1px solid var(--trip-card-border, #1a1f2e);
	}

	.ths-section:last-child {
		margin-bottom: 0;
		padding-bottom: 0;
		border-bottom: none;
	}

	.ths-section :global(.section-label) {
		margin-bottom: 12px;
	}

	.ths-stat-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 12px;
	}

	.ths-stat {
		background: var(--trip-card-bg, #0f1419);
		border: 1px solid var(--trip-card-border, #1a1f2e);
		border-radius: 8px;
		padding: 12px;
	}

	.ths-stat-label {
		font-size: 0.75rem;
		color: var(--trip-text-secondary, #94a3b8);
		margin-bottom: 4px;
	}

	.ths-stat-value {
		font-size: 1.3rem;
		font-weight: 700;
		color: var(--trip-text-emphasis, #e2e8f0);
		margin-bottom: 2px;
	}

	.ths-stat-value.positive {
		color: #34d399;
	}

	.ths-stat-value.negative {
		color: var(--trip-danger, #f87171);
	}

	.ths-stat-meta {
		font-size: 0.7rem;
		color: var(--trip-text-muted, #64748b);
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.ths-daily-list {
		margin-top: 12px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.ths-daily-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 6px 10px;
		background: var(--trip-card-bg, #0f1419);
		border: 1px solid var(--trip-card-border, #1a1f2e);
		border-radius: 6px;
		font-size: 0.8rem;
	}

	.ths-daily-date {
		color: var(--trip-text-secondary, #94a3b8);
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.ths-daily-value {
		color: var(--trip-text-strong, #cbd5e1);
		font-weight: 600;
	}

	.ths-workout-list {
		margin-top: 12px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.ths-workout-item {
		background: var(--trip-card-bg, #0f1419);
		border: 1px solid var(--trip-card-border, #1a1f2e);
		border-radius: 8px;
		overflow: hidden;
		transition: border-color 0.15s;
	}

	.ths-workout-item.expanded {
		border-color: var(--trip-border-strong, #2d3748);
	}

	.ths-workout-row {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 2px 6px 2px 0;
	}

	.ths-workout-toggle {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		padding: 8px 12px;
		background: none;
		border: none;
		cursor: pointer;
		color: inherit;
		text-align: left;
		transition: background 0.12s;
		border-radius: 6px;
	}

	.ths-workout-toggle:hover {
		background: rgba(255, 255, 255, 0.02);
	}

	.ths-chevron {
		font-size: 1.1rem;
		color: var(--trip-btn-border, #444);
		line-height: 1;
		transition: transform 0.2s ease;
		display: inline-block;
		margin-left: auto;
	}

	.ths-chevron-open {
		transform: rotate(90deg);
		color: #7c8ef5;
	}

	.ths-dismiss-btn {
		background: none;
		border: none;
		color: var(--trip-text-faint, #475569);
		cursor: pointer;
		font-size: 1.1rem;
		line-height: 1;
		padding: 0 2px;
		transition: color 0.15s;
	}

	.ths-dismiss-btn:hover {
		color: var(--trip-danger, #f87171);
	}

	.ths-workout-type {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--trip-text-strong, #cbd5e1);
	}

	.ths-workout-details-panel {
		padding: 0 12px 10px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.ths-workout-details {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		font-size: 0.75rem;
		color: var(--trip-text-secondary, #94a3b8);
	}

	.ths-workout-date {
		color: var(--trip-text-muted, #64748b);
		font-size: 0.75rem;
	}

	.ths-workout-stat {
		color: var(--trip-text-secondary, #94a3b8);
		font-weight: 500;
	}

	.ths-hr-row {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
		margin-bottom: 6px;
	}

	.ths-hr-badge {
		background: var(--trip-card-border, #1a1f2e);
		border: 1px solid var(--trip-border-strong, #2d3748);
		border-radius: 99px;
		color: var(--trip-danger, #f87171);
		font-size: 0.7rem;
		font-weight: 600;
		padding: 2px 8px;
	}

	.ths-hr-badge.max {
		color: #fca5a5;
		background: #1c1217;
		border-color: #4a2020;
	}

	.ths-mini-map {
		margin-top: 8px;
		border-radius: 6px;
		overflow: hidden;
		border: 1px solid var(--trip-card-border, #1a1f2e);
	}

	.ths-map-placeholder {
		height: 60px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--trip-text-faint, #475569);
		font-size: 0.75rem;
	}

	.ths-hr-chart {
		background: #090d12;
		padding: 6px 8px 2px;
	}

	.ths-hr-labels {
		display: flex;
		justify-content: space-between;
		font-size: 0.65rem;
		color: var(--trip-text-muted, #64748b);
		padding: 0 2px;
	}

	.ths-collapse-btn {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		background: none;
		border: none;
		padding: 2px 0 10px;
		cursor: pointer;
		text-align: left;
		gap: 8px;
	}

	.ths-collapse-left {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.ths-summary-line {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--trip-text-emphasis, #e2e8f0);
	}

	.ths-chevron {
		font-size: 1rem;
		color: var(--trip-text-muted, #64748b);
		transition: transform 0.2s;
		line-height: 1;
		flex-shrink: 0;
		transform: rotate(0deg);
	}

	.ths-chevron.ths-chevron-open {
		transform: rotate(90deg);
	}
</style>
