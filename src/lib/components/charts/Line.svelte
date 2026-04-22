<script lang="ts">
	import { getContext } from 'svelte';
	import { line, curveMonotoneX } from 'd3-shape';

	type DataPoint = {
		x: number;
		y: number;
		series: string;
	};

	type ReadableStore<T> = {
		subscribe(run: (value: T) => void): () => void;
	};

	type LayerCakeContext = {
		data: ReadableStore<DataPoint[]>;
		xGet: ReadableStore<(point: DataPoint) => number>;
		yGet: ReadableStore<(point: DataPoint) => number>;
		zGet: ReadableStore<(point: DataPoint) => string>;
	};

	const { data, xGet, yGet, zGet } = getContext<LayerCakeContext>('LayerCake');
	
	export let mode: 'comparison' | 'historical' = 'comparison';

	// Group data by series
	$: groupedData = $data.reduce((acc: Record<string, DataPoint[]>, d: DataPoint) => {
		const series = $zGet(d);
		if (!acc[series]) acc[series] = [];
		acc[series].push(d);
		return acc;
	}, {});

	// Create line generator
	const lineGenerator = line<DataPoint>()
		.x((d) => $xGet(d))
		.y((d) => $yGet(d))
		.curve(curveMonotoneX);

	// Dynamic color mapping for series
	$: currentYear = new Date().getFullYear().toString();
	
	function getSeriesColor(series: string): string {
		const currentYear = new Date().getFullYear();
		const lastYear = currentYear - 1;

		if (series === currentYear.toString() || series === 'projection') {
			return '#dc2626'; // rød for inneværende år og prognose
		}
		if (series === lastYear.toString() && mode === 'comparison') {
			return '#2563eb'; // blå for forrige år (kun i sammenligningsmodus)
		}
		return '#d1d5db'; // lysegrå for alle andre år
	}
</script>

{#each Object.entries(groupedData) as [series, seriesData]}
	<path
		d={lineGenerator(seriesData as any)}
		fill="none"
		stroke={getSeriesColor(series)}
		stroke-width="3"
		stroke-linecap="round"
		stroke-linejoin="round"
	/>
{/each}