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
				class="btn-chip" 
				class:active={chartMode === 'comparison'}
				onclick={() => chartMode = 'comparison'}
			>
				2-års sammenligning
			</button>
			<button 
				class="btn-chip" 
				class:active={chartMode === 'historical'}
				onclick={() => chartMode = 'historical'}
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
		width: fit-content;
	}

	.charts {
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}
</style>
