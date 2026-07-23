<!--
  ChatMapCard — lettvekts MapLibre-kart med én nål, for kilde-kort i chatten.
  Gjenbruker den delte mørke basiskart-stilen. maplibre-gl lastes lazy i onMount.
-->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { Map as MapLibreMap } from 'maplibre-gl';
	import { RESONANS_DARK_MAP_STYLE, mapTransformRequest } from '../charts/mapStyle';

	interface Props {
		lat: number;
		lng: number;
		label: string;
	}

	let { lat, lng, label }: Props = $props();

	let container: HTMLDivElement;
	let map: MapLibreMap | null = null;

	onMount(() => {
		let cancelled = false;
		(async () => {
			const { Map, Marker } = await import('maplibre-gl');
			if (cancelled || !container) return;
			map = new Map({
				container,
				style: RESONANS_DARK_MAP_STYLE,
				transformRequest: mapTransformRequest,
				center: [lng, lat],
				zoom: 10,
				attributionControl: false,
				interactive: true
			});
			map.scrollZoom.disable(); // ikke stjel scroll i chat-tråden
			const el = document.createElement('div');
			el.className = 'chat-map-pin';
			new Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
		})();
		return () => { cancelled = true; };
	});

	onDestroy(() => {
		map?.remove();
		map = null;
	});
</script>

<div class="chat-map">
	<div class="chat-map-canvas" bind:this={container}></div>
	<span class="chat-map-label">{label}</span>
</div>

<style>
	.chat-map {
		position: relative;
		border-radius: 12px;
		overflow: hidden;
		border: 1px solid #242424;
	}

	.chat-map-canvas {
		width: 100%;
		height: 170px;
	}

	.chat-map-label {
		position: absolute;
		left: 8px;
		bottom: 8px;
		font-size: 0.74rem;
		color: #e6e6e6;
		background: rgba(0, 0, 0, 0.6);
		padding: 3px 8px;
		border-radius: 8px;
		pointer-events: none;
	}

	:global(.chat-map-pin) {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: #6c7cff;
		border: 2px solid #fff;
		box-shadow: 0 0 0 2px rgba(108, 124, 255, 0.4);
	}
</style>
