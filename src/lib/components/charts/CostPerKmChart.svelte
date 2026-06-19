<script lang="ts">
	/**
	 * Søylegraf for kost per km per måned.
	 * kr/km = (variable bilutgifter + faste bilkostnader) / kjørte km.
	 * Måneder uten kjøring (krPerKm = null) vises som tomme/gråe kolonner.
	 */
	interface CostPoint {
		month: string; // 'YYYY-MM'
		km: number;
		cost: number;
		krPerKm: number | null;
	}

	interface Props {
		data: CostPoint[];
		title?: string;
	}

	let { data, title = 'Kost per km' }: Props = $props();

	const maxRate = $derived(data.reduce((m, p) => Math.max(m, p.krPerKm ?? 0), 0));

	const monthFmt = new Intl.DateTimeFormat('nb-NO', {
		month: 'short',
		year: '2-digit',
		timeZone: 'Europe/Oslo'
	});

	function monthLabel(month: string): string {
		const [y, m] = month.split('-').map(Number);
		return monthFmt.format(new Date(Date.UTC(y, m - 1, 1)));
	}

	function fmtKr(n: number | null): string {
		if (n === null) return '—';
		return n.toLocaleString('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	}

	const bars = $derived(
		data.map((p) => ({
			label: monthLabel(p.month),
			krPerKm: p.krPerKm,
			km: p.km,
			cost: Math.round(p.cost),
			pct: p.krPerKm !== null && maxRate > 0 ? (p.krPerKm / maxRate) * 100 : 0
		}))
	);
</script>

<div class="cost-chart">
	<div class="header">
		<span class="title">{title}</span>
		<span class="unit">kr/km</span>
	</div>

	{#if bars.length === 0}
		<p class="empty">Trenger minst én måned med kjøring og bilutgifter.</p>
	{:else}
		<div class="bars" role="img" aria-label="Kost per kilometer per måned">
			{#each bars as bar}
				<div
					class="col"
					title="{bar.label}: {fmtKr(bar.krPerKm)} kr/km ({bar.km} km, {bar.cost.toLocaleString(
						'nb-NO'
					)} kr)"
				>
					<span class="val" class:muted={bar.krPerKm === null}>{fmtKr(bar.krPerKm)}</span>
					<div class="track">
						<div
							class="fill"
							class:empty-fill={bar.krPerKm === null}
							style:height="{bar.krPerKm === null ? 0 : Math.max(bar.pct, 3)}%"
						></div>
					</div>
					<span class="month">{bar.label}</span>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.cost-chart {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.title {
		font-size: 0.82rem;
		font-weight: 600;
		color: #ccc;
	}
	.unit {
		font-size: 0.72rem;
		color: #666;
	}
	.empty {
		margin: 0;
		font-size: 0.78rem;
		color: #666;
	}
	.bars {
		display: flex;
		align-items: flex-end;
		justify-content: space-around;
		gap: 8px;
		height: 150px;
	}
	.col {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: flex-end;
		gap: 4px;
		flex: 1;
		min-width: 0;
		height: 100%;
	}
	.val {
		font-size: 0.62rem;
		color: #e0b96a;
		font-variant-numeric: tabular-nums;
	}
	.val.muted {
		color: #555;
	}
	.track {
		flex: 1;
		width: 60%;
		max-width: 32px;
		display: flex;
		align-items: flex-end;
		background: rgba(255, 255, 255, 0.04);
		border-radius: 4px;
		overflow: hidden;
	}
	.fill {
		width: 100%;
		background: linear-gradient(180deg, #e0b96a, #b08c3e);
		border-radius: 4px 4px 0 0;
	}
	.fill.empty-fill {
		background: transparent;
	}
	.month {
		font-size: 0.62rem;
		color: #888;
		white-space: nowrap;
	}
</style>
