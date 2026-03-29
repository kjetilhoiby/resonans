<script lang="ts">
	import GoalRing from './GoalRing.svelte';

	type Period = 'week' | 'month' | 'year';

	interface PeriodMetrics {
		weight?: { avg?: number; min?: number; max?: number; change?: number };
		steps?: { sum?: number; avg?: number; max?: number };
		sleep?: { avg?: number; min?: number; max?: number };
		workouts?: { count?: number; totalDuration?: number; types?: Record<string, number> };
		intenseMinutes?: { sum?: number; avg?: number };
	}

	interface AggregatePeriod {
		period: string;
		periodKey: string;
		eventCount: number;
		metrics?: PeriodMetrics | null;
	}

	interface Props {
		weekly: AggregatePeriod[];
		monthly: AggregatePeriod[];
		yearly: AggregatePeriod[];
		embedded?: boolean;
	}

	let { weekly, monthly, yearly, embedded = false }: Props = $props();

	let selectedPeriod = $state<Period>('week');

	const periodData = $derived(
		selectedPeriod === 'week' ? weekly : selectedPeriod === 'month' ? monthly : yearly
	);
	const lastPeriod = $derived(periodData.length ? periodData[periodData.length - 1] : null);
	const lastMetrics = $derived(lastPeriod?.metrics ?? null);

	function formatPeriodKey(key: string, period: string): string {
		if (period === 'week') {
			const [year, week] = key.split('W');
			return `Uke ${week}, ${year}`;
		}
		if (period === 'month') {
			const [year, month] = key.split('M');
			const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Des'];
			return `${monthNames[parseInt(month) - 1] ?? month} ${year}`;
		}
		return key;
	}

	function formatMetric(value: number | undefined, decimals = 1): string {
		if (value === undefined || value === null) return '–';
		return value.toFixed(decimals);
	}

	function collectSeries(getValue: (period: AggregatePeriod) => number | undefined) {
		return periodData
			.map(getValue)
			.filter((value): value is number => value !== undefined && value !== null);
	}

	function scalePct(current: number | undefined, values: number[]) {
		if (current === undefined || values.length === 0) return 50;
		const min = Math.min(...values);
		const max = Math.max(...values);
		if (min === max) return 50;
		return Math.round(((current - min) / (max - min)) * 100);
	}

	const weightAvg = $derived(lastMetrics?.weight?.avg);
	const sleepAvg = $derived(lastMetrics?.sleep?.avg);
	const activeMinutes = $derived(lastMetrics?.intenseMinutes?.sum);
	const runningCount = $derived(lastMetrics?.workouts?.types?.running ?? 0);

	const metricCards = $derived([
		{
			label: 'Vekt',
			value: weightAvg !== undefined ? `${formatMetric(weightAvg)} kg` : '–',
			subvalue:
				lastMetrics?.weight?.change != null
					? `${lastMetrics.weight.change > 0 ? '+' : ''}${formatMetric(lastMetrics.weight.change, 2)} kg`
					: 'Ingen endring enda',
			color: '#e07070',
			pct: scalePct(weightAvg, collectSeries((period) => period.metrics?.weight?.avg))
		},
		{
			label: 'Løp',
			value: `${runningCount}`,
			subvalue: 'økter i perioden',
			color: '#7c8ef5',
			pct: scalePct(runningCount, collectSeries((period) => period.metrics?.workouts?.types?.running))
		},
		{
			label: 'Aktive min',
			value: activeMinutes !== undefined ? formatMetric(activeMinutes, 0) : '–',
			subvalue: 'intense minutter',
			color: '#f0b429',
			pct: scalePct(activeMinutes, collectSeries((period) => period.metrics?.intenseMinutes?.sum))
		},
		{
			label: 'Søvn',
			value: sleepAvg !== undefined ? `${formatMetric(sleepAvg)} t` : '–',
			subvalue: 'snitt per natt',
			color: '#5fa0a0',
			pct: scalePct(sleepAvg, collectSeries((period) => period.metrics?.sleep?.avg))
		}
	]);
</script>

<div class:hd-embedded={embedded} class="health-dashboard">
	{#if !embedded}
		<div class="hd-header">
			<h1 class="hd-title">Helse</h1>
			<p class="hd-copy">Vekt, løp, aktive minutter og søvn samlet i ett bilde.</p>
		</div>
	{/if}

	<div class="hd-pills" role="tablist" aria-label="Helseperioder">
		{#each ([
			{ id: 'week', label: 'Ukentlig' },
			{ id: 'month', label: 'Månedlig' },
			{ id: 'year', label: 'Årlig' }
		] as const) as option}
			<button
				class="hd-pill"
				class:is-active={selectedPeriod === option.id}
				onclick={() => (selectedPeriod = option.id)}
				role="tab"
				aria-selected={selectedPeriod === option.id}
			>
				{option.label}
			</button>
		{/each}
	</div>

	{#if periodData.length === 0}
		<div class="hd-empty">
			<p>Ingen data tilgjengelig ennå.</p>
			<p class="hd-empty-sub">Koble til eller synkroniser Withings for å fylle Helse-dashbordet.</p>
		</div>
	{:else}
		<div class="hd-grid">
			{#each metricCards as card}
				<div class="hd-card">
					<div class="hd-card-ring">
						<GoalRing pct={card.pct} color={card.color} size={88} strokeWidth={6}>
							{#snippet children()}
								<text x="44" y="42" text-anchor="middle" fill={card.color} font-size="15" font-weight="700">{card.value}</text>
							{/snippet}
						</GoalRing>
					</div>
					<div class="hd-card-copy">
						<p class="hd-card-label">{card.label}</p>
						<p class="hd-card-sub">{card.subvalue}</p>
					</div>
				</div>
			{/each}
		</div>

		<div class="hd-table-card">
			<div class="hd-table-head">
				<h2 class="hd-table-title">Perioder</h2>
				<p class="hd-table-copy">Ingen nye grafer her ennå. Sammenligningsgraf legges i design før den brukes i appen.</p>
			</div>
			<div class="hd-table-wrap">
				<table class="hd-table">
					<thead>
						<tr>
							<th>Periode</th>
							<th>Vekt</th>
							<th>Løp</th>
							<th>Aktive min</th>
							<th>Søvn</th>
							<th>Events</th>
						</tr>
					</thead>
					<tbody>
						{#each periodData as period}
							<tr>
								<td>{formatPeriodKey(period.periodKey, period.period)}</td>
								<td>{formatMetric(period.metrics?.weight?.avg)} kg</td>
								<td>{period.metrics?.workouts?.types?.running ?? 0}</td>
								<td>{formatMetric(period.metrics?.intenseMinutes?.sum, 0)}</td>
								<td>{formatMetric(period.metrics?.sleep?.avg)} t</td>
								<td>{period.eventCount}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
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
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}

	.hd-pill {
		background: #141414;
		border: 1px solid #262626;
		border-radius: 999px;
		color: #777;
		font: inherit;
		font-size: 0.78rem;
		padding: 8px 12px;
		cursor: pointer;
	}

	.hd-pill.is-active {
		background: #1a1f31;
		border-color: #3c4f9f;
		color: #d4daf6;
	}

	.hd-empty,
	.hd-table-card,
	.hd-card {
		background: #141414;
		border: 1px solid #232323;
		border-radius: 18px;
	}

	.hd-empty {
		padding: 28px 20px;
		text-align: center;
		color: #aaa;
	}

	.hd-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: 12px;
	}

	.hd-card {
		padding: 14px 12px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		text-align: center;
	}

	.hd-card-copy {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.hd-card-label,
	.hd-table-title {
		margin: 0;
		font-size: 0.88rem;
		font-weight: 700;
		color: #e7e7e7;
	}

	.hd-card-sub {
		margin: 0;
		font-size: 0.74rem;
		color: #777;
	}

	.hd-table-card {
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.hd-table-head {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.hd-table-wrap {
		overflow-x: auto;
	}

	.hd-table {
		width: 100%;
		border-collapse: collapse;
		min-width: 620px;
	}

	.hd-table th,
	.hd-table td {
		text-align: left;
		padding: 12px 10px;
		border-top: 1px solid #202020;
		font-size: 0.8rem;
	}

	.hd-table th {
		border-top: none;
		color: #666;
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.hd-table td {
		color: #ccc;
	}

	@media (max-width: 640px) {
		.hd-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>