<!--
  HrvCard — hjerterytmevariasjon i søvn, siste natt mot ditt eget snitt.

  Absoluttverdien står med, men den er ikke poenget: SDNN varierer så mye mellom
  folk at 20 ms kan være normalt for én og et varsel for en annen. Det finnes
  ingen normtabell å plassere folk i, slik det finnes for oksygenopptak. Derfor er
  avviket fra egen baseline hovedtallet, og kortet sier «bygger baseline» framfor å
  vise et avvik det ikke har grunnlag for.

  Retningen er dessuten motsatt av de andre helsekortene: her er *siste* måling
  det interessante, ikke den beste. HRV svarer på hvordan det står til nå.
-->
<script lang="ts">
	import SectionLabel from '../../ui/SectionLabel.svelte';
	import { formatHrv, MIN_BASELINE_NIGHTS, type HrvMetric } from '$lib/domain/health/hrv';

	interface Props {
		metric: HrvMetric | null;
		breathing?: {
			date: string;
			apneaHypopneaIndex: number | null;
			snoringMinutes: number | null;
			snoringEpisodes: number | null;
		} | null;
	}

	let { metric, breathing = null }: Props = $props();

	function osloDate(iso: string): string {
		const date = new Date(`${iso}T12:00:00Z`);
		if (Number.isNaN(date.getTime())) return '';
		return new Intl.DateTimeFormat('nb-NO', {
			day: 'numeric',
			month: 'short',
			timeZone: 'Europe/Oslo'
		}).format(date);
	}

	const deviationLabel = $derived.by(() => {
		const pct = metric?.deviationPct;
		if (pct === null || pct === undefined) return null;
		const rounded = Math.round(pct);
		if (rounded === 0) return 'på snittet';
		return `${rounded > 0 ? '+' : ''}${rounded} % mot snittet`;
	});

	/** Over 5 hendelser per time er klinisk grense for mild apné. */
	const apneaWorthMentioning = $derived((breathing?.apneaHypopneaIndex ?? 0) >= 5);
</script>

{#if metric}
	<section class="hrv">
		<SectionLabel tag="h2">Hjerterytmevariasjon</SectionLabel>
		<div class="card">
			<div class="head">
				<span class="value">{formatHrv(metric.latest).replace(' ms', '')}</span>
				<span class="unit">ms</span>
				{#if metric.band !== 'ukjent'}
					<span class="band" data-band={metric.band}>
						{metric.band === 'under' ? 'under snittet' : metric.band === 'over' ? 'over snittet' : 'normalt'}
					</span>
				{/if}
			</div>

			<p class="meta">
				Natt til {osloDate(metric.latestDate)}{deviationLabel ? ` · ${deviationLabel}` : ''}
			</p>

			{#if metric.baseline !== null}
				<p class="meta">
					Ditt snitt: {formatHrv(metric.baseline)} over {metric.baselineNights} netter
				</p>
			{/if}

			<p class="note" class:is-shaky={metric.baseline === null}>
				{#if metric.baseline === null}
					Bygger baseline — {metric.baselineNights} av {MIN_BASELINE_NIGHTS} netter. Tallet alene
					sier lite; det er avviket fra ditt eget snitt som betyr noe.
				{:else if metric.band === 'under'}
					Lavere enn vanlig kan følge av hard trening, dårlig søvn, alkohol eller
					sykdom. Én natt er støy — det er flere netter på rad som er signalet.
				{:else}
					Målt i søvn, som median over natta. Sammenlign med deg selv, ikke med andre.
				{/if}
			</p>

			{#if breathing && (breathing.apneaHypopneaIndex !== null || breathing.snoringMinutes !== null)}
				<div class="breathing">
					<span class="breathing-label">Pust natt til {osloDate(breathing.date)}</span>
					<span class="breathing-values">
						{#if breathing.apneaHypopneaIndex !== null}
							<span class:is-flagged={apneaWorthMentioning}>
								{breathing.apneaHypopneaIndex} pustestopp/time
							</span>
						{/if}
						{#if breathing.snoringMinutes !== null}
							<span>{breathing.snoringMinutes} min snorking</span>
						{/if}
					</span>
				</div>
			{/if}
		</div>
	</section>
{/if}

<style>
	.hrv {
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

	.band[data-band='normal'] {
		color: #82c882;
	}

	.band[data-band='under'] {
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

	.breathing {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 10px;
		align-items: baseline;
		margin-top: 8px;
		padding-top: 10px;
		border-top: 1px solid #222;
	}

	.breathing-label {
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #666;
	}

	.breathing-values {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 10px;
		font-size: 0.72rem;
		color: #999;
	}

	.breathing-values .is-flagged {
		color: #f0b429;
	}
</style>
