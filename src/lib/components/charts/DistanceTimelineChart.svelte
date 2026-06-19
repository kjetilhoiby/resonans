<script lang="ts">
	/**
	 * Kronologisk søylegraf for kjørt distanse per klokketime.
	 * Viser kun timer med kjøring (datalaget returnerer kun ikke-tomme bøtter),
	 * i kronologisk rekkefølge, med dato-skille når dagen endrer seg.
	 */
	interface HourPoint {
		key: string; // ISO-time (UTC)
		km: number;
	}

	interface Props {
		data: HourPoint[];
		title?: string;
	}

	let { data, title = 'Kjørt per time' }: Props = $props();

	const maxKm = $derived(data.reduce((m, p) => Math.max(m, p.km), 0));
	const totalKm = $derived(Math.round(data.reduce((sum, p) => sum + p.km, 0) * 10) / 10);

	const hourFmt = new Intl.DateTimeFormat('nb-NO', {
		hour: '2-digit',
		minute: '2-digit',
		timeZone: 'Europe/Oslo'
	});
	const dayFmt = new Intl.DateTimeFormat('nb-NO', {
		weekday: 'short',
		day: '2-digit',
		month: '2-digit',
		timeZone: 'Europe/Oslo'
	});

	const bars = $derived(
		data.map((p, i) => {
			const date = new Date(p.key);
			const dayKey = dayFmt.format(date);
			const prevDayKey = i > 0 ? dayFmt.format(new Date(data[i - 1].key)) : null;
			return {
				km: p.km,
				hour: hourFmt.format(date),
				dayLabel: dayKey,
				newDay: dayKey !== prevDayKey,
				pct: maxKm > 0 ? (p.km / maxKm) * 100 : 0
			};
		})
	);
</script>

<div class="dist-chart">
	<div class="header">
		<span class="title">{title}</span>
		<span class="total">{totalKm} km totalt</span>
	</div>

	{#if bars.length === 0}
		<p class="empty">Ingen kjøring registrert ennå.</p>
	{:else}
		<div class="scroll" role="img" aria-label="Kjørt distanse per time">
			<div class="bars">
				{#each bars as bar}
					{#if bar.newDay}
						<div class="day-sep" aria-hidden="true">
							<span>{bar.dayLabel}</span>
						</div>
					{/if}
					<div class="col" title="{bar.dayLabel} {bar.hour} — {bar.km} km">
						<span class="val">{bar.km}</span>
						<div class="track">
							<div class="fill" style:height="{Math.max(bar.pct, 3)}%"></div>
						</div>
						<span class="hour">{bar.hour}</span>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>

<style>
	.dist-chart {
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
	.total {
		font-size: 0.72rem;
		color: #6f7cc7;
		font-variant-numeric: tabular-nums;
	}
	.empty {
		margin: 0;
		font-size: 0.78rem;
		color: #666;
	}
	.scroll {
		overflow-x: auto;
		padding-bottom: 4px;
	}
	.bars {
		display: flex;
		align-items: flex-end;
		gap: 6px;
		height: 140px;
		min-width: min-content;
	}
	.day-sep {
		align-self: stretch;
		display: flex;
		align-items: flex-end;
		padding: 0 2px 22px;
		border-left: 1px dashed #2c2c2c;
		margin-left: 2px;
	}
	.day-sep span {
		font-size: 0.6rem;
		color: #777;
		white-space: nowrap;
		writing-mode: vertical-rl;
		transform: rotate(180deg);
	}
	.col {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: flex-end;
		gap: 3px;
		width: 26px;
		height: 100%;
	}
	.val {
		font-size: 0.58rem;
		color: #9aa6e0;
		font-variant-numeric: tabular-nums;
	}
	.track {
		flex: 1;
		width: 12px;
		display: flex;
		align-items: flex-end;
		background: rgba(255, 255, 255, 0.04);
		border-radius: 3px;
		overflow: hidden;
	}
	.fill {
		width: 100%;
		background: linear-gradient(180deg, #7c8ef5, #5a6bc4);
		border-radius: 3px 3px 0 0;
	}
	.hour {
		font-size: 0.58rem;
		color: #888;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
</style>
