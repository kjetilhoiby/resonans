<!--
  WeightDashboard — Vekt-undertemaets flate.

  Rekkefølgen er en påstand om hva brukeren spør om, i denne orden:
  «hvor står jeg» (status) → «hva betyr det» (milepæler) → «vis meg» (grafen).
  Milepælene står FØR grafen fordi de er svaret; grafen er belegget.

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

	<!-- Under grafen, ikke over: uteliggeren oppdages VED å se grafen, og kortet er
	     svaret på «hva gjør jeg med den» — ikke noe man leter etter først. -->
	<WeightTrendChart days={data.days} goalKg={data.goalKg} />

	<WeightOutliersCard onDeleted={onDataChanged} />
</div>

<style>
	.weight-dashboard {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
</style>
