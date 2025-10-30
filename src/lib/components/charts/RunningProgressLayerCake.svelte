<script lang="ts">
	import { LayerCake, Svg, Html } from 'layercake';
	import { scaleLinear } from 'd3-scale';
	import Line from './Line.svelte';
	import AxisX from './AxisX.svelte';  
	import AxisY from './AxisY.svelte';
	import Markers from './Markers.svelte';
	import { onMount } from 'svelte';

	interface Workout {
		timestamp: string;
		data: {
			distance?: number;
			sportType?: string;
		};
	}

	interface DataPoint {
		x: number; // Day of year (1-365)
		y: number; // Cumulative distance
		series: string; // Year as string
	}

	/**
	 * Modular Running Progress Chart Component
	 * 
	 * Modes:
	 * - 'comparison': Shows current year vs last year (2 years, optimized for comparison)
	 *   - Colors: Current year (red), Last year (blue)
	 *   - Stats: Current total, Last year total, Difference %, Projection
	 *   - Tooltip: Shows current and last year data with difference calculation
	 *   - Data: Fetches 2 years of data only
	 * 
	 * - 'historical': Shows up to maxYears of historical data (5 years default)
	 *   - Colors: Current year (red), Previous years (light gray)  
	 *   - Stats: Current total, Best year performance, Projection
	 *   - Tooltip: Shows all available years at cursor position
	 *   - Data: Fetches maxYears of data
	 * 
	 * Both modes maintain:
	 * - LayerCake responsive design
	 * - Interactive tooltips with scrubbing
	 * - "Now" marker and projection line
	 * - Mobile-responsive layout
	 */
	
	// Component props
	export let title = 'Akkumulert løpedistanse';
	export let mode: 'comparison' | 'historical' = 'comparison'; // comparison = current vs last year, historical = all years
	export let maxYears = 5; // Only used in historical mode

	let data: DataPoint[] = [];
	let loading = true;
	let currentYearTotal = 0;
	let lastYearTotal = 0;
	let difference = 0;
	let projectedTotal = 0;
	let bestYear: { year: number; distance: number } | null = null;
	
	// Tooltip state
	let mouseX = 0;
	let mouseY = 0;
	let showTooltip = false;
	let tooltipData: {
		dayOfYear: number;
		years: Array<{ year: number; distance: number; hasData: boolean; isCurrentYear: boolean }>;
		difference?: number;
		percentDifference?: number;
	} | null = null;

	let mounted = false;

	onMount(() => {
		mounted = true;
		fetchWorkoutData();
	});

	// Refetch when mode or maxYears changes
	$: if (mounted && (mode || maxYears)) {
		fetchWorkoutData();
	}

	async function fetchWorkoutData() {
		try {
			// Determine how many years to fetch based on mode
			const yearsToFetch = mode === 'comparison' ? 2 : maxYears;
			const response = await fetch(`/api/workouts/cumulative-running?years=${yearsToFetch}`);
			const workouts: Workout[] = await response.json();			// Process into cumulative data for LayerCake
			data = processCumulativeData(workouts);
			
			// Calculate stats
			const currentYear = new Date().getFullYear();
			const currentYearData = data.filter(d => d.series === currentYear.toString()).sort((a, b) => a.x - b.x);
			const lastYearData = data.filter(d => d.series === (currentYear - 1).toString()).sort((a, b) => a.x - b.x);
			
			currentYearTotal = currentYearData[currentYearData.length - 1]?.y || 0;
			
			// Find last year data at same day-of-year
			const today = new Date();
			const yearStart = new Date(today.getFullYear(), 0, 1);
			const currentDayOfYear = Math.floor((today.getTime() - yearStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
			const lastYearAtSameTime = lastYearData.find(d => Math.abs(d.x - currentDayOfYear) <= 1);
			
			lastYearTotal = lastYearAtSameTime?.y || lastYearData[lastYearData.length - 1]?.y || 0;
			
			if (lastYearTotal > 0) {
				difference = ((currentYearTotal - lastYearTotal) / lastYearTotal) * 100;
			}

			// Gruppér data for videre beregninger
			const groupedData = data.reduce((acc: Record<string, DataPoint[]>, point: DataPoint) => {
				if (!acc[point.series]) acc[point.series] = [];
				acc[point.series].push(point);
				return acc;
			}, {});

			// Calculate year-end projection using existing currentYearData
			if (currentYearData.length > 1) {
				const recentData = currentYearData.slice(-8); // Last 8 data points
				if (recentData.length >= 2) {
					const timeSpan = recentData[recentData.length - 1].x - recentData[0].x;
					const distanceGain = recentData[recentData.length - 1].y - recentData[0].y;
					const dailyRate = timeSpan > 0 ? distanceGain / timeSpan : 0;
					
					const latestMeasurement = currentYearData[currentYearData.length - 1];
					const daysRemaining = 365 - latestMeasurement.x;
					projectedTotal = Math.max(latestMeasurement.y + (dailyRate * daysRemaining), latestMeasurement.y);
				}
			}
			
			// Find best year (highest total distance)
			const yearTotals: Array<{ year: number; distance: number }> = [];
			Object.keys(groupedData).forEach(yearStr => {
				const year = parseInt(yearStr);
				const yearData = groupedData[yearStr].sort((a: DataPoint, b: DataPoint) => a.x - b.x);
				if (yearData.length > 0) {
					const total = yearData[yearData.length - 1].y;
					yearTotals.push({ year, distance: total });
				}
			});
			
			if (yearTotals.length > 0) {
				bestYear = yearTotals.reduce((best, current) => 
					current.distance > best.distance ? current : best
				);
			}
			
			loading = false;
		} catch (err) {
			console.error('Failed to load running data:', err);
			loading = false;
		}
	}

	function processCumulativeData(workouts: Workout[]): DataPoint[] {
		const currentYear = new Date().getFullYear();
		
		// Group workouts by year
		const workoutsByYear: Record<number, Workout[]> = {};
		
		workouts.forEach(w => {
			const year = new Date(w.timestamp).getFullYear();
			if (!workoutsByYear[year]) workoutsByYear[year] = [];
			workoutsByYear[year].push(w);
		});

		// Calculate cumulative for each year using day-of-year as x-coordinate
		function toCumulative(workouts: Workout[], year: number, seriesName: string): DataPoint[] {
			const result: DataPoint[] = [
				{ x: 1, y: 0, series: seriesName } // Start at day 1
			];
			
			// Sort workouts by date
			const sortedWorkouts = workouts.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
			
			let sum = 0;
			sortedWorkouts.forEach((w) => {
				sum += (w.data.distance || 0) / 1000; // meters to km
				
				// Calculate day of year (1-365/366)
				const date = new Date(w.timestamp);
				const yearStart = new Date(date.getFullYear(), 0, 1);
				const dayOfYear = Math.floor((date.getTime() - yearStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
				
				result.push({
					x: dayOfYear,
					y: sum,
					series: seriesName
				});
			});
			
			return result;
		}

		// Process years based on mode
		const allData: DataPoint[] = [];
		const yearsToShow = mode === 'comparison'
			? [currentYear - 1, currentYear]
			: Array.from({ length: maxYears }, (_, i) => currentYear - (maxYears - 1) + i);

		yearsToShow.forEach(year => {
			const yearWorkouts = workoutsByYear[year] || [];
			if (yearWorkouts.length > 0) {
				allData.push(...toCumulative(yearWorkouts, year, year.toString()));
			} else {
				// Legg inn en tom linje for år uten data
				allData.push({ x: 1, y: 0, series: year.toString() });
			}
		});

		return allData;
	}

	// LayerCake accessors - defining how to read x and y values
	const xAccessor = 'x';
	const yAccessor = 'y';
	const zAccessor = 'series';

	// Create proper domain for the scales (day-of-year: 1-365)
	$: xDomain = [1, 365]; // Always full year range
	$: yDomain = data.length ? [0, Math.max(...data.map(d => d.y)) * 1.05] : [0, 100]; // Add 5% padding at top
	
	// Tooltip functions
	function handleMouseMove(event: MouseEvent) {
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		const mouseXRelative = event.clientX - rect.left;
		const mouseYRelative = event.clientY - rect.top;

		// Convert mouse position to day of year using xDomain
		const dataX = ((mouseXRelative / rect.width) * (xDomain[1] - xDomain[0])) + xDomain[0];
		
		// Group data by series for lookup
		const groupedData = data.reduce((acc: Record<string, DataPoint[]>, d) => {
			if (!acc[d.series]) acc[d.series] = [];
			acc[d.series].push(d);
			return acc;
		}, {});

		// Sort data by x value for each series
		const sortedData = Object.keys(groupedData).reduce((acc: Record<string, DataPoint[]>, series) => {
			acc[series] = groupedData[series].sort((a: DataPoint, b: DataPoint) => a.x - b.x);
			return acc;
		}, {});

		// Find closest data points for each series
		const currentYear = new Date().getFullYear();
		const lastYear = currentYear - 1;
		
		const currentYearData = sortedData[currentYear.toString()] || [];
		const lastYearData = sortedData[lastYear.toString()] || [];
		
		// Get all available years for tooltip
		const availableYears = Object.keys(sortedData).map(Number).sort((a, b) => b - a);

		// Find closest points by day-of-year
		const findClosest = (data: DataPoint[], targetX: number): DataPoint | null => {
			if (!data.length) return null;
			return data.reduce((closest: DataPoint, point: DataPoint) => {
				return Math.abs(point.x - targetX) < Math.abs(closest.x - targetX) ? point : closest;
			});
		};

		// Find closest points for all available years
		const yearPoints: Array<{ year: number; distance: number; hasData: boolean; isCurrentYear: boolean }> = [];
		let dayOfYear = dataX;

		availableYears.forEach(year => {
			const yearData = sortedData[year.toString()] || [];
			const point = findClosest(yearData, dataX);
			
			if (point) {
				dayOfYear = point.x; // Use actual data point day
			}
			
			yearPoints.push({
				year,
				distance: point?.y || 0,
				hasData: !!point,
				isCurrentYear: year === currentYear
			});
		});

		if (yearPoints.some(p => p.hasData)) {
			tooltipData = {
				dayOfYear: Math.round(dayOfYear),
				years: yearPoints
			};

			// Calculate difference between current year and last year
			const currentYearData = yearPoints.find(p => p.year === currentYear);
			const lastYearData = yearPoints.find(p => p.year === currentYear - 1);
			
			if (currentYearData?.hasData && lastYearData?.hasData) {
				tooltipData.difference = currentYearData.distance - lastYearData.distance;
				tooltipData.percentDifference = lastYearData.distance > 0 
					? ((tooltipData.difference / lastYearData.distance) * 100) 
					: 0;
			}

			mouseX = mouseXRelative;
			mouseY = mouseYRelative;
			showTooltip = true;
		}
	}

	function handleMouseLeave() {
		showTooltip = false;
	}

	// Convert day of year to readable date
	function dayOfYearToDate(dayOfYear: number, year = 2024): string {
		const date = new Date(year, 0, dayOfYear);
		return date.toLocaleDateString('no-NO', { day: 'numeric', month: 'short' });
	}

	$: if (!loading) {
		// Kall fetchWorkoutData når mode eller maxYears endres
		fetchWorkoutData();
	}
</script>

<div class="running-progress">
	<div class="header">
		<h2>🏃‍♂️ Løpsdistanse år-mot-år</h2>
		{#if !loading}
			<div class="stats">
				<!-- Always show current year -->
				<div class="stat-group">
					<span class="stat-main">{currentYearTotal.toFixed(1)} km</span>
					<span class="stat-label">I år</span>
				</div>
				
				{#if mode === 'comparison'}
					<!-- Comparison mode: show last year and diff -->
					<div class="stat-group">
						<span class="stat-main">{lastYearTotal.toFixed(1)} km</span>
						<span class="stat-label">I fjor</span>
					</div>
					<div class="stat-group" class:positive={difference >= 0} class:negative={difference < 0}>
						<span class="stat-main">
							{difference >= 0 ? '+' : ''}{difference.toFixed(1)}%
						</span>
						<span class="stat-label">Diff</span>
					</div>
				{:else}
					<!-- Historical mode: show best year -->
					{#if bestYear}
						<div class="stat-group best-year">
							<span class="stat-main">{bestYear.distance.toFixed(0)} km</span>
							<span class="stat-label">Beste ({bestYear.year})</span>
						</div>
					{/if}
				{/if}
				
				<!-- Always show projection if available -->
				{#if projectedTotal > 0}
					<div class="stat-group projection">
						<span class="stat-main">~{projectedTotal.toFixed(0)} km</span>
						<span class="stat-label">Prognose</span>
					</div>
				{/if}
			</div>
		{/if}
	</div>

	{#if loading}
		<div class="loading">Laster data...</div>
	{:else if data.length === 0}
		<div class="empty">Ingen løpedata funnet</div>
	{:else}
		<div class="chart-container">
			<LayerCake
				{data}
				x={xAccessor}
				y={yAccessor}
				z={zAccessor}
				xDomain={xDomain}
				yDomain={yDomain}
				xScale={scaleLinear()}
				yScale={scaleLinear()}
				padding={{ top: 8, right: 10, bottom: 20, left: 25 }}
			>
				<Svg>
					<AxisX />
					<AxisY />
					<Line {mode} />
					<Markers />
				</Svg>

				<Html>
					<!-- Tooltip overlay -->
					<div 
						class="tooltip-overlay"
						on:mousemove={handleMouseMove}
						on:mouseleave={handleMouseLeave}
						role="img"
						aria-label="Interactive chart tooltip"
					>
						{#if showTooltip}
							<div class="crosshair" style="left: {mouseX}px;"></div>
							
							{#if tooltipData}
								<div 
									class="tooltip" 
									style="left: {Math.min(mouseX + 10, 600)}px; top: {Math.max(mouseY - 10, 10)}px;"
								>
									<div class="tooltip-header">
										{dayOfYearToDate(tooltipData.dayOfYear)}
									</div>
									
									{#if mode === 'comparison'}
										<!-- Comparison mode: show only current year and last year -->
										{#each tooltipData.years.slice(0, 2) as yearData}
											<div class="tooltip-row">
												<span class="year-label" style="color: {yearData.isCurrentYear ? '#dc2626' : '#2563eb'}; font-weight: 600;">
													{yearData.year}:
												</span>
												<span class="distance" style="font-weight: 600;">
													{yearData.hasData 
														? `${yearData.distance.toFixed(1)} km`
														: 'Ingen data'
													}
												</span>
											</div>
										{/each}
										
										{#if tooltipData.difference !== undefined}
											<div class="tooltip-divider"></div>
											<div class="tooltip-row difference" class:positive={tooltipData.difference >= 0} class:negative={tooltipData.difference < 0}>
												<span class="diff-label">Forskjell:</span>
												<span class="diff-value">
													{tooltipData.difference >= 0 ? '+' : ''}{tooltipData.difference.toFixed(1)} km
													({tooltipData.percentDifference !== undefined && tooltipData.percentDifference >= 0 ? '+' : ''}{tooltipData.percentDifference?.toFixed(1)}%)
												</span>
											</div>
										{/if}
									{:else}
										<!-- Historical mode: show all years -->
										{#each tooltipData.years as yearData}
											<div class="tooltip-row">
												<span class="year-label" style="color: {yearData.isCurrentYear ? '#dc2626' : '#6b7280'}; font-weight: {yearData.isCurrentYear ? '600' : '400'};">
													{yearData.year}:
												</span>
												<span class="distance" style="font-weight: {yearData.isCurrentYear ? '600' : '400'};">
													{yearData.hasData 
														? `${yearData.distance.toFixed(1)} km`
														: 'Ingen data'
													}
												</span>
											</div>
										{/each}
									{/if}
								</div>
							{/if}
						{/if}
					</div>
					

				</Html>
			</LayerCake>
		</div>
	{/if}
</div>

<style>
	.running-progress {
		background: white;
		border-radius: 8px;
		padding: 1rem;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
	}

	.header {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		margin-bottom: 1rem;
	}

	h2 {
		font-size: 1.25rem;
		font-weight: 600;
		color: #1f2937;
		margin: 0;
	}

	.stats {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: center;
	}

	.stat-group {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		min-width: 0;
		flex-shrink: 1;
	}

	.stat-main {
		font-size: 1.25rem;
		font-weight: 700;
		color: #1f2937;
		line-height: 1.1;
		white-space: nowrap;
	}

	.stat-label {
		font-size: 0.7rem;
		color: #6b7280;
		margin-top: 0.25rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		white-space: nowrap;
	}

	.stat-group.positive .stat-main {
		color: #16a34a;
	}

	.stat-group.negative .stat-main {
		color: #dc2626;
	}

	.stat-group.projection .stat-main {
		color: #6b7280;
		opacity: 0.8;
	}

	.loading, .empty {
		text-align: center;
		color: #6b7280;
		padding: 2rem;
	}

	.chart-container {
		width: 100%;
		height: 350px;
		position: relative;
	}

	:global(.chart-container .layercake-container) {
		cursor: crosshair;
	}

	.tooltip-overlay {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		cursor: crosshair;
		z-index: 10;
	}

	.crosshair {
		position: absolute;
		top: 0;
		width: 1px;
		height: 100%;
		background-color: #6b7280;
		pointer-events: none;
		z-index: 15;
	}

	.tooltip {
		position: absolute;
		background: rgba(255, 255, 255, 0.96);
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		padding: 10px 14px;
		font-size: 13px;
		box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15);
		pointer-events: none;
		z-index: 20;
		min-width: 200px;
		max-width: 280px;
		backdrop-filter: blur(6px);
	}

	.tooltip-header {
		font-weight: 600;
		color: #374151;
		margin-bottom: 6px;
		text-align: center;
		border-bottom: 1px solid #f3f4f6;
		padding-bottom: 4px;
	}

	.tooltip-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin: 4px 0;
	}

	.year-label {
		font-weight: 500;
	}

	.distance {
		font-weight: 400;
		color: #6b7280;
	}

	.tooltip-divider {
		height: 1px;
		background: #f3f4f6;
		margin: 6px 0;
	}

	.difference {
		font-weight: 500;
		padding-top: 2px;
	}

	.difference.positive {
		color: #16a34a;
	}

	.difference.negative {
		color: #dc2626;
	}

	.diff-label {
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.025em;
	}

	.diff-value {
		font-weight: 600;
	}



	@media (max-width: 640px) {
		.stats {
			gap: 0.75rem;
		}

		.stat-main {
			font-size: 1.1rem;
		}

		.stat-label {
			font-size: 0.65rem;
		}

		.chart-container {
			height: 280px;
		}

		h2 {
			font-size: 1.1rem;
		}
	}

	@media (max-width: 480px) {
		.stats {
			gap: 0.25rem;
			flex-direction: row;
			justify-content: space-around;
		}

		.stat-group {
			flex: 1;
			max-width: 22%;
		}

		.stat-main {
			font-size: 0.9rem;
		}

		.stat-label {
			font-size: 0.55rem;
		}
	}
</style>