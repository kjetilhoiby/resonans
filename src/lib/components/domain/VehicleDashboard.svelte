<script lang="ts">
	/**
	 * VehicleDashboard — kjøretøy-tema-dashboard.
	 * Viser kjørt distanse per time (kronologisk) og kost per km per måned,
	 * avledet fra Tesla-odometer-snapshots + bilrelaterte banktransaksjoner.
	 */
	import SectionCard from '../ui/SectionCard.svelte';
	import DistanceTimelineChart from '../charts/DistanceTimelineChart.svelte';
	import CostPerKmChart from '../charts/CostPerKmChart.svelte';
	import PositionMapChart from '../charts/PositionMapChart.svelte';

	interface HourPoint {
		key: string;
		km: number;
	}
	interface CostPoint {
		month: string;
		km: number;
		cost: number;
		krPerKm: number | null;
	}
	interface PositionNode {
		lat: number;
		lon: number;
		kind: 'stop' | 'move';
		from: string;
		to: string;
		samples: number;
	}

	interface Props {
		connected: boolean;
		hourly: HourPoint[];
		costPerKm: CostPoint[];
		positions?: PositionNode[];
	}

	let { connected, hourly, costPerKm, positions = [] }: Props = $props();

	const kmLast7 = $derived(Math.round(hourly.reduce((sum, p) => sum + p.km, 0)));

	// Siste måned med faktisk kjøring (krPerKm != null) for KPI.
	const latestCost = $derived(
		[...costPerKm].reverse().find((p) => p.krPerKm !== null) ?? null
	);
	const currentMonthKm = $derived(costPerKm.length ? costPerKm[costPerKm.length - 1].km : 0);

	function fmtKr(n: number | null): string {
		if (n === null) return '—';
		return n.toLocaleString('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	}
</script>

{#if !connected}
	<div class="vd-empty">
		<p>Ingen Tesla tilkoblet ennå.</p>
		<a class="vd-link" href="/settings/sources">Koble til i Kilder →</a>
	</div>
{:else}
	<div class="vd">
		<div class="kpis" data-track="kjoretoy:kpi">
			<div class="kpi">
				<span class="kpi-val">{kmLast7}</span>
				<span class="kpi-label">km siste 7 dager</span>
			</div>
			<div class="kpi">
				<span class="kpi-val">{fmtKr(latestCost?.krPerKm ?? null)}</span>
				<span class="kpi-label">kr/km{latestCost ? ` (${monthName(latestCost.month)})` : ''}</span>
			</div>
			<div class="kpi">
				<span class="kpi-val">{currentMonthKm}</span>
				<span class="kpi-label">km denne måneden</span>
			</div>
		</div>

		<SectionCard tone="subtle">
			<DistanceTimelineChart data={hourly} />
		</SectionCard>

		<SectionCard tone="subtle">
			<PositionMapChart {positions} />
		</SectionCard>

		<SectionCard tone="subtle">
			<CostPerKmChart data={costPerKm} />
			<p class="vd-note">
				Kost/km = lading, bom, parkering, verksted + forsikring og billån, delt på kjørte km.
				Fylles opp etter hvert som måneder med data samler seg.
			</p>
		</SectionCard>
	</div>
{/if}

<script lang="ts" module>
	const MONTHS = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];
	function monthName(month: string): string {
		const m = Number(month.split('-')[1]);
		return MONTHS[m - 1] ?? month;
	}
</script>

<style>
	.vd {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.kpis {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
	}
	.kpi {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: 12px 6px;
		background: var(--card-bg-subtle, #141414);
		border: 1px solid var(--card-border, #242424);
		border-radius: var(--radius-md, 12px);
	}
	.kpi-val {
		font-size: 1.1rem;
		font-weight: 700;
		color: #e6e6e6;
		font-variant-numeric: tabular-nums;
	}
	.kpi-label {
		font-size: 0.62rem;
		color: #888;
		text-align: center;
		line-height: 1.2;
	}
	.vd-note {
		margin: 10px 0 0;
		font-size: 0.7rem;
		line-height: 1.5;
		color: #777;
	}
	.vd-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		padding: 40px 20px;
		color: #777;
		font-size: 0.85rem;
		text-align: center;
	}
	.vd-link {
		color: #7c8ef5;
		font-size: 0.8rem;
		text-decoration: none;
	}
</style>
