<script>
	import { getContext } from 'svelte';

	const { yScale, height } = getContext('LayerCake');

	// Generate ticks for Y axis
	$: ticks = $yScale.ticks(5);
</script>

<g class="axis y-axis">
	{#each ticks as tick}
		<g class="tick" transform="translate(0, {$yScale(tick)})">
			<line
				x1="0"
				x2="-6"
				stroke="#6b7280" 
				stroke-width="1"
			/>
			<text
				x="-10"
				text-anchor="end"
				dominant-baseline="middle"
				fill="#6b7280"
				font-size="12"
			>
				{tick} km
			</text>
		</g>
	{/each}
</g>