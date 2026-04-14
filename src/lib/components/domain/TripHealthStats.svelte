<!--
  TripHealthStats — Helsestatistikk for reise-tema.
  Viser vekt før/etter, skritt, treningsturer og søvn.
  Props:
    themeId – tema-UUID
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import GpxMapSvg from '$lib/components/charts/GpxMapSvg.svelte';

	interface DailySteps {
		date: string;
		steps: number;
	}

	interface DailySleep {
		date: string;
		hours: number;
	}

	interface TrackPoint {
		lat: number;
		lon: number;
		ele?: number | null;
		hr?: number | null;
		time?: string | null;
	}

	interface Workout {
		id: string;
		timestamp: string;
		date: string;
		sportType: string;
		distanceKm: number | null;
		durationMin: number | null;
		avgHeartRate: number | null;
		maxHeartRate: number | null;
		paceSecPerKm: number | null;
		elevationMeters: number | null;
		hasTrackPoints: boolean;
		trackEventId: string | null;
		sources: string[];
		evidence: number;
	}

	interface HealthData {
		weight: {
			avgBefore7Days: number | null;
			avgAfter7Days: number | null;
			change: number | null;
			measurementsBefore: number;
			measurementsAfter: number;
		};
		steps: {
			avgPerDay: number | null;
			dailySteps: DailySteps[];
			daysWithData: number;
		};
		workouts: {
			count: number;
			list: Workout[];
		};
		sleep: {
			avgPerDay: number | null;
			dailySleep: DailySleep[];
			daysWithData: number;
		};
	}

	interface Props {
		themeId: string;
	}

	let { themeId }: Props = $props();

	let loading = $state(true);
	let error = $state('');
	let data = $state<HealthData | null>(null);
	let dismissedIds = $state(new Set<string>());
	let expandedIds = $state(new Set<string>());
	let trackCache = $state(new Map<string, TrackPoint[]>());
	let trackLoading = $state(new Set<string>());

	async function dismissWorkout(id: string) {
		dismissedIds = new Set([...dismissedIds, id]);
		await fetch(`/api/workouts/${id}/dismiss`, { method: 'POST' });
	}

	async function toggleExpand(w: Workout) {
		if (expandedIds.has(w.id)) {
			expandedIds = new Set([...expandedIds].filter((x) => x !== w.id));
			return;
		}
		expandedIds = new Set([...expandedIds, w.id]);
		if (!trackCache.has(w.id) && w.trackEventId) {
			trackLoading = new Set([...trackLoading, w.id]);
			try {
				const res = await fetch(`/api/activities/${w.trackEventId}/track`);
				if (res.ok) {
					const json = await res.json();
					trackCache = new Map([...trackCache, [w.id, json.trackPoints ?? []]]);
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
			const res = await fetch(`/api/tema/${themeId}/health-stats`);
			if (!res.ok) {
				error = 'Kunne ikke laste helsedata';
				return;
			}
			const result = await res.json();
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
</script>

<div class="ths-container">
	<h3 class="ths-title">🏥 Helsestatistikk</h3>

	{#if loading}
		<p class="ths-loading">Laster helsedata...</p>
	{:else if error}
		<p class="ths-error">{error}</p>
	{:else if data}
		<!-- Weight Section -->
		{#if data.weight.avgBefore7Days || data.weight.avgAfter7Days}
			<div class="ths-section">
				<h4 class="ths-section-title">⚖️ Vekt</h4>
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
				<h4 class="ths-section-title">👟 Skritt</h4>
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
				<h4 class="ths-section-title">🏃 Treningsturer</h4>
				<div class="ths-stat">
					<div class="ths-stat-label">Antall økter</div>
					<div class="ths-stat-value">{data.workouts.count}</div>
				</div>
				<div class="ths-workout-list">
					{#each data.workouts.list.filter(w => !dismissedIds.has(w.id)) as workout}
						<div class="ths-workout-item" class:expanded={expandedIds.has(workout.id)}>
							<!-- Header -->
							<div class="ths-workout-row">
								<div class="ths-workout-type">{formatSportType(workout.sportType)}</div>
								<div class="ths-workout-actions">
									{#if workout.hasTrackPoints}
										<button class="ths-map-btn" class:active={expandedIds.has(workout.id)} onclick={() => toggleExpand(workout)} title="Vis kart">
											<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3V7z"/><path d="M9 4v13M15 7v13"/></svg>
										</button>
									{/if}
									<button class="ths-dismiss-btn" onclick={() => dismissWorkout(workout.id)} title="Skjul denne økten">×</button>
								</div>
							</div>
							<!-- Stats row -->
							<div class="ths-workout-details">
								<span class="ths-workout-date">{fmtDate(workout.timestamp)}</span>
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
							<!-- HR badges -->
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
							<!-- Mini-map (ekspandert) -->
							{#if expandedIds.has(workout.id)}
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
					{/each}
				</div>
			</div>
		{/if}

		<!-- Sleep Section -->
		{#if data.sleep.avgPerDay}
			<div class="ths-section">
				<h4 class="ths-section-title">😴 Søvn</h4>
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
</div>

<style>
	.ths-container {
		background: #0a0e14;
		border: 1px solid #1a1f2e;
		border-radius: 12px;
		padding: 20px;
	}

	.ths-title {
		font-size: 1.1rem;
		font-weight: 700;
		color: #e2e8f0;
		margin: 0 0 16px 0;
	}

	.ths-loading,
	.ths-error,
	.ths-empty {
		color: #94a3b8;
		font-size: 0.875rem;
		padding: 8px 0;
	}

	.ths-error {
		color: #f87171;
	}

	.ths-section {
		margin-bottom: 20px;
		padding-bottom: 20px;
		border-bottom: 1px solid #1a1f2e;
	}

	.ths-section:last-child {
		margin-bottom: 0;
		padding-bottom: 0;
		border-bottom: none;
	}

	.ths-section-title {
		font-size: 0.95rem;
		font-weight: 600;
		color: #cbd5e1;
		margin: 0 0 12px 0;
	}

	.ths-stat-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 12px;
	}

	.ths-stat {
		background: #0f1419;
		border: 1px solid #1a1f2e;
		border-radius: 8px;
		padding: 12px;
	}

	.ths-stat-label {
		font-size: 0.75rem;
		color: #94a3b8;
		margin-bottom: 4px;
	}

	.ths-stat-value {
		font-size: 1.3rem;
		font-weight: 700;
		color: #e2e8f0;
		margin-bottom: 2px;
	}

	.ths-stat-value.positive {
		color: #34d399;
	}

	.ths-stat-value.negative {
		color: #f87171;
	}

	.ths-stat-meta {
		font-size: 0.7rem;
		color: #64748b;
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
		background: #0f1419;
		border: 1px solid #1a1f2e;
		border-radius: 6px;
		font-size: 0.8rem;
	}

	.ths-daily-date {
		color: #94a3b8;
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.ths-daily-value {
		color: #cbd5e1;
		font-weight: 600;
	}

	.ths-workout-list {
		margin-top: 12px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.ths-workout-item {
		background: #0f1419;
		border: 1px solid #1a1f2e;
		border-radius: 8px;
		padding: 10px 12px;
		transition: border-color 0.15s;
	}

	.ths-workout-item.expanded {
		border-color: #2d3748;
	}

	.ths-workout-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 4px;
	}

	.ths-workout-actions {
		display: flex;
		gap: 6px;
		align-items: center;
	}

	.ths-map-btn {
		background: none;
		border: 1px solid #2d3748;
		border-radius: 4px;
		color: #64748b;
		cursor: pointer;
		padding: 3px 5px;
		line-height: 0;
		transition: color 0.15s, border-color 0.15s;
	}

	.ths-map-btn:hover,
	.ths-map-btn.active {
		color: #60a5fa;
		border-color: #60a5fa;
	}

	.ths-dismiss-btn {
		background: none;
		border: none;
		color: #475569;
		cursor: pointer;
		font-size: 1.1rem;
		line-height: 1;
		padding: 0 2px;
		transition: color 0.15s;
	}

	.ths-dismiss-btn:hover {
		color: #f87171;
	}

	.ths-workout-type {
		font-size: 0.875rem;
		font-weight: 600;
		color: #cbd5e1;
	}

	.ths-workout-details {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		font-size: 0.75rem;
		color: #94a3b8;
		margin-bottom: 6px;
	}

	.ths-workout-date {
		color: #64748b;
	}

	.ths-workout-stat {
		color: #94a3b8;
		font-weight: 500;
	}

	.ths-hr-row {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
		margin-bottom: 6px;
	}

	.ths-hr-badge {
		background: #1a1f2e;
		border: 1px solid #2d3748;
		border-radius: 99px;
		color: #f87171;
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
		border: 1px solid #1a1f2e;
	}

	.ths-map-placeholder {
		height: 60px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #475569;
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
		color: #64748b;
		padding: 0 2px;
	}
</style>
