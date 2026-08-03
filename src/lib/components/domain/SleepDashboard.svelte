<!--
  SleepDashboard — Søvn-undertemaet av Helse.

  Søvn har aldri hatt en egen flate; tallene lå spredt som kolonner i
  helse-metrikkgriden. Her samles nattlengde, rytme (median leggetid/våkning),
  sleepLag og powernaps ett sted.

  Fra august 2026 eier flaten også manuell registrering: dagsøvn, «fikk ikke
  sove» og «våknet og fikk ikke sove igjen». Det er de tre tingene Withings ikke
  kan se — og de to siste er hendelser uten varighet, så de ligger på en egen
  dataType og telles ved siden av nattlengden, ikke inni den.

  All ren logikk bor i $lib/domain/health/sleep-overview,
  $lib/domain/sleep-goals og $lib/domain/sleep/disturbance, og er testet der.
-->
<script lang="ts">
	import SectionLabel from '../ui/SectionLabel.svelte';
	import CompactRecordList from '../ui/CompactRecordList.svelte';
	import SleepLogger from './sleep/SleepLogger.svelte';
	import SleepDisturbanceList from './sleep/SleepDisturbanceList.svelte';
	import type { SleepDashboardPayload } from '$lib/server/sleep-dashboard';

	interface Props {
		data: SleepDashboardPayload;
		/** Ber flaten hente dashboardet på nytt etter en registrering. */
		onRefresh?: () => void;
	}

	let { data, onRefresh }: Props = $props();

	const nights = $derived(data.nights.filter((n) => !n.isNap));
	const recentNights = $derived(nights.slice(-14));
	const maxHours = $derived(Math.max(8, ...recentNights.map((n) => n.hours)));

	const goalHours = $derived(
		(data.metricSettings as { sleep?: { goal?: number } } | undefined)?.sleep?.goal ?? 7.5
	);

	function fmtHours(value: number | null): string {
		if (value === null) return '–';
		return `${value.toFixed(1).replace('.', ',')} t`;
	}

	function weekdayLabel(iso: string): string {
		const d = new Date(iso);
		return new Intl.DateTimeFormat('nb-NO', { weekday: 'narrow' }).format(d);
	}

	const napItems = $derived(
		data.naps.map((nap) => ({
			id: nap.id,
			title: `${nap.durationMinutes} min`,
			subtitle: nap.manual ? 'Registrert manuelt' : 'Oppdaget automatisk',
			meta: new Intl.DateTimeFormat('nb-NO', {
				day: 'numeric',
				month: 'short',
				hour: '2-digit',
				minute: '2-digit'
			}).format(new Date(nap.start)),
			amount: nap.note ?? '',
			amountTone: 'neutral' as const
		}))
	);
</script>

<div class="sleep-dashboard">
	<SleepLogger onLogged={() => onRefresh?.()} />

	<section class="sleep-summary">
		<div class="summary-tile">
			<span class="tile-label">Snitt per natt</span>
			<span class="tile-value">{fmtHours(data.rhythm.avgHours)}</span>
			<span class="tile-meta">{data.rhythm.nightCount} netter</span>
		</div>
		<div class="summary-tile">
			<span class="tile-label">Legger seg</span>
			<span class="tile-value">{data.rhythm.bedtime ?? '–'}</span>
			<span class="tile-meta">median</span>
		</div>
		<div class="summary-tile">
			<span class="tile-label">Våkner</span>
			<span class="tile-value">{data.rhythm.wake ?? '–'}</span>
			<span class="tile-meta">median</span>
		</div>
		<div class="summary-tile">
			<span class="tile-label">Sovepuls</span>
			<span class="tile-value">
				{data.latest.sleepHeartRate !== null ? Math.round(data.latest.sleepHeartRate) : '–'}
			</span>
			<span class="tile-meta">slag/min</span>
		</div>
	</section>

	{#if recentNights.length > 0}
		<section class="sleep-chart-card">
			<SectionLabel tag="h2">Siste to uker</SectionLabel>
			<div class="night-bars" role="img" aria-label="Søvntimer per natt siste to uker">
				{#each recentNights as night (night.date)}
					<div class="night-col">
						<div class="night-track">
							<div
								class="night-bar"
								class:is-short={night.hours < goalHours - 1}
								style={`height: ${Math.round((night.hours / maxHours) * 100)}%`}
							></div>
						</div>
						<span class="night-label">{weekdayLabel(night.date)}</span>
					</div>
				{/each}
			</div>
			<p class="chart-note">Målet er {fmtHours(goalHours)} per natt.</p>
		</section>
	{:else}
		<div class="sleep-empty">
			<p>Ingen søvndata ennå.</p>
			<p class="empty-sub">Koble til eller synkroniser Withings for å fylle søvnbildet.</p>
		</div>
	{/if}

	{#if data.goals.length > 0}
		<section class="sleep-goals">
			<SectionLabel tag="h2">Søvnmål</SectionLabel>
			<ul class="goal-list">
				{#each data.goals as goal (goal.id)}
					<li class="goal-row" class:is-off={goal.evaluation.withinTarget === false}>
						<span class="goal-title">{goal.title}</span>
						<span class="goal-status">
							{goal.evaluation.currentLabel ?? '–'} · {goal.evaluation.targetLabel}
						</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<SleepDisturbanceList nights={data.disturbanceNights} onChanged={() => onRefresh?.()} />

	{#if napItems.length > 0}
		<section class="sleep-naps">
			<CompactRecordList title="Powernaps" items={napItems} emptyText="Ingen powernaps registrert." />
		</section>
	{/if}
</div>

<style>
	.sleep-dashboard {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}

	.sleep-summary {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 8px;
	}

	.summary-tile {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 12px;
		background: var(--card-bg-subtle, #141414);
		border-radius: var(--card-radius, 16px);
	}

	.tile-label {
		font-size: 0.7rem;
		color: #888;
	}

	.tile-value {
		font-size: 1.1rem;
		font-weight: 700;
		letter-spacing: -0.02em;
		color: #eee;
	}

	.tile-meta {
		font-size: 0.68rem;
		color: #666;
	}

	.sleep-chart-card,
	.sleep-goals {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 16px;
		background: var(--card-bg-subtle, #141414);
		border-radius: var(--card-radius, 16px);
	}

	.night-bars {
		display: flex;
		align-items: flex-end;
		gap: 4px;
		height: 96px;
	}

	.night-col {
		display: flex;
		flex: 1 1 0;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		min-width: 0;
		height: 100%;
	}

	.night-track {
		display: flex;
		align-items: flex-end;
		width: 100%;
		height: 100%;
	}

	.night-bar {
		width: 100%;
		border-radius: 3px 3px 0 0;
		background: #5fa0a0;
	}

	/* Korte netter skal være synlige uten å lese aksen. */
	.night-bar.is-short {
		background: #e0a070;
	}

	.night-label {
		font-size: 0.62rem;
		color: #666;
	}

	.chart-note {
		margin: 0;
		font-size: 0.74rem;
		color: #777;
	}

	.goal-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.goal-row {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		font-size: 0.84rem;
	}

	.goal-title {
		color: #ddd;
	}

	.goal-status {
		color: #888;
		text-align: right;
	}

	.goal-row.is-off .goal-status {
		color: #e0a070;
	}

	.sleep-empty {
		padding: 28px 20px;
		text-align: center;
		color: #aaa;
		background: var(--card-bg-subtle, #141414);
		border-radius: var(--card-radius, 16px);
	}

	.empty-sub {
		margin: 4px 0 0;
		font-size: 0.82rem;
		color: #777;
	}
</style>
