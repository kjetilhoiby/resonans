<!--
  WeightPeriodsCard — kurvens egne perioder, topp til bunn og bunn til topp.

  ## Hvorfor kortet finnes

  Milepælene måler over faste vinduer (30/90/180/365 dager). Et fast vindu treffer
  sjelden der bevegelsen begynte: «ned 1,8 kg på 365 dager» var sant for en bruker
  som hadde gått ned nesten seks kilo siden april — vinduet blandet inn oppgangen
  som lå foran nedgangen.

  Her er grensene kurvens egne, så hver rad har én retning, og tempoet i den er
  tempoet i noe som faktisk hendte. Se `$lib/domain/health/weight-swings.ts` for
  hvordan et vendepunkt bekreftes.

  ## Hva kortet ikke later som

  Lista er IKKE sammenhengende. Mellom to rader kan det ligge bevegelse som ikke
  nådde terskelen, og notisen nederst sier det. En liste som ser komplett ut men
  ikke er det, er verre enn en med et forbehold.

  Retningen bæres av ord og en pil, ikke av farge: en oppgang er ikke en
  fiasko, og fargekoding ville moralisert over et tall brukeren ikke kontrollerer
  fra dag til dag.
-->
<script lang="ts">
	import SectionLabel from '../../ui/SectionLabel.svelte';
	import {
		isSwingActive,
		swingHeadline,
		swingPaceText,
		swingPeriodText,
		MIN_SWING_DAYS,
		MIN_SWING_KG,
		type WeightSwing
	} from '$lib/domain/health/weight-swings';
	import { describeSpan } from '$lib/domain/health/weight-text';

	interface Props {
		swings: WeightSwing[];
		/** Sann når historikken er for tynn til at perioder betyr noe. */
		enoughHistory?: boolean;
	}

	let { swings, enoughHistory = true }: Props = $props();

	/**
	 * Hvor mange rader som vises.
	 *
	 * Nyeste først: spørsmålet er «hva skjer nå», og de eldste periodene er
	 * bakgrunn. Resten telles opp i notisen framfor å skjules i stillhet.
	 */
	const MAX_ROWS = 6;

	const newestFirst = $derived([...swings].reverse());
	/**
	 * Utvidet lista er ikke pynt: det er sammenligningen.
	 *
	 * «Hvor fort klarte jeg det sist» og «hvor lenge holdt det» besvares av rader
	 * som ligger år tilbake, og de seks ferskeste er sjelden dem. Periodene er
	 * regnet på HELE historikken uansett — det var bare visningen som stoppet på
	 * seks — så utvidelsen koster ingen spørring.
	 */
	let expanded = $state(false);
	const shown = $derived(expanded ? newestFirst : newestFirst.slice(0, MAX_ROWS));
	const hidden = $derived(Math.max(0, newestFirst.length - shown.length));

	/**
	 * Over dette er hullet i veiingene verdt å nevne på raden.
	 *
	 * Et tempo regnet over et vindu der tre uker mangler målinger er ikke observert.
	 * Samme terskel som milepælskortet bruker.
	 */
	const GAP_NOTE_DAYS = 21;
</script>

<section class="periods">
	<SectionLabel tag="h2">Perioder</SectionLabel>

	{#if swings.length === 0}
		<p class="note">
			{#if !enoughHistory}
				Historikken er ennå for kort for perioder. De kommer av seg selv når trenden har noe å
				bevege seg over.
			{:else}
				Ingen perioder over {MIN_SWING_KG} kg ennå. Trenden har holdt seg innenfor det som er
				væske og dagsform — og det er i seg selv et svar.
			{/if}
		</p>
	{:else}
		<ul>
			{#each shown as swing (swing.startDate + swing.direction)}
				<li>
					<span class="arrow" class:is-down={swing.direction === 'ned'} aria-hidden="true">
						{swing.direction === 'ned' ? '↓' : '↑'}
					</span>
					<div class="body">
						<p class="headline">
							<span class="change">{swingHeadline(swing)}</span>
							{#if isSwingActive(swing)}
								<span class="chip">pågår</span>
							{/if}
						</p>
						<p class="meta">
							{swingPeriodText(swing)} · {describeSpan(swing.days)} · {swingPaceText(swing)}
						</p>
						{#if swing.longestGapDays >= GAP_NOTE_DAYS}
							<p class="meta gap">
								{swing.longestGapDays} dager uten veiing inne i perioden — tempoet er regnet over
								dager som ikke er målt.
							</p>
						{/if}
					</div>
				</li>
			{/each}
		</ul>

		<p class="note">
			Grensene er kurvens egne topper og bunner på trenden, ikke faste vinduer. Bevegelser under
			{MIN_SWING_KG} kg eller {MIN_SWING_DAYS} dager er utelatt som væske, så lista har hull —
			mellom to rader kan det ligge bevegelse som ikke nådde terskelen.
		</p>

		{#if newestFirst.length > MAX_ROWS}
			<button
				class="more"
				onclick={() => (expanded = !expanded)}
				data-track="vekt-perioder:vis-flere"
			>
				{#if expanded}
					Vis bare de {MAX_ROWS} nyeste
				{:else}
					Vis {hidden} eldre {hidden === 1 ? 'periode' : 'perioder'}
				{/if}
			</button>
		{/if}
	{/if}
</section>

<style>
	.more {
		align-self: flex-start;
		padding: 7px 12px;
		border-radius: 999px;
		border: 1px solid var(--card-border, #2a2a2a);
		background: transparent;
		color: var(--color-text-secondary, #b8b8b8);
		font-size: 12px;
		cursor: pointer;
	}

	.more:hover {
		border-color: #3a3a3a;
		color: var(--color-text, #ededed);
	}

	.periods {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 16px;
		background: var(--card-bg-subtle, #141414);
		border-radius: var(--card-radius, 16px);
	}

	ul {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		gap: 10px;
		align-items: flex-start;
	}

	/* Pila er retningen, ikke en vurdering. Samme demping i begge retninger. */
	.arrow {
		flex: 0 0 auto;
		width: 18px;
		text-align: center;
		font-size: 0.95rem;
		line-height: 1.35;
		color: #8d8d8d;
	}

	.arrow.is-down {
		color: #b9b3a6;
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.headline {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0;
	}

	.change {
		font-size: 0.9rem;
		font-weight: 600;
		color: #e8e2d4;
	}

	.chip {
		padding: 1px 6px;
		border-radius: 999px;
		background: #202020;
		font-size: 0.62rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #7d7d7d;
		white-space: nowrap;
	}

	.meta {
		margin: 0;
		font-size: 0.72rem;
		line-height: 1.45;
		color: #8a8a8a;
	}

	.meta.gap {
		color: #777;
	}

	.note {
		margin: 0;
		font-size: 0.72rem;
		line-height: 1.5;
		color: #777;
	}
</style>
