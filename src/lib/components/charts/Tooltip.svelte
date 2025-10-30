<script>
	import { getContext } from 'svelte';

	const { data, xGet, yGet, zGet, width, height, xScale, yScale } = getContext('LayerCake');

	let mouseX = 0;
	let mouseY = 0;
	let showTooltip = false;
	let tooltipData = null;

	// Group data by series for easy lookup
	$: groupedData = $data.reduce((acc, d) => {
		const series = $zGet(d);
		if (!acc[series]) acc[series] = [];
		acc[series].push(d);
		return acc;
	}, {});

	// Sort data by x value for each series
	$: sortedData = Object.keys(groupedData).reduce((acc, series) => {
		acc[series] = groupedData[series].sort((a, b) => a.x - b.x);
		return acc;
	}, {});

	function handleMouseMove(event) {
		const rect = event.currentTarget.getBoundingClientRect();
		const mouseXRelative = event.clientX - rect.left;
		const mouseYRelative = event.clientY - rect.top;

		// Convert mouse position to data space
		const dataX = $xScale.invert(mouseXRelative);
		
		// Find closest data points for each series
		const currentYear = new Date().getFullYear();
		const lastYear = currentYear - 1;
		
		const currentYearData = sortedData[currentYear.toString()] || [];
		const lastYearData = sortedData[lastYear.toString()] || [];

		// Find closest points by day-of-year
		const findClosest = (data, targetX) => {
			if (!data.length) return null;
			return data.reduce((closest, point) => {
				return Math.abs(point.x - targetX) < Math.abs(closest.x - targetX) ? point : closest;
			});
		};

		const currentPoint = findClosest(currentYearData, dataX);
		const lastYearPoint = findClosest(lastYearData, dataX);

		if (currentPoint || lastYearPoint) {
			// Use the day from whichever point exists (prefer current year)
			const dayOfYear = currentPoint?.x || lastYearPoint?.x || dataX;
			
			tooltipData = {
				dayOfYear: Math.round(dayOfYear),
				currentYear: {
					year: currentYear,
					distance: currentPoint?.y || 0,
					hasData: !!currentPoint
				},
				lastYear: {
					year: lastYear,
					distance: lastYearPoint?.y || 0,
					hasData: !!lastYearPoint
				}
			};

			// Calculate difference
			if (tooltipData.currentYear.hasData && tooltipData.lastYear.hasData) {
				tooltipData.difference = tooltipData.currentYear.distance - tooltipData.lastYear.distance;
				tooltipData.percentDifference = tooltipData.lastYear.distance > 0 
					? ((tooltipData.difference / tooltipData.lastYear.distance) * 100) 
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
	function dayOfYearToDate(dayOfYear, year = 2024) {
		const date = new Date(year, 0, dayOfYear);
		return date.toLocaleDateString('no-NO', { day: 'numeric', month: 'short' });
	}
</script>

<!-- Invisible overlay for mouse events -->
<div 
	class="tooltip-overlay"
	on:mousemove={handleMouseMove}
	on:mouseleave={handleMouseLeave}
	role="img"
	aria-label="Interactive chart tooltip"
></div>

<!-- Vertical line indicator -->
{#if showTooltip}
	<div 
		class="crosshair" 
		style="left: {mouseX}px;"
	></div>
{/if}

<!-- Tooltip -->
{#if showTooltip && tooltipData}
	<div 
		class="tooltip" 
		style="left: {Math.min(mouseX + 10, $width - 200)}px; top: {Math.max(mouseY - 10, 10)}px;"
	>
		<div class="tooltip-header">
			{dayOfYearToDate(tooltipData.dayOfYear)}
		</div>
		
		<div class="tooltip-row">
			<span class="year-label" style="color: #dc2626;">
				{tooltipData.currentYear.year}:
			</span>
			<span class="distance">
				{tooltipData.currentYear.hasData 
					? `${tooltipData.currentYear.distance.toFixed(1)} km`
					: 'Ingen data'
				}
			</span>
		</div>
		
		<div class="tooltip-row">
			<span class="year-label" style="color: #2563eb;">
				{tooltipData.lastYear.year}:
			</span>
			<span class="distance">
				{tooltipData.lastYear.hasData 
					? `${tooltipData.lastYear.distance.toFixed(1)} km`
					: 'Ingen data'
				}
			</span>
		</div>
		
		{#if tooltipData.difference !== undefined}
			<div class="tooltip-divider"></div>
			<div class="tooltip-row difference" class:positive={tooltipData.difference >= 0} class:negative={tooltipData.difference < 0}>
				<span class="diff-label">Forskjell:</span>
				<span class="diff-value">
					{tooltipData.difference >= 0 ? '+' : ''}{tooltipData.difference.toFixed(1)} km
					({tooltipData.percentDifference >= 0 ? '+' : ''}{tooltipData.percentDifference.toFixed(1)}%)
				</span>
			</div>
		{/if}
	</div>
{/if}

<style>
	.tooltip-overlay {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		cursor: crosshair;
		z-index: 10;
		background: transparent;
		/* Debug: add subtle background to see if overlay works */
		/* background: rgba(255, 0, 0, 0.1); */
	}

	.crosshair {
		position: absolute;
		top: 0;
		width: 1px;
		height: 100%;
		background-color: #6b7280;
		pointer-events: none;
		z-index: 5;
	}

	.tooltip {
		position: absolute;
		background: rgba(255, 255, 255, 0.95);
		border: 1px solid #e5e7eb;
		border-radius: 6px;
		padding: 8px 12px;
		font-size: 13px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
		pointer-events: none;
		z-index: 20;
		min-width: 180px;
		backdrop-filter: blur(4px);
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
</style>