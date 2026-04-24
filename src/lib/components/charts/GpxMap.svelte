<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { Map as MapLibreMap } from 'maplibre-gl';

	interface TrackPoint {
		lat: number;
		lon: number;
		ele?: number | null;
		hr?: number | null;
		time?: string | null;
	}

	interface Props {
		points: TrackPoint[];
		height?: number;
	}

	let { points, height = 340 }: Props = $props();

	let container = $state<HTMLDivElement | null>(null);
	let map: MapLibreMap | null = null;

	$effect(() => {
		if (!container || points.length < 2 || typeof window === 'undefined') return;
		void initMap(container, points);
	});

	async function initMap(el: HTMLDivElement, pts: TrackPoint[]) {
		const { Map, LngLatBounds, Marker } = await import('maplibre-gl');

		map?.remove();

		const coords = pts.map((p) => [p.lon, p.lat] as [number, number]);

		const bounds = new LngLatBounds(coords[0], coords[0]);
		for (const c of coords) bounds.extend(c);

		map = new Map({
			container: el,
			style: 'https://tiles.openfreemap.org/styles/liberty',
			bounds,
			fitBoundsOptions: { padding: 48 },
			attributionControl: { compact: true }
		});

		new Marker({ color: '#28a745' }).setLngLat(coords[0]).addTo(map);
		new Marker({ color: '#f0b429' }).setLngLat(coords[coords.length - 1]).addTo(map);

		map.on('load', () => {
			if (!map) return;

			map.addSource('route', {
				type: 'geojson',
				data: {
					type: 'Feature',
					properties: {},
					geometry: { type: 'LineString', coordinates: coords }
				}
			});

			map.addLayer({
				id: 'route-shadow',
				type: 'line',
				source: 'route',
				layout: { 'line-join': 'round', 'line-cap': 'round' },
				paint: { 'line-color': 'rgba(0,0,0,0.30)', 'line-width': 6 }
			});

			map.addLayer({
				id: 'route-line',
				type: 'line',
				source: 'route',
				layout: { 'line-join': 'round', 'line-cap': 'round' },
				paint: { 'line-color': '#e8372b', 'line-width': 3 }
			});
		});
	}

	onDestroy(() => {
		map?.remove();
	});
</script>

<div bind:this={container} class="gpx-map" style:height="{height}px"></div>

<style>
	.gpx-map {
		width: 100%;
		border-radius: 12px;
		overflow: hidden;
	}
</style>
