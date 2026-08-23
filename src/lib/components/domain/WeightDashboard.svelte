<!--
  WeightDashboard — Vekt-undertemaets flate.

  Rekkefølgen er en påstand om hva brukeren spør om, i denne orden:
  «hvor står jeg» (status) → «hva betyr det» (milepæler) → «vis meg» (grafen) →
  «hva har skjedd før» (periodene). Milepælene står FØR grafen fordi de er svaret;
  grafen er belegget, og periodekortet er lesningen av den.

  Arbeidsdelingen mot mortemaet: Helse viser sammenhengen mellom vekt og trening
  gjennom signalet «Trening mot vektterskel». Vekt eier historikken, milepælene og
  kroppssammensetningen. Målvekta bor på mortemaets `metricSettings.weight.goal`
  — én terskel, lest av alle.
-->
<script lang="ts">
	import WeightStatusCard from './weight/WeightStatusCard.svelte';
	import WeightMilestonesCard from './weight/WeightMilestonesCard.svelte';
	import WeightOutliersCard from './weight/WeightOutliersCard.svelte';
	import WeightTrendChart from './weight/WeightTrendChart.svelte';
	import WeightPeriodsCard from './weight/WeightPeriodsCard.svelte';
	import WaistCard from './weight/WaistCard.svelte';
	import { buildMetricSeries } from '$lib/domain/health/weight-series';
	import type { WeightDashboardPayload } from '$lib/server/weight-dashboard';

	interface Props {
		data: WeightDashboardPayload;
		/** Kalles når en måling er slettet, så payloaden kan hentes på nytt. */
		onDataChanged?: () => void;
	}

	let { data, onDataChanged }: Props = $props();

	/**
	 * Trendverdien i siste målepunkt.
	 *
	 * Regnes her framfor å sendes med i payloaden, fordi den er utledet av `days` —
	 * to kilder til samme tall er to tall som kan gå fra hverandre.
	 */
	const latestTrend = $derived.by(() => {
		const points = buildMetricSeries(data.days, 'weight').points;
		for (let i = points.length - 1; i >= 0; i--) {
			if (points[i].trend !== null) return points[i].trend;
		}
		return null;
	});
</script>

<div class="weight-dashboard">
	<WeightStatusCard
		latest={data.latest}
		waist={data.waist}
		trendKg={latestTrend}
		composition={data.composition}
		today={data.today}
	/>

	<WeightMilestonesCard
		milestones={data.milestones}
		historyDays={data.historyDays}
		weighIns={data.weighIns}
		enoughHistory={data.enoughHistory}
		milestonesReachBeyondChart={data.milestonesReachBeyondChart}
	/>

	<WeightTrendChart
		days={data.days}
		waistDays={data.waistDays}
		goalKg={data.goalKg}
		swings={data.swings}
	/>

	<!-- Rett under grafen: radene er lesningen av kurven man nettopp så, og ringene
	     i grafen markerer de samme toppene og bunnene. Står de langt fra hverandre,
	     må leseren holde datoene i hodet mens hen blar. -->
	<WeightPeriodsCard swings={data.swings} enoughHistory={data.enoughHistory} />

	<!-- Uteliggerkortet står også under grafen: uteliggeren oppdages VED å se
	     grafen, og kortet er svaret på «hva gjør jeg med den» — ikke noe man
	     leter etter først. -->
	<WeightOutliersCard onDeleted={onDataChanged} />

	<!-- Sist: livvidde er den andre målingen på flaten, ikke den man kom for. Den
	     som skal logge finner den ved å bla forbi svaret vekta alt har gitt. -->
	<WaistCard days={data.waistDays} waist={data.waist} onLogged={onDataChanged} />
</div>

<style>
	.weight-dashboard {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
</style>
