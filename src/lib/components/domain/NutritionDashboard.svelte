<!--
  NutritionDashboard — Ernæring-undertemaet av Helse.

  Flaten var en skalflate fram til august 2026, fordi ingenting logget inntak.
  Nå eier den inntaksloggen: fritekst eller bilde inn, makroer ut, estimert mot
  en norsk referansetabell. Logging øverst, dagens tall under, vekt til slutt.

  Vekten blir liggende fordi den er utfallet kostholdet påvirker. Selve
  effort→vekt-modellen bor på Trening (effort → effekt).
-->
<script lang="ts">
	import SectionLabel from '../ui/SectionLabel.svelte';
	import NutritionLogger from './nutrition/NutritionLogger.svelte';
	import NutritionDayCard from './nutrition/NutritionDayCard.svelte';
	import EnergyBalanceCard from './nutrition/EnergyBalanceCard.svelte';
	import type { NutritionDashboardPayload } from '$lib/server/nutrition-dashboard';

	interface Props {
		data: NutritionDashboardPayload;
		onOpenChat?: (draft?: string) => void;
		/** Ber flaten hente dashboardet på nytt etter en logging eller sletting. */
		onRefresh?: () => void;
	}

	let { data, onOpenChat, onRefresh }: Props = $props();

	const recent = $derived(data.weight.slice(-12));
	const latest = $derived(recent.at(-1) ?? null);
	const first = $derived(recent[0] ?? null);
	const totalChange = $derived(
		latest && first && latest !== first ? latest.avg - first.avg : null
	);

	function kg(value: number): string {
		return `${value.toFixed(1).replace('.', ',')} kg`;
	}

	function signedKg(value: number): string {
		const formatted = Math.abs(value).toFixed(1).replace('.', ',');
		return `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatted} kg`;
	}
</script>

<div class="nutrition-dashboard">
	<NutritionLogger onLogged={() => onRefresh?.()} />

	<NutritionDayCard
		day={data.today}
		targets={data.targets}
		average={data.average}
		onChanged={() => onRefresh?.()}
	/>

	<EnergyBalanceCard
		balance={data.energyBalance}
		composition={data.composition}
		compositionChange={data.compositionChange}
		compositionDate={data.compositionDate}
		expenditure={data.expenditureBreakdown ?? null}
		realityCheck={data.realityCheck ?? null}
		ownExpenditure={data.ownExpenditure ?? null}
		ownExpenditureMissing={data.ownExpenditureMissing ?? []}
		withingsExpenditureKcal={data.withingsExpenditureKcal ?? null}
	/>

	<section class="nutrition-source">
		<div class="source-actions">
			{#if data.foodThemeId}
				<a class="source-link" href={`/tema/${data.foodThemeId}`} data-track="ernaering:apne-mat">
					Åpne {data.foodThemeName ?? 'Mat'} →
				</a>
				<span class="source-hint">Ukemeny, oppskrifter og lager bor der.</span>
			{:else}
				<span class="source-hint">Matplanlegging bor i et eget Mat-tema.</span>
			{/if}
			{#if onOpenChat}
				<button
					type="button"
					class="source-chat"
					onclick={() => onOpenChat?.('Hjelp meg å komme i gang med kostholdet')}
					data-track="ernaering:start-samtale"
				>
					Snakk om kosthold
				</button>
			{/if}
		</div>
	</section>

	{#if recent.length > 0}
		<section class="weight-card">
			<SectionLabel tag="h2">Vekt</SectionLabel>
			<div class="weight-head">
				<span class="weight-value">{latest ? kg(latest.avg) : '–'}</span>
				{#if totalChange !== null}
					<span class="weight-change" class:is-down={totalChange < 0}>
						{signedKg(totalChange)} over {recent.length} måneder
					</span>
				{/if}
			</div>
			<div class="weight-bars" role="img" aria-label="Vektsnitt per måned">
				{#each recent as point (point.periodKey)}
					{@const min = Math.min(...recent.map((p) => p.avg))}
					{@const max = Math.max(...recent.map((p) => p.avg))}
					{@const span = Math.max(0.5, max - min)}
					<div class="weight-col" title={`${point.periodKey}: ${kg(point.avg)}`}>
						<div class="weight-track">
							<div
								class="weight-dot"
								style={`bottom: ${Math.round(((point.avg - min) / span) * 100)}%`}
							></div>
						</div>
					</div>
				{/each}
			</div>
			<p class="weight-note">
				Månedssnitt. Sammenhengen mellom trening og vekt ligger på Trening-temaet.
			</p>
		</section>
	{:else}
		<div class="nutrition-empty">
			<p>Ingen vektdata ennå.</p>
			<p class="empty-sub">Koble til Withings for å se vektutviklingen her.</p>
		</div>
	{/if}
</div>

<style>
	.nutrition-dashboard {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}

	.nutrition-source,
	.weight-card {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 16px;
		background: var(--card-bg-subtle, #141414);
		border-radius: var(--card-radius, 16px);
	}

	.source-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
	}

	.source-link {
		font-size: 0.84rem;
		color: #9aa7f0;
		text-decoration: none;
	}

	.source-hint {
		font-size: 0.76rem;
		color: #666;
	}

	.source-chat {
		margin-left: auto;
		padding: 7px 14px;
		font: inherit;
		font-size: 0.82rem;
		color: #ddd;
		background: #1e1e1e;
		border: 1px solid #2a2a2a;
		border-radius: 999px;
		cursor: pointer;
	}

	.weight-head {
		display: flex;
		align-items: baseline;
		gap: 10px;
	}

	.weight-value {
		font-size: 1.5rem;
		font-weight: 700;
		letter-spacing: -0.03em;
		color: #eee;
	}

	.weight-change {
		font-size: 0.8rem;
		color: #888;
	}

	.weight-change.is-down {
		color: #82c882;
	}

	.weight-bars {
		display: flex;
		align-items: stretch;
		gap: 4px;
		height: 72px;
	}

	.weight-col {
		flex: 1 1 0;
		min-width: 0;
	}

	.weight-track {
		position: relative;
		height: 100%;
		border-bottom: 1px solid #242424;
	}

	.weight-dot {
		position: absolute;
		left: 50%;
		width: 6px;
		height: 6px;
		margin-left: -3px;
		border-radius: 50%;
		background: #7c8ef5;
	}

	.weight-note {
		margin: 0;
		font-size: 0.74rem;
		color: #777;
	}

	.nutrition-empty {
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
