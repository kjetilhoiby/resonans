<!--
  TrainingLoadSection — form (CTL/ATL/TSB) og belastningsbalanse side om side.

  Het HealthEffortSection og bodde på helse-mortemaet. Flyttet til Trening i
  august 2026: dette er trening → effekt, samme lesning som EffortBudgetCards
  vektterskel-linje og EffortWeightCard. Mortemaet viser sammenhengen gjennom
  signalene i stedet.

  Den gamle `variant`-propen er borte. 'full' tok med WeeklyEffortCard, men
  hadde ikke noe kallsted etter mortema-splitten — Helse sendte alltid
  'readiness'. Kortet er fortsatt demonstrert i /design.
-->
<script lang="ts">
	import FormCard from '../../composed/FormCard.svelte';
	import LoadBalanceCard from '../../composed/LoadBalanceCard.svelte';
	import type { TrainingLoadPoint } from '$lib/util/training-load';

	interface Props {
		series: TrainingLoadPoint[];
	}

	let { series }: Props = $props();
</script>

<!-- Under 14 dager har CTL/ATL ikke svingt seg inn, og kortene ville vist støy. -->
{#if series.length >= 14}
	<div class="tr-load">
		<FormCard {series} />
		<LoadBalanceCard {series} />
	</div>
{/if}

<style>
	.tr-load {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: 12px;
	}
</style>
