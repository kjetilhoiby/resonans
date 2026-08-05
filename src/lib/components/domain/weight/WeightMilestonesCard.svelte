<!--
  WeightMilestonesCard — setningene som utnytter dybden i historikken.

  Kortet formulerer ingenting selv. Hver setning kommer ferdig fra
  `buildWeightMilestones`, der vaktene bor: støygulv, minimumsspenn,
  ikke-overlappende sammenligningsvinduer og muskeltap som avlyser feiringen.
  Å sette sammen tall i malen ville flyttet de reglene til et sted uten tester.

  ## Hvorfor kortet ikke skjuler seg når det er stille

  En seksjon som forsvinner ser ut som en funksjon som ikke finnes. Er
  historikken for tynn, eller er siste veiing for gammel, sier kortet det — det
  er en beskjed brukeren kan handle på, i motsetning til tomrom. Samme lærdom som
  HRV-kortet på søvnflaten.
-->
<script lang="ts">
	import SectionLabel from '../../ui/SectionLabel.svelte';
	import {
		MIN_HISTORY_DAYS,
		MIN_HISTORY_WEIGH_INS,
		type WeightMilestone
	} from '$lib/domain/health/weight-milestones';

	interface Props {
		milestones: WeightMilestone[];
		historyDays: number;
		weighIns: number;
		enoughHistory: boolean;
		/** Sann når en setning peker lenger tilbake enn grafen rekker. */
		milestonesReachBeyondChart?: boolean;
	}

	let {
		milestones,
		historyDays,
		weighIns,
		enoughHistory,
		milestonesReachBeyondChart = false
	}: Props = $props();

	/**
	 * Over dette er pausen inne i perioden verdt å nevne. En setning om «laveste
	 * siden mars» er sann om målingene, men hvis du ikke veide deg i seks uker av
	 * den perioden, er det verdt å si at vi ikke vet hva vekta gjorde da.
	 */
	const GAP_NOTE_DAYS = 21;

	const longestGap = $derived(
		Math.max(0, ...milestones.map((m) => m.longestGapDays ?? 0))
	);

	const BASIS_LABEL: Record<WeightMilestone['basis'], string> = {
		trend: 'trend',
		måling: 'enkeltmåling',
		atferd: 'vane'
	};
</script>

<section class="milestones">
	<SectionLabel tag="h2">Milepæler</SectionLabel>

	{#if milestones.length === 0}
		<p class="note">
			{#if weighIns === 0}
				Ingen veiinger ennå — milepælene kommer av seg selv når historikken bygger seg opp.
			{:else if !enoughHistory}
				Historikken er ennå for kort for rekorder: {weighIns}
				{weighIns === 1 ? 'veiing' : 'veiinger'} over {historyDays}
				{historyDays === 1 ? 'dag' : 'dager'}. Det trengs {MIN_HISTORY_WEIGH_INS} veiinger over
				{MIN_HISTORY_DAYS} dager, ellers er alt en rekord og ingenting betyr noe.
			{:else}
				Ingenting nytt å melde akkurat nå. Kortet holder heller kjeft enn å pynte på et platå.
			{/if}
		</p>
	{:else}
		<ul>
			{#each milestones as milestone (milestone.kind)}
				<li class:is-positive={milestone.tone === 'positiv'}>
					<span class="dot" aria-hidden="true"></span>
					<span class="text">
						{milestone.sentence}
						<span class="basis">{BASIS_LABEL[milestone.basis]}</span>
					</span>
				</li>
			{/each}
		</ul>

		{#if longestGap >= GAP_NOTE_DAYS}
			<p class="note">
				Et strekk på {longestGap} dager uten veiing ligger inne i perioden setningene dekker. De
				er sanne om målingene vi har — hva vekta gjorde i pausen, vet vi ikke.
			</p>
		{/if}

		{#if milestonesReachBeyondChart}
			<p class="note">
				Én av datoene ligger lenger tilbake enn grafen under rekker. Milepælene leser hele
				historikken; grafen viser de siste årene.
			</p>
		{/if}
	{/if}
</section>

<style>
	.milestones {
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
		gap: 10px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		gap: 9px;
		align-items: flex-start;
	}

	/* Tonen bæres av en prikk pluss ordlyden, aldri av farge alene: en nøytral og
	   en positiv setning skal kunne skilles av noen som ikke ser forskjell på
	   grønt og grått. Setningen sier selv hva den er. */
	.dot {
		flex: 0 0 auto;
		width: 6px;
		height: 6px;
		margin-top: 6px;
		border-radius: 999px;
		background: #4a4a4a;
	}

	li.is-positive .dot {
		background: #199e70;
	}

	.text {
		font-size: 0.85rem;
		line-height: 1.45;
		color: #ddd;
	}

	.basis {
		display: inline-block;
		margin-left: 6px;
		padding: 1px 6px;
		border-radius: 999px;
		background: #202020;
		font-size: 0.62rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #7d7d7d;
		vertical-align: 1px;
		white-space: nowrap;
	}

	.note {
		margin: 0;
		font-size: 0.72rem;
		line-height: 1.5;
		color: #777;
	}
</style>
