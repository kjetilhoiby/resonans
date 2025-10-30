<script lang="ts">
	import { LayerCake, Svg, Html } from 'layercake';
	import { scaleTime, scaleLinear } from 'd3-scale';
	import { line, area, curveMonotoneX } from 'd3-shape';
	import { onMount } from 'svelte';

	interface Workout {
		timestamp: string;
		data: {
			distance?: number;
			sportType?: string;
		};
	}

	interface DataPoint {
		date: Date;
		distance: number;
		year: number;
	}

	let data2024: DataPoint[] = [];
	let data2025: DataPoint[] = [];
	let loading = true;

	onMount(async () => {
		await fetchCumulativeRunningData();
	});

	async function fetchCumulativeRunningData() {
		try {
			const res = await fetch('/api/workouts/cumulative-running');
			const workouts: Workout[] = await res.json();

			// Process into cumulative data
			const { thisYear, lastYear } = processCumulativeData(workouts);
			data2025 = thisYear;
			data2024 = lastYear;
			
			loading = false;
		} catch (err) {
			console.error('Failed to load running data:', err);
			loading = false;
		}
	}

	function processCumulativeData(workouts: Workout[]) {
		const currentYear = new Date().getFullYear();
		const lastYear = currentYear - 1;

		// Separate by year
		const thisYearWorkouts = workouts
			.filter((w) => new Date(w.timestamp).getFullYear() === currentYear)
			.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

		const lastYearWorkouts = workouts
			.filter((w) => new Date(w.timestamp).getFullYear() === lastYear)
			.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

		// Calculate cumulative
		function toCumulative(workouts: Workout[], year: number): DataPoint[] {
			const result: DataPoint[] = [
				{ date: new Date(year, 0, 1), distance: 0, year }
			];
			
			let sum = 0;
			workouts.forEach((w) => {
				sum += (w.data.distance || 0) / 1000; // meters to km
				result.push({
					date: new Date(w.timestamp),
					distance: sum,
					year
				});
			});
			
			return result;
		}

		return {
			thisYear: toCumulative(thisYearWorkouts, currentYear),
			lastYear: toCumulative(lastYearWorkouts, lastYear)
		};
	}

	// Calculate scales
	$: allData = [...data2024, ...data2025];
	$: maxDistance = Math.max(...allData.map((d) => d.distance), 100); // At least 100km
	$: yScale = (distance: number) => chartHeight - (distance / maxDistance) * chartHeight;
	$: xScale = (date: Date) => {
		const yearStart = new Date(new Date().getFullYear(), 0, 1);
		const yearEnd = new Date(new Date().getFullYear(), 11, 31);
		const totalMs = yearEnd.getTime() - yearStart.getTime();
		const dateMs = date.getTime() - yearStart.getTime();
		return (dateMs / totalMs) * chartWidth;
	};

	// Convert data points to SVG path
	function toPath(dataPoints: DataPoint[]): string {
		if (dataPoints.length === 0) return '';
		
		return dataPoints
			.map((d, i) => {
				const x = xScale(d.date);
				const y = yScale(d.distance);
				return `${i === 0 ? 'M' : 'L'} ${x},${y}`;
			})
			.join(' ');
	}

	// Current stats
	$: currentDistance = data2025[data2025.length - 1]?.distance || 0;
	$: lastYearSameDate = (() => {
		const now = new Date();
		const match = data2024.find((d) => {
			const date = new Date(d.date);
			return date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
		});
		return match?.distance || data2024[data2024.length - 1]?.distance || 0;
	})();
	$: difference = currentDistance - lastYearSameDate;
	$: percentChange = lastYearSameDate > 0 ? (difference / lastYearSameDate) * 100 : 0;
</script>

<div class="running-progress">
	<div class="header">
		<h2>🏃‍♂️ Løpsdistanse år-mot-år</h2>
		{#if !loading}
			<div class="stats">
				<div class="stat">
					<span class="label">Hittil i år</span>
					<span class="value">{currentDistance.toFixed(1)} km</span>
				</div>
				<div class="stat">
					<span class="label">Samme tid i fjor</span>
					<span class="value">{lastYearSameDate.toFixed(1)} km</span>
				</div>
				<div class="stat" class:positive={difference >= 0} class:negative={difference < 0}>
					<span class="label">Forskjell</span>
					<span class="value">
						{difference >= 0 ? '+' : ''}{difference.toFixed(1)} km
						({percentChange >= 0 ? '+' : ''}{percentChange.toFixed(1)}%)
					</span>
				</div>
			</div>
		{/if}
	</div>

	{#if loading}
		<div class="loading">Laster data...</div>
	{:else if allData.length === 0}
		<div class="empty">Ingen løpedata funnet</div>
	{:else}
		<div class="chart-container" bind:clientWidth={svgWidth}>
			<svg width={svgWidth} height={svgHeight}>
				<g transform="translate({padding.left}, {padding.top})">
					<!-- Grid lines -->
					{#each [0, 0.25, 0.5, 0.75, 1] as tick}
						<line
							x1="0"
							y1={tick * chartHeight}
							x2={chartWidth}
							y2={tick * chartHeight}
							stroke="#e5e7eb"
							stroke-width="1"
							stroke-dasharray="4,4"
						/>
					{/each}

					<!-- Y-axis labels -->
					{#each [0, 0.25, 0.5, 0.75, 1] as tick}
						<text
							x="-10"
							y={tick * chartHeight}
							text-anchor="end"
							dominant-baseline="middle"
							fill="#6b7280"
							font-size="12"
						>
							{((1 - tick) * maxDistance).toFixed(0)} km
						</text>
					{/each}

					<!-- X-axis months -->
					{#each ['Jan', 'Feb', 'Mar', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Des'] as month, i}
						<text
							x={(i / 11) * chartWidth}
							y={chartHeight + 25}
							text-anchor="middle"
							fill="#6b7280"
							font-size="12"
						>
							{month}
						</text>
					{/each}

					<!-- Last year line (2024) -->
					<path
						d={toPath(data2024)}
						fill="none"
						stroke="#cbd5e1"
						stroke-width="2"
						opacity="0.6"
					/>

					<!-- This year area (2025) -->
					{#if data2025.length > 0}
						<path
							d="{toPath(data2025)} L {xScale(data2025[data2025.length - 1].date)},{chartHeight} L 0,{chartHeight} Z"
							fill="#3b82f6"
							opacity="0.1"
						/>
					{/if}

					<!-- This year line (2025) -->
					<path
						d={toPath(data2025)}
						fill="none"
						stroke="#3b82f6"
						stroke-width="3"
					/>
				</g>

				<!-- Legend -->
				<g transform="translate({svgWidth - padding.right - 150}, {padding.top})">
					<rect width="140" height="50" fill="white" stroke="#e5e7eb" rx="4" />
					<line x1="10" y1="18" x2="35" y2="18" stroke="#3b82f6" stroke-width="3" />
					<text x="40" y="18" dominant-baseline="middle" fill="#374151" font-size="13">
						2025
					</text>
					<line x1="10" y1="35" x2="35" y2="35" stroke="#cbd5e1" stroke-width="2" opacity="0.6" />
					<text x="40" y="35" dominant-baseline="middle" fill="#374151" font-size="13">
						2024
					</text>
				</g>
			</svg>
		</div>
	{/if}
</div>

<style>
	.running-progress {
		background: white;
		border-radius: 12px;
		padding: 1.5rem;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
	}

	.header {
		margin-bottom: 2rem;
	}

	h2 {
		font-size: 1.5rem;
		font-weight: 600;
		margin: 0 0 1rem 0;
		color: #111827;
	}

	.stats {
		display: flex;
		gap: 2rem;
		flex-wrap: wrap;
	}

	.stat {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.stat .label {
		font-size: 0.875rem;
		color: #6b7280;
	}

	.stat .value {
		font-size: 1.25rem;
		font-weight: 600;
		color: #111827;
	}

	.stat.positive .value {
		color: #059669;
	}

	.stat.negative .value {
		color: #dc2626;
	}

	.chart-container {
		width: 100%;
		height: 400px;
		position: relative;
	}

	.loading,
	.empty {
		padding: 4rem;
		text-align: center;
		color: #6b7280;
	}

	.y-axis {
		position: absolute;
		left: 0;
		top: 0;
		bottom: 40px;
		width: 60px;
	}

	.y-label {
		position: absolute;
		right: 10px;
		transform: translateY(-50%);
		font-size: 0.75rem;
		color: #6b7280;
		text-align: right;
	}

	.x-axis {
		position: absolute;
		bottom: 0;
		left: 60px;
		right: 20px;
		height: 40px;
		display: flex;
		justify-content: space-between;
	}

	.x-label {
		font-size: 0.75rem;
		color: #6b7280;
		transform: translateX(-50%);
	}

	.legend {
		position: absolute;
		top: 10px;
		right: 30px;
		display: flex;
		gap: 1rem;
		background: white;
		padding: 0.5rem;
		border-radius: 6px;
		border: 1px solid #e5e7eb;
	}

	.legend-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
		color: #6b7280;
	}

	.legend-line {
		width: 24px;
		height: 3px;
		border-radius: 2px;
	}
</style>
