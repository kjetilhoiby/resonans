<!--
  TripHealthStats — Helsestatistikk for reise-tema.
  Viser vekt før/etter, skritt, treningsturer og søvn.
  Props:
    themeId – tema-UUID
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '../ui/Icon.svelte';

	interface DailySteps {
		date: string;
		steps: number;
	}

	interface DailySleep {
		date: string;
		hours: number;
	}

	interface Workout {
		id: string;
		timestamp: string;
		date: string;
		sportType: string;
		distance: number | null;
		duration: number | null;
		category?: number;
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
					{#each data.workouts.list as workout}
						<div class="ths-workout-item">
							<div class="ths-workout-type">{formatSportType(workout.sportType)}</div>
							<div class="ths-workout-details">date
								<span class="ths-workout-date">{fmtDate(workout.timestamp)}</span>
								{#if workout.distance}
									<span class="ths-workout-stat">{workout.distance} km</span>
								{/if}
								{#if workout.duration}
									<span class="ths-workout-stat">{workout.duration} min</span>
								{/if}
							</div>
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
	}

	.ths-workout-type {
		font-size: 0.875rem;
		font-weight: 600;
		color: #cbd5e1;
		margin-bottom: 4px;
	}

	.ths-workout-details {
		display: flex;
		gap: 12px;
		font-size: 0.75rem;
		color: #94a3b8;
	}

	.ths-workout-date {
		color: #94a3b8;
	}

	.ths-workout-stat {
		color: #64748b;
		font-weight: 600;
	}
</style>
