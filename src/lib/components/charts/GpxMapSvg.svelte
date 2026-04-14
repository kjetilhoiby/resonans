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

	// Unique clip-path ID per instance to avoid collisions when multiple maps render
	const clipId = 'map-clip-' + Math.random().toString(36).slice(2, 8);

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

	// Web Mercator helpers
	function lonToFrac(lon: number, Z: number): number {
		return ((lon + 180) / 360) * Math.pow(2, Z);
	}
	function latToFrac(lat: number, Z: number): number {
		const rad = (lat * Math.PI) / 180;
		return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, Z);
	}

	interface TileInfo {
		url: string;
		svgX: number;
		svgY: number;
		tileW: number;
		tileH: number;
	}
	interface Viewport {
		Z: number;
		left: number;
		right: number;
		top: number;
		bottom: number;
		tiles: TileInfo[];
	}

	const viewport = $derived.by((): Viewport | null => {
		if (!bounds) return null;
		const lonSpan = Math.max(bounds.maxLon - bounds.minLon, 0.001);
		// Pick zoom so ~3 tiles span the track width
		const Z = Math.max(10, Math.min(16, Math.round(Math.log2((3 * 360) / lonSpan))));
		const pad = 0.6;
		const left = lonToFrac(bounds.minLon, Z) - pad;
		const right = lonToFrac(bounds.maxLon, Z) + pad;
		const top = latToFrac(bounds.maxLat, Z) - pad;
		const bottom = latToFrac(bounds.minLat, Z) + pad;
		const spanW = right - left;
		const spanH = bottom - top;
		const maxTile = Math.pow(2, Z);
		const tiles: TileInfo[] = [];
		for (let tx = Math.floor(left); tx <= Math.floor(right); tx++) {
			for (let ty = Math.floor(top); ty <= Math.floor(bottom); ty++) {
				const txW = ((tx % maxTile) + maxTile) % maxTile;
				tiles.push({
					url: 'https://tile.openstreetmap.org/' + Z + '/' + txW + '/' + ty + '.png',
					svgX: ((tx - left) / spanW) * width,
					svgY: ((ty - top) / spanH) * height,
					tileW: width / spanW,
					tileH: height / spanH
				});
			}
		}
		return { Z, left, right, top, bottom, tiles };
	});

	function toSvg(p: TrackPoint): [number, number] {
		if (!viewport) return [0, 0];
		const { Z, left, right, top, bottom } = viewport;
		const x = ((lonToFrac(p.lon, Z) - left) / (right - left)) * width;
		const y = ((latToFrac(p.lat, Z) - top) / (bottom - top)) * height;
		return [x, y];
	}

	const pathD = $derived.by(() => {
		if (points.length < 2 || !viewport) return '';
		return points
			.map((p, i) => {
				const [x, y] = toSvg(p);
				return (i === 0 ? 'M ' : 'L ') + x.toFixed(1) + ',' + y.toFixed(1);
			})
			.join(' ');
	});

	const startPt = $derived(points.length > 0 && viewport ? toSvg(points[0]) : null);
	const endPt = $derived(points.length > 1 && viewport ? toSvg(points[points.length - 1]) : null);
</script>

{#if points.length >= 2}
	<svg
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 {width} {height}"
		class="gpx-map"
		aria-label="Rute-kart"
		role="img"
	>
		<defs>
			<clipPath id={clipId}>
				<rect width={width} height={height} rx="10" />
			</clipPath>
		</defs>

		<!-- Fallback bg while tiles load -->
		<rect width={width} height={height} fill="#e8e4de" rx="10" />

		<!-- OSM tile layer -->
		{#if viewport}
			<g clip-path="url(#{clipId})">
				{#each viewport.tiles as tile}
					<image
						href={tile.url}
						x={tile.svgX}
						y={tile.svgY}
						width={tile.tileW}
						height={tile.tileH}
						preserveAspectRatio="none"
					/>
				{/each}
			</g>
		{/if}

		<!-- Track + markers -->
		<g clip-path="url(#{clipId})">
			<path d={pathD} fill="none" stroke="rgba(0,0,0,0.35)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" />
			<path d={pathD} fill="none" stroke="#e8372b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
			{#if startPt}
				<circle cx={startPt[0]} cy={startPt[1]} r="6" fill="#28a745" stroke="white" stroke-width="2" />
			{/if}
			{#if endPt}
				<circle cx={endPt[0]} cy={endPt[1]} r="6" fill="#f0b429" stroke="white" stroke-width="2" />
			{/if}
		</g>

		<!-- OSM attribution (required by tile usage policy) -->
		<text x={width - 4} y={height - 4} text-anchor="end" fill="rgba(0,0,0,0.45)" font-size="8" font-family="sans-serif">© OpenStreetMap contributors</text>
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
