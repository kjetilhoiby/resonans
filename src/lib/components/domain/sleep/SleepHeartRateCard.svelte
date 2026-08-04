<!--
  SleepHeartRateCard — hvilepuls i søvn, siste natt mot ditt eget snitt.

  Sovepuls sto tidligere som ett tall i en flis, hentet fra ukesaggregatet: «52» uten
  retning, uten snitt, uten historikk. Da kan man ikke svare på det ene spørsmålet man
  har — er dette høyt for meg?

  Hvilepulsen (`hr_min`) er hovedtallet. Snittpulsen gjennom natta står som kryssjekk,
  siden den ligger 5–10 slag høyere og ellers ser ut som en motsigelse.

  Retningen er motsatt av VO2max: **lav puls er bra**, så en stigning er signalet. Og
  som HRV er det siste natt som gjelder, ikke den beste — «beste hvilepuls siste to
  måneder» svarer ikke på hvordan det står til nå.

  HRV vises i sitt eget kort, med vilje: ms og slag/min har ingen felles skala, og å
  legge dem i samme graf ville krevd to y-akser.
-->
<script lang="ts">
	import SectionLabel from '../../ui/SectionLabel.svelte';
	import {
		MIN_BASELINE_NIGHTS,
		NOTABLE_DEVIATION_BPM,
		type SleepHeartRateSummary
	} from '$lib/domain/health/sleep-heart-rate';

	interface Props {
		summary: SleepHeartRateSummary;
	}

	let { summary }: Props = $props();

	/** Siste to uker, som resten av søvnflaten. */
	const recent = $derived(summary.nights.slice(-14));

	const range = $derived.by(() => {
		const values = recent.map((n) => n.restingBpm as number);
		if (values.length === 0) return null;
		const min = Math.min(...values);
		const max = Math.max(...values);
		/**
		 * Minst 8 slag høy akse. Uten et gulv ville to netter på 51 og 53 fylt hele
		 * feltet og sett ut som et stup — samme regel som vektaksen i
		 * EnergyHistoryChart.
		 */
		const span = Math.max(8, max - min);
		const centre = (min + max) / 2;
		return { min: Math.floor(centre - span / 2), max: Math.ceil(centre + span / 2) };
	});

	function y(bpm: number): number {
		if (!range) return 50;
		return 100 - ((bpm - range.min) / (range.max - range.min)) * 100;
	}

	function x(index: number): number {
		return recent.length <= 1 ? 50 : (index / (recent.length - 1)) * 100;
	}

	const linePath = $derived(
		recent
			.map(
				(night, i) =>
					`${i === 0 ? 'M' : 'L'} ${x(i).toFixed(2)} ${y(night.restingBpm as number).toFixed(2)}`
			)
			.join(' ')
	);

	function osloDate(iso: string): string {
		const date = new Date(`${iso}T12:00:00Z`);
		if (Number.isNaN(date.getTime())) return '';
		return new Intl.DateTimeFormat('nb-NO', {
			day: 'numeric',
			month: 'short',
			timeZone: 'Europe/Oslo'
		}).format(date);
	}
</script>

<section class="shr">
	<SectionLabel tag="h2">Hvilepuls i søvn</SectionLabel>

	{#if summary.latest === null}
		<div class="card">
			<p class="note is-shaky">
				Ingen sovepuls målt ennå. Withings leverer den bare når klokka eller matta har
				pulsmåling gjennom natta.
			</p>
		</div>
	{:else}
		<div class="card">
			<div class="head">
				<span class="value">{summary.latest.restingBpm}</span>
				<span class="unit">slag/min</span>
				{#if summary.band !== 'ukjent'}
					<span class="band" data-band={summary.band}>
						{summary.band === 'over'
							? 'høyere enn vanlig'
							: summary.band === 'under'
								? 'lavere enn vanlig'
								: 'som vanlig'}
					</span>
				{/if}
			</div>

			<p class="meta">
				Natt til {osloDate(summary.latest.date)}
				{#if summary.deviationBpm !== null && summary.deviationBpm !== 0}
					· {summary.deviationBpm > 0 ? '+' : '−'}{Math.abs(summary.deviationBpm)} slag mot snittet
				{/if}
				{#if summary.latest.averageBpm !== null}
					· snitt gjennom natta {summary.latest.averageBpm}
				{/if}
			</p>

			{#if summary.baselineBpm !== null}
				<p class="meta">
					Ditt snitt: {summary.baselineBpm} slag/min over {summary.baselineNights} netter
				</p>
			{/if}

			{#if range && recent.length > 1}
				<div class="chart">
					<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
						{#if summary.baselineBpm !== null}
							<line
								x1="0"
								y1={y(summary.baselineBpm)}
								x2="100"
								y2={y(summary.baselineBpm)}
								stroke="#3a3a3a"
								stroke-width="1"
								stroke-dasharray="3 3"
								vector-effect="non-scaling-stroke"
							/>
						{/if}
						<path
							d={linePath}
							fill="none"
							stroke="#5fa0a0"
							stroke-width="1.8"
							stroke-linejoin="round"
							vector-effect="non-scaling-stroke"
						/>
						{#each recent as night, i (night.date)}
							<circle
								cx={x(i)}
								cy={y(night.restingBpm as number)}
								r="1.9"
								fill={i === recent.length - 1 ? '#eee' : '#5fa0a0'}
								vector-effect="non-scaling-stroke"
							/>
						{/each}
					</svg>
					<span class="axis-hi">{range.max}</span>
					<span class="axis-lo">{range.min}</span>
				</div>
				<!-- Den stiplede linja nevnes bare når den faktisk tegnes: uten baseline
				     finnes den ikke, og teksten ville pekt på noe som ikke er der. -->
				<p class="meta">
					Siste {recent.length}
					{recent.length === 1 ? 'natt' : 'netter'}{summary.baselineBpm !== null
						? '. Stiplet linje er snittet ditt.'
						: '.'}
				</p>
			{/if}

			<p class="note" class:is-shaky={summary.baselineBpm === null}>
				{#if summary.baselineBpm === null}
					Bygger snitt — {summary.baselineNights} av {MIN_BASELINE_NIGHTS} netter. Tallet alene
					sier lite; det er avviket fra ditt eget snitt som betyr noe.
				{:else if summary.band === 'over'}
					Høyere hvilepuls enn vanlig kan følge av hard trening, dårlig restitusjon,
					alkohol eller sykdom. Én natt er støy — det er flere netter på rad som er
					signalet.
				{:else if summary.band === 'under'}
					Lavere hvilepuls er vanligvis et godt tegn. Målt som laveste punkt gjennom
					natta.
				{:else}
					Målt som laveste punkt gjennom natta. Utslag under {NOTABLE_DEVIATION_BPM} slag
					er normal variasjon.
				{/if}
			</p>
		</div>
	{/if}
</section>

<style>
	.shr {
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
		color: #5fa0a0;
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

	/* Lav puls er bra — grønt for «under», gult for «over». Motsatt av VO2max. */
	.band[data-band='under'] {
		color: #82c882;
	}

	.band[data-band='over'] {
		color: #f0b429;
	}

	.chart {
		position: relative;
		height: 56px;
		margin: 6px 0 2px;
	}

	.chart svg {
		display: block;
		width: 100%;
		height: 100%;
		overflow: visible;
	}

	.axis-hi,
	.axis-lo {
		position: absolute;
		right: 0;
		padding-left: 4px;
		font-size: 0.62rem;
		color: #666;
		background: #141414;
	}

	.axis-hi {
		top: -6px;
	}

	.axis-lo {
		bottom: -6px;
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
