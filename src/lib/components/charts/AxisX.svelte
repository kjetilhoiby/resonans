<script>
	import { getContext } from 'svelte';

	const { width, height, xScale } = getContext('LayerCake');

	// Month names for display
	const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mai', 'Jun', 
	                   'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Des'];

	// Generate month ticks based on day-of-year
	// Approximate day numbers for 1st of each month
	const monthDays = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];
	
	$: monthTicks = monthDays.map((day, i) => ({
		day,
		name: monthNames[i]
	}));
</script>

<g class="axis x-axis" transform="translate(0, {$height})">
	{#each monthTicks as month}
		{@const tickValue = $xScale(month.day)}
		<g class="tick" transform="translate({tickValue}, 0)">
			<line
				y1="0" 
				y2="6"
				stroke="#6b7280"
				stroke-width="1"
			/>
			<text
				y="16"
				text-anchor="middle"
				fill="#6b7280"
				font-size="12"
			>
				{month.name}
			</text>
		</g>
	{/each}
</g>