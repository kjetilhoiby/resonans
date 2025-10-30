<script>
	import { getContext } from 'svelte';

	const { data, xGet, yGet, zGet, xScale, yScale, height } = getContext('LayerCake');

	// Calculate current day of year
	const today = new Date();
	const yearStart = new Date(today.getFullYear(), 0, 1);
	const currentDayOfYear = Math.floor((today.getTime() - yearStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
	
	$: todayX = $xScale(currentDayOfYear);

	// Find current year data and latest measurement
	$: currentYearData = $data
		.filter(d => d.series === today.getFullYear().toString())
		.sort((a, b) => a.x - b.x);
	
	$: latestMeasurement = currentYearData.length > 0 ? currentYearData[currentYearData.length - 1] : null;
	
	// Calculate projection to end of year with realistic trend
	$: projectionData = (() => {
		if (!latestMeasurement || currentYearData.length < 2) return null;
		
		// Calculate average weekly progress from recent data
		const recentData = currentYearData.slice(-8); // Last 8 data points
		if (recentData.length < 2) return null;
		
		const timeSpan = recentData[recentData.length - 1].x - recentData[0].x;
		const distanceGain = recentData[recentData.length - 1].y - recentData[0].y;
		const dailyRate = timeSpan > 0 ? distanceGain / timeSpan : 0;
		
		// Project to end of year
		const daysRemaining = 365 - latestMeasurement.x;
		const projectedDistance = latestMeasurement.y + (dailyRate * daysRemaining);
		
		return {
			startX: $xScale(latestMeasurement.x),
			startY: $yScale(latestMeasurement.y),
			endX: $xScale(365),
			endY: $yScale(Math.max(projectedDistance, latestMeasurement.y)), // Don't go backwards
			projectedTotal: projectedDistance
		};
	})();
</script>

<!-- Today marker line -->
<g class="today-marker">
	<line
		x1={todayX}
		y1="0"
		x2={todayX}
		y2={$height}
		stroke="#f59e0b"
		stroke-width="2"
		stroke-dasharray="4,4"
		opacity="0.8"
	/>
	<text
		x={todayX + (currentDayOfYear <= 180 ? 8 : -8)}
		y="15"
		text-anchor={currentDayOfYear <= 180 ? "start" : "end"}
		fill="#f59e0b"
		font-size="11"
		font-weight="500"
		opacity="0.9"
	>
		Nå
	</text>
</g>

<!-- Projection line from last measurement to end of year -->
{#if projectionData && latestMeasurement.x < 365}
	<g class="projection">
		<line
			x1={projectionData.startX}
			y1={projectionData.startY}
			x2={projectionData.endX}
			y2={projectionData.endY}
			stroke="#dc2626"
			stroke-width="2"
			stroke-dasharray="6,3"
			opacity="0.6"
		/>
		
		<!-- Small circle at the end point -->
		<circle
			cx={projectionData.endX}
			cy={projectionData.endY}
			r="3"
			fill="#dc2626"
			opacity="0.6"
		/>
		

	</g>
{/if}