<!--
  HrRecoveryCard — pulsfallet det første minuttet etter hard innsats.

  «Beste siste fire uker», ikke «siste»: et fall forutsetter at du faktisk presset.
  En rolig joggetur gir et lite fall som bare sier at pulsen aldri var høy, og
  snittet ville straffet de rolige ukene.

  Kortet er eksplisitt om to ting koden ikke kan vite. Målingen ankres i
  pulsserien, ikke i stoppknappen — ligger ankeret langt under toppen, startet
  fallet før vi begynte å måle, og tallet er et gulv. Og et lite fall kan like
  gjerne bety at du fortsatte å bevege deg etterpå som at restitusjonen er dårlig.
-->
<script lang="ts">
	import SectionLabel from '../../ui/SectionLabel.svelte';
	import type { HrRecoveryMetric } from '$lib/domain/health/hr-recovery';

	interface Props {
		metric: HrRecoveryMetric | null;
	}

	let { metric }: Props = $props();

	const dateLabel = $derived.by(() => {
		if (!metric) return '';
		const date = new Date(metric.bestAt);
		if (Number.isNaN(date.getTime())) return '';
		return new Intl.DateTimeFormat('nb-NO', {
			day: 'numeric',
			month: 'short',
			timeZone: 'Europe/Oslo'
		}).format(date);
	});

	const sportLabel = $derived.by(() => {
		const family = metric?.sportFamily;
		if (!family) return '';
		const norsk: Record<string, string> = {
			running: 'løping',
			cycling: 'sykling',
			ebike: 'el-sykkel',
			walking: 'gåtur',
			hiking: 'fottur',
			swimming: 'svømming',
			strength: 'styrke',
			football: 'fotball'
		};
		return norsk[family] ?? family;
	});
</script>

{#if metric}
	<section class="hrr">
		<SectionLabel tag="h2">Pulsfall</SectionLabel>
		<div class="card">
			<div class="head">
				<span class="value">{metric.best}</span>
				<span class="unit">slag på 60 sek</span>
				<span class="band" data-band={metric.band}>{metric.band}</span>
			</div>

			<p class="meta">
				Beste av {metric.samples}
				{metric.samples === 1 ? 'økt' : 'økter'} siste fire uker{sportLabel
					? ` · ${sportLabel}`
					: ''}{dateLabel ? ` · ${dateLabel}` : ''}
			</p>

			<p class="meta">
				Fra {metric.bestEndBpm} til {metric.bestEndBpm - metric.best} slag
			</p>

			{#if metric.latest !== metric.best}
				<p class="meta">Siste økt: {metric.latest} slag</p>
			{/if}

			<p class="note" class:is-shaky={!metric.wellAnchored}>
				{#if !metric.wellAnchored}
					Målingen startet {metric.bestPeakBpm - metric.bestEndBpm} slag under toppen på
					{metric.bestPeakBpm} — fallet var i gang før vi fikk målt, så tallet er et gulv.
				{:else}
					Et lite fall kan bety at du fortsatte å bevege deg etter økta, ikke at
					restitusjonen er dårlig. Målt fra pulsserien, ikke fra stoppknappen.
				{/if}
			</p>
		</div>
	</section>
{/if}

<style>
	.hrr {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 14px;
		border-radius: 16px;
		background: #141414;
	}

	.head {
		display: flex;
		align-items: baseline;
		gap: 7px;
		flex-wrap: wrap;
	}

	.value {
		font-size: 1.9rem;
		font-weight: 700;
		letter-spacing: -0.02em;
		color: #7c8ef5;
	}

	.unit {
		font-size: 0.74rem;
		color: #777;
	}

	.band {
		margin-left: auto;
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #888;
	}

	.band[data-band='god'] {
		color: #82c882;
	}

	.band[data-band='svak'] {
		color: #f0b429;
	}

	.meta {
		margin: 0;
		font-size: 0.72rem;
		color: #777;
	}

	.note {
		margin: 4px 0 0;
		font-size: 0.72rem;
		line-height: 1.5;
		color: #666;
	}

	.note.is-shaky {
		color: #f0b429;
	}
</style>
