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
		/**
		 * Hvorfor HRV mangler, når den mangler. Kortet skjulte seg helt før — og da ser
		 * en usynkronisert måling ut som en funksjon som ikke finnes.
		 */
		availability?: { sleepNights: number; nightsWithHrv: number } | null;
	}

	let { metric, breathing = null, availability = null }: Props = $props();

	/**
	 * Hvorfor det ikke er noe å vise.
	 *
	 * Skillet som betyr noe: har vi søvnnetter men ingen HRV, er det synken som ikke har
	 * levert (HRV ligger bare i Withings' `action=get` per dato, ikke i `getsummary`).
	 * Har vi ingen søvnnetter i det hele tatt, er det søvnmålingen som mangler — en helt
	 * annen ting å gjøre noe med.
	 */
	const missingReason = $derived.by(() => {
		if (metric) return null;
		if (!availability || availability.sleepNights === 0) {
			return 'Ingen søvnmålinger de siste 30 dagene. HRV måles i søvn, så den kommer når søvndata gjør det.';
		}
		return `${availability.sleepNights} netter med søvndata, men ingen med HRV. Withings leverer HRV kun per natt gjennom et eget kall — får du aldri tall her, er det verdt å sjekke at enheten faktisk måler puls gjennom natta.`;
	});

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

<section class="hrv">
	<SectionLabel tag="h2">Hjerterytmevariasjon</SectionLabel>

	{#if !metric}
		<div class="card">
			<p class="note is-shaky">{missingReason}</p>
		</div>
	{:else}
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

		</div>
	{/if}

	<!-- Pust og snorking henger ikke på HRV: de kommer fra andre felt i samme
	     søvnmåling, og skal vises selv om HRV mangler. -->
	{#if breathing && (breathing.apneaHypopneaIndex !== null || breathing.snoringMinutes !== null)}
		<div class="card">
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
		</div>
	{/if}
</section>

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
