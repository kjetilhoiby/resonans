<script lang="ts">
	import RunningProgressLayerCake from '$lib/components/charts/RunningProgressLayerCake.svelte';
	import WeightProgressLayerCake from '$lib/components/charts/WeightProgressLayerCake.svelte';
	
	let chartMode: 'comparison' | 'historical' = 'comparison';
</script>

<div class="workouts-page">
	<h1>💪 Treningsøkter</h1>

	<div class="chart-controls">
		<div class="mode-toggle">
			<button 
				class="toggle-btn" 
				class:active={chartMode === 'comparison'}
				on:click={() => chartMode = 'comparison'}
			>
				2-års sammenligning
			</button>
			<button 
				class="toggle-btn" 
				class:active={chartMode === 'historical'}
				on:click={() => chartMode = 'historical'}
			>
				Historisk oversikt (5 år)
			</button>
		</div>
	</div>

	<div class="charts">
		<RunningProgressLayerCake mode={chartMode} />
		<WeightProgressLayerCake mode={chartMode} />
	</div>

	<!-- Future: Add more charts -->
	<!-- <CyclingProgress /> -->
	<!-- <WorkoutCalendar /> -->
	<!-- <PersonalRecords /> -->
</div>

<style>
	.workouts-page {
		max-width: 1200px;
		margin: 0 auto;
		padding: 2rem;
	}

	h1 {
		font-size: 2rem;
		font-weight: 700;
		margin-bottom: 2rem;
		color: var(--text-primary);
	}

	.chart-controls {
		margin-bottom: 2rem;
	}

	.mode-toggle {
		display: flex;
		gap: 0.5rem;
		background: #f3f4f6;
		padding: 0.25rem;
		border-radius: 0.5rem;
		width: fit-content;
	}

	.toggle-btn {
		padding: 0.75rem 1.5rem;
		border: none;
		border-radius: 0.25rem;
		background: transparent;
		color: #6b7280;
		font-weight: 500;
		font-size: 0.875rem;
		cursor: pointer;
		transition: all 0.2s;
	}

	.toggle-btn:hover {
		color: #374151;
	}

	.toggle-btn.active {
		background: white;
		color: #1f2937;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
	}

	.charts {
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}
</style>
