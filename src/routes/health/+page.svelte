<script lang="ts">
	import type { PageData } from './$types';
	
	let { data }: { data: PageData } = $props();
	
	let selectedPeriod = $state<'week' | 'month' | 'year'>('week');
	
	const periodData = $derived(
		selectedPeriod === 'week' ? data.weekly :
		selectedPeriod === 'month' ? data.monthly :
		data.yearly
	);
	
	// Format period key for display
	function formatPeriodKey(key: string, period: string): string {
		if (period === 'week') {
			const [year, week] = key.split('W');
			return `Uke ${week}, ${year}`;
		} else if (period === 'month') {
			const [year, month] = key.split('M');
			const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Des'];
			return `${monthNames[parseInt(month) - 1]} ${year}`;
		}
		return key;
	}
	
	// Format metric value
	function formatMetric(value: number | undefined, decimals = 1): string {
		if (value === undefined || value === null) return '-';
		return value.toFixed(decimals);
	}
</script>

<svelte:head>
	<title>Helse - Resonans</title>
</svelte:head>

<div class="container">
	<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem;">
		<h1>📊 Helse</h1>
		<div style="display: flex; gap: 0.5rem;">
			<button 
				class={selectedPeriod === 'week' ? 'primary-button' : 'secondary-button'}
				onclick={() => selectedPeriod = 'week'}
			>
				Ukentlig
			</button>
			<button 
				class={selectedPeriod === 'month' ? 'primary-button' : 'secondary-button'}
				onclick={() => selectedPeriod = 'month'}
			>
				Månedlig
			</button>
			<button 
				class={selectedPeriod === 'year' ? 'primary-button' : 'secondary-button'}
				onclick={() => selectedPeriod = 'year'}
			>
				Årlig
			</button>
		</div>
	</div>

	{#if periodData.length === 0}
		<div class="empty-state">
			<p>Ingen data tilgjengelig for denne perioden.</p>
			<p style="margin-top: 0.5rem; color: var(--text-secondary);">
				Gå til <a href="/settings">Innstillinger</a> for å synkronisere data fra Withings.
			</p>
		</div>
	{:else}
		<!-- Summary cards -->
		<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2rem;">
			{#if periodData[periodData.length - 1]?.metrics?.weight}
				<div class="stat-card">
					<div class="stat-label">Vekt (siste)</div>
					<div class="stat-value">
						{formatMetric(periodData[periodData.length - 1].metrics.weight.latest)} kg
					</div>
					{#if periodData[periodData.length - 1].metrics.weight.change}
						<div class="stat-change" class:positive={periodData[periodData.length - 1].metrics.weight.change < 0}>
							{periodData[periodData.length - 1].metrics.weight.change > 0 ? '+' : ''}{formatMetric(periodData[periodData.length - 1].metrics.weight.change, 2)} kg
						</div>
					{/if}
				</div>
			{/if}
			
			{#if periodData[periodData.length - 1]?.metrics?.steps}
				<div class="stat-card">
					<div class="stat-label">Skritt (snitt)</div>
					<div class="stat-value">
						{formatMetric(periodData[periodData.length - 1].metrics.steps.avg, 0)}
					</div>
				</div>
			{/if}
			
			{#if periodData[periodData.length - 1]?.metrics?.sleep}
				<div class="stat-card">
					<div class="stat-label">Søvn (snitt)</div>
					<div class="stat-value">
						{formatMetric(periodData[periodData.length - 1].metrics.sleep.avg)}t
					</div>
				</div>
			{/if}
			
			{#if periodData[periodData.length - 1]?.metrics?.intenseMinutes}
				<div class="stat-card">
					<div class="stat-label">Intense minutter</div>
					<div class="stat-value">
						{formatMetric(periodData[periodData.length - 1].metrics.intenseMinutes.sum, 0)}
					</div>
				</div>
			{/if}
		</div>

		<!-- Data table -->
		<div class="table-container">
			<table>
				<thead>
					<tr>
						<th>Periode</th>
						<th>Vekt (snitt)</th>
						<th>Vekt (endring)</th>
						<th>Skritt (snitt)</th>
						<th>Søvn (snitt)</th>
						<th>Intense min</th>
						<th>Events</th>
					</tr>
				</thead>
				<tbody>
					{#each periodData as period}
						<tr>
							<td style="font-weight: 500;">{formatPeriodKey(period.periodKey, period.period)}</td>
							<td>{formatMetric(period.metrics?.weight?.avg)} kg</td>
							<td class:positive={period.metrics?.weight?.change && period.metrics.weight.change < 0}>
								{#if period.metrics?.weight?.change}
									{period.metrics.weight.change > 0 ? '+' : ''}{formatMetric(period.metrics.weight.change, 2)} kg
								{:else}
									-
								{/if}
							</td>
							<td>{formatMetric(period.metrics?.steps?.avg, 0)}</td>
							<td>{formatMetric(period.metrics?.sleep?.avg)}t</td>
							<td>{formatMetric(period.metrics?.intenseMinutes?.sum, 0)}</td>
							<td style="color: var(--text-secondary); font-size: 0.9em;">{period.eventCount}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<style>
	.container {
		max-width: 1200px;
		margin: 0 auto;
		padding: 2rem;
	}

	h1 {
		margin: 0;
		font-size: 2rem;
	}

	.empty-state {
		text-align: center;
		padding: 4rem 2rem;
		color: var(--text-secondary);
	}

	.stat-card {
		background: var(--surface-color);
		border: 1px solid var(--border-color);
		border-radius: 12px;
		padding: 1.5rem;
	}

	.stat-label {
		font-size: 0.85rem;
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 0.5rem;
	}

	.stat-value {
		font-size: 2rem;
		font-weight: 600;
		color: var(--text-primary);
	}

	.stat-change {
		margin-top: 0.5rem;
		font-size: 0.9rem;
		color: var(--error-text);
	}

	.stat-change.positive {
		color: var(--success-text);
	}

	.table-container {
		background: var(--surface-color);
		border: 1px solid var(--border-color);
		border-radius: 12px;
		overflow: hidden;
	}

	table {
		width: 100%;
		border-collapse: collapse;
	}

	thead {
		background: var(--background-color);
		border-bottom: 1px solid var(--border-color);
	}

	th {
		text-align: left;
		padding: 1rem;
		font-size: 0.85rem;
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-weight: 600;
	}

	td {
		padding: 1rem;
		border-top: 1px solid var(--border-color);
	}

	tbody tr:hover {
		background: var(--background-color);
	}

	.positive {
		color: var(--success-text);
	}
</style>
