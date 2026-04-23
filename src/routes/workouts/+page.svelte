<script lang="ts">
	import { AppPage, PageHeader } from '$lib/components/ui';
	import RunningProgressLayerCake from '$lib/components/charts/RunningProgressLayerCake.svelte';
	import WeightProgressLayerCake from '$lib/components/charts/WeightProgressLayerCake.svelte';
	
	let chartMode: 'comparison' | 'historical' = 'comparison';
</script>

<AppPage width="full" padding="default" gap="lg" surface="default">
	<PageHeader title="Treningsøkter" subtitle="Progress over tid" backHref="/" />

	<div class="workouts-page">
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
</AppPage>

<style>
	.workouts-page {
		max-width: 1200px;
		margin: 0 auto;
		width: 100%;
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
