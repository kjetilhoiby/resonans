<script lang="ts">
	import { LayerCake, Svg, Html } from 'layercake';
	import { scaleLinear } from 'd3-scale';
	import Line from './Line.svelte';
	import AxisX from './AxisX.svelte';  
	import AxisY from './AxisY.svelte';
	import Markers from './Markers.svelte';
	import { onMount } from 'svelte';

	interface WeightEvent {
		timestamp: string;
		data: {
			weight?: number;
		};
	}

	interface DataPoint {
		x: number; // Day of year (1-365)
		y: number; // Weight in kg
		series: string; // Year as string
	}

	/**
	 * Modular Weight Progress Chart Component
	 * 
	 * Modes:
	 * - 'comparison': Shows current year vs last year (2 years, optimized for comparison)
	 *   - Colors: Current year (red), Last year (blue)
	 *   - Stats: Current weight, Last year weight, Change, Trend
	 *   - Tooltip: Shows current and last year data with difference calculation
	 *   - Data: Fetches 2 years of data only
	 * 
	 * - 'historical': Shows up to maxYears of historical data (5 years default)
	 *   - Colors: Current year (red), Previous years (light gray)  
	 *   - Stats: Current weight, Min/Max, Trend
	 *   - Tooltip: Shows all available years at cursor position
	 *   - Data: Fetches maxYears of data
	 */
	
	// Component props
	export let title = 'Vektutvikling år-mot-år';
	export let mode: 'comparison' | 'historical' = 'comparison';
	export let maxYears = 5;

	let data: DataPoint[] = [];
	let loading = true;
	let currentYearWeight = 0;
	let lastYearWeight = 0;
	let weightChange = 0;
	let currentTrend = 0; // Recent trend (kg per month)
	let minWeight: { year: number; weight: number } | null = null;
	let maxWeight: { year: number; weight: number } | null = null;

	// Tooltip state
	let showTooltip = false;
	let mouseX = 0;
	let mouseY = 0;
	let tooltipData: {
		dayOfYear: number;
		years: Array<{ year: number; weight: number; hasData: boolean; isCurrentYear: boolean }>;
		difference?: number;
	} | null = null;

	onMount(async () => {
		await fetchWeightData();
	});

	async function fetchWeightData() {
		try {
			// Determine how many years to fetch based on mode
			const yearsToFetch = mode === 'comparison' ? 2 : maxYears;
			const response = await fetch(`/api/weight?years=${yearsToFetch}`);
			const weightEvents: WeightEvent[] = await response.json();

			// Process into LayerCake format
			const processedData = processWeightData(weightEvents);
			data = processedData;

			// Calculate statistics
			const currentYear = new Date().getFullYear();
			const groupedData = data.reduce((acc: Record<string, DataPoint[]>, point: DataPoint) => {
				if (!acc[point.series]) acc[point.series] = [];
				acc[point.series].push(point);
				return acc;
			}, {});

			const currentYearData = groupedData[currentYear.toString()] || [];
			const lastYearData = groupedData[(currentYear - 1).toString()] || [];

			// Get latest weights
			if (currentYearData.length > 0) {
				const latestCurrent = currentYearData[currentYearData.length - 1];
				currentYearWeight = latestCurrent.y;

				// Calculate recent trend (last 30 days worth of data)
				if (currentYearData.length > 1) {
					const recentData = currentYearData.slice(-10); // Last 10 measurements
					if (recentData.length >= 2) {
						const timeSpan = recentData[recentData.length - 1].x - recentData[0].x;
						const weightChange = recentData[recentData.length - 1].y - recentData[0].y;
						// Convert to kg per month (30 days)
						currentTrend = timeSpan > 0 ? (weightChange / timeSpan) * 30 : 0;
					}
				}
			}

			if (lastYearData.length > 0) {
				const latestLast = lastYearData[lastYearData.length - 1];
				lastYearWeight = latestLast.y;
				weightChange = currentYearWeight - lastYearWeight;
			}

			// Find min/max weights across all years
			const yearExtremes: Array<{ year: number; min: number; max: number }> = [];
			Object.keys(groupedData).forEach(yearStr => {
				const year = parseInt(yearStr);
				const yearData = groupedData[yearStr];
				if (yearData.length > 0) {
					const weights = yearData.map(d => d.y);
					const min = Math.min(...weights);
					const max = Math.max(...weights);
					yearExtremes.push({ year, min, max });
				}
			});

			if (yearExtremes.length > 0) {
				const allMins = yearExtremes.map(e => ({ year: e.year, weight: e.min }));
				const allMaxes = yearExtremes.map(e => ({ year: e.year, weight: e.max }));
				
				minWeight = allMins.reduce((min, current) => 
					current.weight < min.weight ? current : min
				);
				maxWeight = allMaxes.reduce((max, current) => 
					current.weight > max.weight ? current : max
				);
			}

			loading = false;
		} catch (err) {
			console.error('Failed to load weight data:', err);
			loading = false;
		}
	}

	function processWeightData(weightEvents: WeightEvent[]): DataPoint[] {
		const currentYear = new Date().getFullYear();
		
		// Group weight events by year
		const weightsByYear: Record<number, WeightEvent[]> = {};
		
		weightEvents.forEach(w => {
			const year = new Date(w.timestamp).getFullYear();
			if (!weightsByYear[year]) weightsByYear[year] = [];
			weightsByYear[year].push(w);
		});

		// Process years based on mode
		const allData: DataPoint[] = [];
		const availableYears = Object.keys(weightsByYear).map(Number).sort();
		
		let yearsToProcess: number[] = [];
		if (mode === 'comparison') {
			// Only current year and last year
			yearsToProcess = availableYears.slice(-2);
		} else {
			// All available years (historical mode)
			yearsToProcess = availableYears;
		}

		yearsToProcess.forEach(year => {
			const yearWeights = weightsByYear[year];
			const yearData = yearWeights
				.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
				.map(w => {
					const date = new Date(w.timestamp);
					const yearStart = new Date(date.getFullYear(), 0, 1);
					const dayOfYear = Math.floor((date.getTime() - yearStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
					
					return {
						x: dayOfYear,
						y: (w.data.weight || 0),
						series: year.toString()
					};
				});
			
			allData.push(...yearData);
		});

		return allData;
	}

	// LayerCake accessors
	const xAccessor = (d: DataPoint) => d.x;
	const yAccessor = (d: DataPoint) => d.y;
	const zAccessor = (d: DataPoint) => d.series;

	// Dynamic domains
	$: xDomain = data.length > 0 ? [1, 365] : [1, 365];
	$: yDomain = data.length > 0 ? [
		Math.min(...data.map(d => d.y)) - 2,
		Math.max(...data.map(d => d.y)) + 2
	] : [60, 100];

	// Mouse interaction handlers
	function handleMouseMove(event: MouseEvent) {
		const rect = (event.currentTarget as Element).getBoundingClientRect();
		const mouseXRelative = event.clientX - rect.left;
		const mouseYRelative = event.clientY - rect.top;

		// Convert mouse position to data coordinates (approximate)
		const dataX = ((mouseXRelative - 25) / (rect.width - 35)) * 364 + 1; // Account for padding

		// Group data by series
		const groupedData = data.reduce((acc: Record<string, DataPoint[]>, point: DataPoint) => {
			if (!acc[point.series]) acc[point.series] = [];
			acc[point.series].push(point);
			return acc;
		}, {});

		// Sort data by x value for each series
		const sortedData = Object.keys(groupedData).reduce((acc: Record<string, DataPoint[]>, series) => {
			acc[series] = groupedData[series].sort((a: DataPoint, b: DataPoint) => a.x - b.x);
			return acc;
		}, {});

		// Find closest data points for each series
		const currentYear = new Date().getFullYear();
		
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
		const yearPoints: Array<{ year: number; weight: number; hasData: boolean; isCurrentYear: boolean }> = [];
		let dayOfYear = dataX;

		availableYears.forEach(year => {
			const yearData = sortedData[year.toString()] || [];
			const point = findClosest(yearData, dataX);
			
			if (point) {
				dayOfYear = point.x; // Use actual data point day
			}
			
			yearPoints.push({
				year,
				weight: point?.y || 0,
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
				tooltipData.difference = currentYearData.weight - lastYearData.weight;
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
</script>

<div class="weight-progress">
	<div class="header">
		<h2>⚖️ {title}</h2>
		{#if !loading}
			<div class="stats">
				<!-- Always show current weight -->
				<div class="stat-group">
					<span class="stat-main">{currentYearWeight.toFixed(1)} kg</span>
					<span class="stat-label">Nå</span>
				</div>
				
				{#if mode === 'comparison'}
					<!-- Comparison mode: show last year and change -->
					{#if lastYearWeight > 0}
						<div class="stat-group">
							<span class="stat-main">{lastYearWeight.toFixed(1)} kg</span>
							<span class="stat-label">I fjor</span>
						</div>
						<div class="stat-group" class:positive={weightChange <= 0} class:negative={weightChange > 0}>
							<span class="stat-main">
								{weightChange >= 0 ? '+' : ''}{weightChange.toFixed(1)} kg
							</span>
							<span class="stat-label">Endring</span>
						</div>
					{/if}
				{:else}
					<!-- Historical mode: show min/max -->
					{#if minWeight}
						<div class="stat-group">
							<span class="stat-main">{minWeight.weight.toFixed(1)} kg</span>
							<span class="stat-label">Lavest ({minWeight.year})</span>
						</div>
					{/if}
					{#if maxWeight}
						<div class="stat-group">
							<span class="stat-main">{maxWeight.weight.toFixed(1)} kg</span>
							<span class="stat-label">Høyest ({maxWeight.year})</span>
						</div>
					{/if}
				{/if}
				
				<!-- Always show trend if available -->
				{#if Math.abs(currentTrend) > 0.01}
					<div class="stat-group trend" class:positive={currentTrend <= 0} class:negative={currentTrend > 0}>
						<span class="stat-main">
							{currentTrend >= 0 ? '+' : ''}{currentTrend.toFixed(1)} kg/mnd
						</span>
						<span class="stat-label">Trend</span>
					</div>
				{/if}
			</div>
		{/if}
	</div>

	{#if loading}
		<div class="loading">Laster vektdata...</div>
	{:else if data.length === 0}
		<div class="empty">Ingen vektdata funnet</div>
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
				padding={{ top: 8, right: 10, bottom: 20, left: 35 }}
			>
				<Svg>
					<AxisX />
					<AxisY />
					<Line {mode} />
					<Markers />
				</Svg>

				<Html>
					<div 
						class="chart-overlay"
						on:mousemove={handleMouseMove}
						on:mouseleave={handleMouseLeave}
						role="img"
						aria-label="Interaktivt vektdiagram"
					>
						{#if showTooltip}
							<div class="crosshair-v" style="left: {mouseX}px;"></div>
							<div class="crosshair-h" style="top: {mouseY}px;"></div>
							
							{#if tooltipData}
								<div 
									class="tooltip" 
									style="left: {Math.min(mouseX + 10, 600)}px; top: {Math.max(mouseY - 10, 10)}px;"
								>
									<div class="tooltip-header">
										{dayOfYearToDate(tooltipData.dayOfYear)}
									</div>
									
									{#if mode === 'comparison'}
										<!-- Show only current and last year in comparison mode -->
										{#each tooltipData.years.slice(0, 2) as yearData}
											<div class="tooltip-row">
												<span class="year-label" style="color: {yearData.isCurrentYear ? '#dc2626' : '#2563eb'}; font-weight: {yearData.isCurrentYear ? '600' : '400'};">
													{yearData.year}:
												</span>
												<span class="weight" style="font-weight: {yearData.isCurrentYear ? '600' : '400'};">
													{yearData.hasData 
														? `${yearData.weight.toFixed(1)} kg`
														: 'Ingen data'
													}
												</span>
											</div>
										{/each}
										
										{#if tooltipData.difference !== undefined}
											<div class="tooltip-divider"></div>
											<div class="tooltip-row difference" class:positive={tooltipData.difference <= 0} class:negative={tooltipData.difference > 0}>
												<span class="diff-label">Forskjell:</span>
												<span class="diff-value">
													{tooltipData.difference >= 0 ? '+' : ''}{tooltipData.difference.toFixed(1)} kg
												</span>
											</div>
										{/if}
									{:else}
										<!-- Show all years in historical mode -->
										{#each tooltipData.years as yearData}
											<div class="tooltip-row">
												<span class="year-label" style="color: {yearData.isCurrentYear ? '#dc2626' : '#6b7280'}; font-weight: {yearData.isCurrentYear ? '600' : '400'};">
													{yearData.year}:
												</span>
												<span class="weight" style="font-weight: {yearData.isCurrentYear ? '600' : '400'};">
													{yearData.hasData 
														? `${yearData.weight.toFixed(1)} kg`
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
	.weight-progress {
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
		gap: 0.25rem;
		min-width: 80px;
	}

	.stat-main {
		font-size: 1.125rem;
		font-weight: 600;
		color: #1f2937;
	}

	.stat-label {
		font-size: 0.75rem;
		color: #6b7280;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.positive .stat-main {
		color: #059669;
	}

	.negative .stat-main {
		color: #dc2626;
	}

	.trend .stat-main {
		font-size: 1rem;
	}

	.chart-container {
		height: 400px;
		position: relative;
	}

	.chart-overlay {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		pointer-events: all;
	}

	.crosshair-v, .crosshair-h {
		position: absolute;
		pointer-events: none;
		z-index: 10;
	}

	.crosshair-v {
		width: 1px;
		height: 100%;
		background: rgba(107, 114, 128, 0.3);
		top: 0;
	}

	.crosshair-h {
		width: 100%;
		height: 1px;
		background: rgba(107, 114, 128, 0.3);
		left: 0;
	}

	.tooltip {
		position: absolute;
		background: rgba(0, 0, 0, 0.9);
		color: white;
		padding: 0.75rem;
		border-radius: 6px;
		font-size: 0.875rem;
		pointer-events: none;
		z-index: 20;
		min-width: 140px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
	}

	.tooltip-header {
		font-weight: 600;
		margin-bottom: 0.5rem;
		color: #d1d5db;
		text-align: center;
		border-bottom: 1px solid #374151;
		padding-bottom: 0.25rem;
	}

	.tooltip-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.25rem;
	}

	.tooltip-row:last-child {
		margin-bottom: 0;
	}

	.year-label {
		font-weight: 500;
	}

	.weight {
		text-align: right;
	}

	.tooltip-divider {
		height: 1px;
		background: #374151;
		margin: 0.5rem 0;
	}

	.difference {
		border-top: 1px solid #374151;
		padding-top: 0.5rem;
		margin-top: 0.5rem;
		font-weight: 500;
	}

	.difference.positive .diff-value {
		color: #10b981;
	}

	.difference.negative .diff-value {
		color: #ef4444;
	}

	.loading, .empty {
		text-align: center;
		padding: 2rem;
		color: #6b7280;
		font-style: italic;
	}

	@media (max-width: 640px) {
		.weight-progress {
			padding: 0.75rem;
		}

		.header {
			gap: 0.75rem;
		}

		h2 {
			font-size: 1.125rem;
		}

		.stats {
			gap: 0.75rem;
			justify-content: space-around;
		}

		.stat-group {
			min-width: 70px;
		}

		.stat-main {
			font-size: 1rem;
		}

		.stat-label {
			font-size: 0.6875rem;
		}

		.chart-container {
			height: 300px;
		}

		.tooltip {
			font-size: 0.8125rem;
			padding: 0.625rem;
			min-width: 120px;
		}
	}

	:global(.chart-container .layercake-container) {
		height: 100%;
	}
</style>