<script lang="ts">
	import SectionLabel from '../../ui/SectionLabel.svelte';

	interface PeriodMetrics {
		weight?: { avg?: number; min?: number; max?: number; change?: number };
		steps?: { sum?: number; avg?: number; max?: number };
		sleep?: { avg?: number; min?: number; max?: number };
		workouts?: { count?: number; totalDuration?: number; types?: Record<string, number> };
		intenseMinutes?: { sum?: number; avg?: number };
		heartRate?: { avg?: number; min?: number; max?: number };
		sleepHeartRate?: { avg?: number; min?: number; max?: number };
		sleepLag?: number;
		earlyWake?: number;
		weeklyEffort?: { total: number };
	}

	interface AggregatePeriod {
		period: string;
		periodKey: string;
		eventCount: number;
		startDate?: string | Date;
		endDate?: string | Date;
		metrics?: PeriodMetrics | null;
	}

	interface Props {
		periodData: AggregatePeriod[];
		weekly: AggregatePeriod[];
	}

	let { periodData, weekly }: Props = $props();

	let periodTableFilter = $state<'siste5' | 'i_ar' | 'siste_ar' | 'alt'>('siste5');

	function periodYear(periodKey: string): number {
		return parseInt(periodKey.split(/[WMQY]/)[0]);
	}

	const visiblePeriods = $derived.by(() => {
		const reversed = [...periodData].reverse();
		const now = new Date();
		const thisYear = now.getFullYear();
		if (periodTableFilter === 'siste5') return reversed.slice(0, 5);
		if (periodTableFilter === 'i_ar') return reversed.filter(p => periodYear(p.periodKey) === thisYear);
		if (periodTableFilter === 'siste_ar') return reversed.filter(p => periodYear(p.periodKey) === thisYear - 1);
		return reversed;
	});

	const effortByPeriodKey = $derived.by(() => {
		const map = new Map<string, number>();
		for (const p of periodData) {
			if (p.period === 'week') {
				const t = p.metrics?.weeklyEffort?.total;
				if (t != null) map.set(p.periodKey, t);
				continue;
			}
			if (!p.startDate || !p.endDate) continue;
			const pStart = new Date(p.startDate).getTime();
			const pEnd = new Date(p.endDate).getTime();
			let total = 0;
			let found = false;
			for (const w of weekly) {
				const eff = w.metrics?.weeklyEffort?.total;
				if (eff == null || !w.startDate || !w.endDate) continue;
				const wStart = new Date(w.startDate).getTime();
				const wEnd = new Date(w.endDate).getTime();
				if (wEnd >= pStart && wStart <= pEnd) {
					total += eff;
					found = true;
				}
			}
			if (found) map.set(p.periodKey, total);
		}
		return map;
	});

	// Color system
	const METRIC_PALETTE = {
		bad: [200, 110, 110] as const,
		mid: [190, 155, 95] as const,
		good: [120, 175, 130] as const,
		none: [70, 70, 75] as const
	};

	type ColorStop = readonly [value: number, rgb: readonly [number, number, number]];

	function interpolateStops(value: number, stops: readonly ColorStop[]): string {
		if (value <= stops[0][0]) return rgb(stops[0][1]);
		for (let i = 1; i < stops.length; i++) {
			const [v1, c1] = stops[i - 1];
			const [v2, c2] = stops[i];
			if (value <= v2) {
				const t = v2 === v1 ? 0 : (value - v1) / (v2 - v1);
				return rgb([
					Math.round(c1[0] + (c2[0] - c1[0]) * t),
					Math.round(c1[1] + (c2[1] - c1[1]) * t),
					Math.round(c1[2] + (c2[2] - c1[2]) * t)
				]);
			}
		}
		return rgb(stops[stops.length - 1][1]);
	}

	function rgb([r, g, b]: readonly [number, number, number]): string {
		return `rgb(${r}, ${g}, ${b})`;
	}

	const NONE_COLOR = rgb(METRIC_PALETTE.none);

	const WEIGHT_STOPS: readonly ColorStop[] = [
		[-1.5, METRIC_PALETTE.good],
		[-0.3, METRIC_PALETTE.good],
		[0.1, METRIC_PALETTE.mid],
		[0.8, METRIC_PALETTE.bad]
	];
	const RUNNING_STOPS: readonly ColorStop[] = [
		[0, METRIC_PALETTE.bad],
		[8, METRIC_PALETTE.mid],
		[20, METRIC_PALETTE.good],
		[35, METRIC_PALETTE.good]
	];
	const EFFORT_STOPS: readonly ColorStop[] = [
		[0, METRIC_PALETTE.bad],
		[80, METRIC_PALETTE.bad],
		[200, METRIC_PALETTE.mid],
		[450, METRIC_PALETTE.good],
		[900, METRIC_PALETTE.good]
	];
	const SLEEP_LAG_STOPS: readonly ColorStop[] = [
		[0, METRIC_PALETTE.good],
		[20, METRIC_PALETTE.good],
		[40, METRIC_PALETTE.mid],
		[65, METRIC_PALETTE.bad]
	];
	const HR_STOPS: readonly ColorStop[] = [
		[48, METRIC_PALETTE.good],
		[58, METRIC_PALETTE.good],
		[65, METRIC_PALETTE.mid],
		[75, METRIC_PALETTE.bad]
	];

	function weightColor(change: number | undefined): string {
		return change == null ? NONE_COLOR : interpolateStops(change, WEIGHT_STOPS);
	}
	function runningColor(km: number | undefined): string {
		return km == null || km <= 0 ? NONE_COLOR : interpolateStops(km, RUNNING_STOPS);
	}
	function effortPerWeek(total: number | undefined, periodDays: number): number | undefined {
		if (total == null) return undefined;
		const weeks = Math.max(1, periodDays / 7);
		return total / weeks;
	}
	function effortColor(perWeek: number | undefined): string {
		return perWeek == null ? NONE_COLOR : interpolateStops(perWeek, EFFORT_STOPS);
	}
	function sleepLagColor(lag: number | undefined): string {
		return lag == null ? NONE_COLOR : interpolateStops(lag, SLEEP_LAG_STOPS);
	}
	function heartRateColor(bpm: number | undefined): string {
		return bpm == null ? NONE_COLOR : interpolateStops(bpm, HR_STOPS);
	}

	function formatPeriodKey(key: string, period: string): string {
		if (period === 'week') {
			const [, week] = key.split('W');
			return `Uke ${week}`;
		}
		if (period === 'month') {
			const [year, month] = key.split('M');
			const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Des'];
			return `${monthNames[parseInt(month) - 1] ?? month} ${year}`;
		}
		if (period === 'quarter') {
			const [year, q] = key.split('Q');
			return `Q${q} ${year}`;
		}
		return key;
	}

	function formatMetric(value: number | undefined, decimals = 1): string {
		if (value === undefined || value === null) return '–';
		return value.toFixed(decimals);
	}

	function formatWeightChange(change: number | undefined): string {
		if (change == null) return '–';
		const sign = change > 0 ? '+' : '';
		return `${sign}${change.toFixed(1)}`;
	}

	function daysInPeriod(p: { startDate?: string | Date; endDate?: string | Date }): number {
		if (!p.startDate || !p.endDate) return 1;
		const ms = new Date(p.endDate).getTime() - new Date(p.startDate).getTime();
		return Math.max(1, Math.round(ms / 86400000) + 1);
	}
</script>

<div class="hd-table-card">
	<div class="hd-table-head">
		<SectionLabel tag="h2">Perioder</SectionLabel>
		<div class="hd-period-filters">
			{#each [['siste5', 'Siste 5'], ['i_ar', 'I år'], ['siste_ar', 'Siste år'], ['alt', 'Alt']] as [val, label]}
				<button
					class="hd-period-filter-btn"
					class:hd-period-filter-btn--active={periodTableFilter === val}
					onclick={() => { periodTableFilter = val as typeof periodTableFilter; }}
				>{label}</button>
			{/each}
		</div>
	</div>
	<div class="hd-table-wrap">
		<table class="hd-table">
			<thead>
				<tr>
					<th>Periode</th>
					<th title="Vektendring i perioden">⚖️</th>
					<th title="Kilometer løpt">🏃</th>
					<th title="Relativ effort (snitt per uke)">⚡</th>
					<th title="Sleep lag (timing-indeks, lavere = bedre)">⏰</th>
					<th title="Sovepuls (snitt)">💓</th>
				</tr>
			</thead>
			<tbody>
				{#each visiblePeriods as period}
					{@const days = daysInPeriod(period)}
					{@const weightChange = period.metrics?.weight?.change}
					{@const runKm = (period.metrics?.workouts?.types?.running ?? 0) > 0 ? (period.metrics!.workouts!.types!.running as number) : undefined}
					{@const effortPw = effortPerWeek(effortByPeriodKey.get(period.periodKey), days)}
					{@const sleepLag = period.metrics?.sleepLag}
					{@const hr = period.metrics?.sleepHeartRate?.avg}
					<tr>
						<td>{formatPeriodKey(period.periodKey, period.period)}</td>
						<td><span class="hd-metric-pill" style="--pill-color: {weightColor(weightChange)}">{formatWeightChange(weightChange)}</span></td>
						<td><span class="hd-metric-pill" style="--pill-color: {runningColor(runKm)}">{runKm != null ? runKm.toFixed(1) : '–'}</span></td>
						<td><span class="hd-metric-pill" style="--pill-color: {effortColor(effortPw)}">{effortPw != null ? Math.round(effortPw) : '–'}</span></td>
						<td><span class="hd-metric-pill" style="--pill-color: {sleepLagColor(sleepLag)}">{sleepLag != null ? Math.round(sleepLag) : '–'}</span></td>
						<td><span class="hd-metric-pill" style="--pill-color: {heartRateColor(hr)}">{formatMetric(hr, 0)}</span></td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<style>
	.hd-table-card {
		background: #141414;
		border-radius: 18px;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.hd-table-head {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.hd-period-filters {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.hd-period-filter-btn {
		padding: 4px 12px;
		font-size: 0.76rem;
		font-weight: 500;
		border-radius: 8px;
		border: 1px solid #2a2a2a;
		background: #1a1a1a;
		color: #888;
		cursor: pointer;
		transition: all 0.12s;
	}

	.hd-period-filter-btn:hover {
		background: #222;
		color: #ccc;
	}

	.hd-period-filter-btn--active {
		background: #1e2040;
		border-color: #3a4080;
		color: #aab4f5;
	}

	.hd-table-wrap {
		overflow-x: auto;
	}

	.hd-table {
		width: 100%;
		border-collapse: collapse;
	}

	.hd-table th,
	.hd-table td {
		text-align: center;
		padding: 10px 4px;
		border-top: 1px solid #202020;
		font-size: 0.8rem;
	}

	.hd-table th:first-child,
	.hd-table td:first-child {
		text-align: left;
		white-space: nowrap;
		padding-right: 8px;
	}

	.hd-table th {
		border-top: none;
		color: #666;
		font-size: 0.9rem;
		font-weight: 500;
	}

	.hd-table td {
		color: #ccc;
		white-space: nowrap;
	}

	.hd-table td:first-child {
		color: #888;
		font-size: 0.78rem;
	}

	.hd-metric-pill {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 44px;
		height: 30px;
		padding: 0 8px;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--pill-color, #3a3a3a) 70%, transparent);
		color: #d8d8d8;
		font-size: 0.78rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		line-height: 1;
		background: color-mix(in srgb, var(--pill-color, #3a3a3a) 10%, transparent);
	}
</style>
