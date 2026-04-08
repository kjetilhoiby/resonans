<script lang="ts">
	interface TrackPoint {
		lat: number;
		lon: number;
		ele?: number | null;
		hr?: number | null;
		time?: string | null;
	}

	interface Props {
		points: TrackPoint[];
		width?: number;
		height?: number;
	}

	let { points, width = 400, height = 280 }: Props = $props();

	const padding = 20;

	const bounds = $derived.by(() => {
		if (points.length === 0) return null;
		let minLat = Infinity, maxLat = -Infinity;
		let minLon = Infinity, maxLon = -Infinity;
		for (const p of points) {
			if (p.lat < minLat) minLat = p.lat;
			if (p.lat > maxLat) maxLat = p.lat;
			if (p.lon < minLon) minLon = p.lon;
			if (p.lon > maxLon) maxLon = p.lon;
		}
		return { minLat, maxLat, minLon, maxLon };
	});

	function toSvg(p: TrackPoint): [number, number] {
		if (!bounds) return [0, 0];
		const latRange = bounds.maxLat - bounds.minLat;
		const lonRange = bounds.maxLon - bounds.minLon;
		// Aspect-ratio-aware scaling
		const innerW = width - padding * 2;
		const innerH = height - padding * 2;
		// Use Mercator-ish projection (scale lon by cos(lat))
		const latMid = (bounds.minLat + bounds.maxLat) / 2;
		const cosLat = Math.cos((latMid * Math.PI) / 180);
		const adjustedLonRange = lonRange * cosLat;
		let scaleX = adjustedLonRange > 0 ? innerW / adjustedLonRange : 1;
		let scaleY = latRange > 0 ? innerH / latRange : 1;
		const scale = Math.min(scaleX, scaleY);
		const offsetX = (innerW - adjustedLonRange * scale) / 2;
		const offsetY = (innerH - latRange * scale) / 2;

		const x = padding + offsetX + (p.lon - bounds.minLon) * cosLat * scale;
		const y = padding + offsetY + (bounds.maxLat - p.lat) * scale;
		return [x, y];
	}

	const pathD = $derived.by(() => {
		if (points.length < 2) return '';
		let d = '';
		for (let i = 0; i < points.length; i++) {
			const [x, y] = toSvg(points[i]);
			d += i === 0 ? `M ${x.toFixed(1)},${y.toFixed(1)}` : ` L ${x.toFixed(1)},${y.toFixed(1)}`;
		}
		return d;
	});

	const startPt = $derived(points.length > 0 ? toSvg(points[0]) : null);
	const endPt = $derived(points.length > 1 ? toSvg(points[points.length - 1]) : null);
</script>

{#if points.length >= 2}
	<svg
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 {width} {height}"
		class="gpx-map"
		aria-label="Rute-kart"
		role="img"
	>
		<!-- Background -->
		<rect width={width} height={height} fill="#0d1117" rx="10" />

		<!-- Grid (subtle) -->
		{#each Array(5) as _, i}
			<line
				x1={padding}
				y1={padding + (i / 4) * (height - padding * 2)}
				x2={width - padding}
				y2={padding + (i / 4) * (height - padding * 2)}
				stroke="#1e2632"
				stroke-width="1"
			/>
			<line
				x1={padding + (i / 4) * (width - padding * 2)}
				y1={padding}
				x2={padding + (i / 4) * (width - padding * 2)}
				y2={height - padding}
				stroke="#1e2632"
				stroke-width="1"
			/>
		{/each}

		<!-- Track shadow -->
		<path d={pathD} fill="none" stroke="#4a9eff44" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" />
		<!-- Track -->
		<path d={pathD} fill="none" stroke="#4a9eff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />

		<!-- Start marker (green) -->
		{#if startPt}
			<circle cx={startPt[0]} cy={startPt[1]} r="6" fill="#48b581" stroke="#0d1117" stroke-width="2" />
			<text x={startPt[0] + 9} y={startPt[1] + 4} fill="#48b581" font-size="10" font-weight="600">Start</text>
		{/if}

		<!-- End marker (orange) -->
		{#if endPt}
			<circle cx={endPt[0]} cy={endPt[1]} r="6" fill="#f0b429" stroke="#0d1117" stroke-width="2" />
		{/if}
	</svg>
{/if}

<style>
	.gpx-map {
		width: 100%;
		height: auto;
		display: block;
		border-radius: 10px;
	}


</style>
