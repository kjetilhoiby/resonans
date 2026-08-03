<!--
  Vo2maxCard — formgulvet: beste VO2max-observasjon siste åtte uker.

  «Beste», ikke «siste», er hele poenget: VDOT antar en maksimal innsats for
  distansen, så en rolig 10k gir et lavt tall som bare sier at du løp rolig.
  Maksimum over et vindu svarer på «hva er formen din nå».

  Kortet er derfor eksplisitt om hvor tallet kommer fra og hvor sikkert det er.
  Et estimat fra en 3k er svakere enn fra en 10k, og en Withings-måling er noe
  annet enn begge.
-->
<script lang="ts">
	import SectionLabel from '../../ui/SectionLabel.svelte';
	import { formatVo2max, vo2maxBand, type Vo2maxMetric } from '$lib/domain/health/vo2max';

	interface Props {
		metric: Vo2maxMetric | null;
	}

	let { metric }: Props = $props();

	const sourceLabel = $derived.by(() => {
		if (!metric) return '';
		if (metric.source === 'withings') return 'målt av Withings';
		return metric.sourceDistance
			? `estimert fra beste ${metric.sourceDistance}`
			: 'estimert fra løpsdata';
	});

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

	/** Under 0,6 er tallet en pekepinn, ikke en måling. Det skal stå. */
	const shaky = $derived((metric?.confidence ?? 0) < 0.6);
</script>

{#if metric}
	<section class="vo2max">
		<SectionLabel tag="h2">Oksygenopptak</SectionLabel>
		<div class="card">
			<div class="head">
				<span class="value">{metric.best.toFixed(1).replace('.', ',')}</span>
				<span class="unit">ml/kg/min</span>
				<span class="band" data-band={vo2maxBand(metric.best)}>{vo2maxBand(metric.best)}</span>
			</div>

			<p class="meta">
				Beste av {metric.samples}
				{metric.samples === 1 ? 'observasjon' : 'observasjoner'} siste åtte uker · {sourceLabel}{dateLabel
					? ` · ${dateLabel}`
					: ''}
			</p>

			{#if metric.latest !== metric.best}
				<p class="meta">Siste observasjon: {formatVo2max(metric.latest)}</p>
			{/if}

			<p class="note" class:is-shaky={shaky}>
				{#if shaky}
					Grovt estimat — en kort distanse lener seg mer på anaerob kapasitet enn på
					oksygenopptak. En hard 5k eller 10k gir et bedre tall.
				{:else if metric.source === 'best_efforts'}
					Regnet fra Daniels' VDOT, som antar maksimal innsats. Løper du aldri hardt,
					står tallet stille selv om formen stiger.
				{:else}
					Fra Withings. Krever at du hadde klokka på under økta.
				{/if}
			</p>
		</div>
	</section>
{/if}

<style>
	.vo2max {
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

	.band[data-band='god'],
	.band[data-band='svært god'] {
		color: #82c882;
	}

	.band[data-band='lav'] {
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
