<!--
  MapPointPicker — fullskjerm kartvelger for å plassere/korrigere en nål manuelt.

  Brukes når geokoding av et stedsnavn bommer (eller mangler): trykk på kartet
  for å sette nålen, dra den for å finjustere, og bekreft. Portaleres til
  <body> og ligger over bottompaneler (z 400 > BottomSheet 201), så den kan
  åpnes fra dagbok-redigereren.

  Props:
    initial   – eksisterende koordinat (nålen starter her)
    center    – fallback-senter når det ikke finnes noe koordinat (f.eks. dagens sted)
    title     – overskrift, f.eks. «Plasser bildet»
    onConfirm – kalles med valgt koordinat
    onRemove  – vis «Fjern nål» (kalles for å fjerne manuell plassering)
    onClose   – lukk uten endring
    track     – område-prefiks for data-track-logging
-->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { fade } from 'svelte/transition';
	import type { Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl';
	import { portal } from '$lib/actions/portal';
	import { RESONANS_DARK_MAP_STYLE, mapTransformRequest } from '../charts/mapStyle';
	import type { GeoCoord } from './trip-api';

	interface Props {
		initial?: GeoCoord | null;
		center?: GeoCoord | null;
		title?: string;
		onConfirm: (geo: GeoCoord) => void;
		onRemove?: (() => void) | null;
		onClose: () => void;
		track?: string;
	}

	let {
		initial = null,
		center = null,
		title = 'Plasser nålen',
		onConfirm,
		onRemove = null,
		onClose,
		track = 'kartvelger'
	}: Props = $props();

	let container = $state<HTMLDivElement | null>(null);
	let picked = $state<GeoCoord | null>(initial ? { ...initial } : null);

	let map: MapLibreMap | null = null;
	let marker: MapLibreMarker | null = null;
	let MarkerCtor: typeof import('maplibre-gl').Marker | null = null;

	function setMarker(geo: GeoCoord) {
		picked = geo;
		if (!map || !MarkerCtor) return;
		if (!marker) {
			const el = document.createElement('div');
			el.className = 'mpp-marker';
			el.textContent = '📍';
			marker = new MarkerCtor({ element: el, draggable: true, anchor: 'bottom' })
				.setLngLat([geo.lon, geo.lat])
				.addTo(map);
			marker.on('dragend', () => {
				const p = marker!.getLngLat();
				picked = { lat: p.lat, lon: p.lng };
			});
		} else {
			marker.setLngLat([geo.lon, geo.lat]);
		}
	}

	onMount(() => {
		void (async () => {
			if (!container) return;
			const maplibre = await import('maplibre-gl');
			if (!container) return;
			MarkerCtor = maplibre.Marker;

			const start = initial ?? center;
			map = new maplibre.Map({
				container,
				style: RESONANS_DARK_MAP_STYLE,
				transformRequest: mapTransformRequest,
				center: start ? [start.lon, start.lat] : [10.75, 61.5],
				zoom: initial ? 11 : center ? 8 : 4.3,
				attributionControl: false
			});

			map.on('click', (e) => {
				setMarker({ lat: e.lngLat.lat, lon: e.lngLat.lng });
			});

			if (initial) {
				map.on('load', () => setMarker(initial!));
			}
		})();
	});

	onDestroy(() => {
		marker?.remove();
		marker = null;
		map?.remove();
		map = null;
	});

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={onKey} />

<div class="mpp-root" use:portal transition:fade={{ duration: 180 }} role="dialog" aria-modal="true" aria-label={title}>
	<div class="mpp-head">
		<h3 class="mpp-title">{title}</h3>
		<button type="button" class="mpp-close" aria-label="Lukk kartvelger" onclick={onClose} data-track="{track}:lukk">✕</button>
	</div>

	<p class="mpp-hint">Trykk på kartet der nålen hører hjemme — dra for å finjustere.</p>

	<div bind:this={container} class="mpp-map"></div>

	<div class="mpp-footer">
		{#if onRemove && initial}
			<button
				type="button"
				class="mpp-btn mpp-btn-danger"
				onclick={() => { onRemove?.(); onClose(); }}
				data-track="{track}:fjern-naal"
			>Fjern nål</button>
		{/if}
		<button type="button" class="mpp-btn" onclick={onClose} data-track="{track}:avbryt">Avbryt</button>
		<button
			type="button"
			class="mpp-btn mpp-btn-primary"
			disabled={!picked}
			onclick={() => { if (picked) { onConfirm(picked); onClose(); } }}
			data-track="{track}:bruk-plassering"
		>Bruk plassering</button>
	</div>
</div>

<style>
	.mpp-root {
		position: fixed;
		inset: 0;
		z-index: 400; /* over BottomSheet (201) og fullskjerm-fortellingen (300) */
		background: var(--tp-bg-0, #0b0f1a);
		display: flex;
		flex-direction: column;
	}

	.mpp-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: max(12px, env(safe-area-inset-top)) 16px 4px;
	}

	.mpp-title {
		margin: 0;
		font-size: 1.02rem;
		color: var(--tp-text, #e2e8f0);
	}

	.mpp-close {
		background: none;
		border: none;
		color: var(--tp-text-muted, #64748b);
		font-size: 1.15rem;
		line-height: 1;
		cursor: pointer;
		padding: 6px 8px;
	}

	.mpp-hint {
		margin: 0;
		padding: 0 16px 8px;
		font-size: 0.8rem;
		color: var(--tp-text-muted, #64748b);
	}

	.mpp-map {
		flex: 1;
		min-height: 0;
		cursor: crosshair;
	}

	.mpp-footer {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		padding: 10px 16px calc(10px + env(safe-area-inset-bottom, 0));
		border-top: 1px solid var(--tp-border, #1a1f2e);
		background: var(--tp-bg-1, #0f1419);
	}

	.mpp-btn {
		background: var(--tp-bg-2, #151b26);
		border: 1px solid var(--tp-border-strong, #2d3748);
		color: var(--tp-text-soft, #cbd5e1);
		border-radius: 8px;
		font-size: 0.85rem;
		padding: 8px 14px;
		cursor: pointer;
	}

	.mpp-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.mpp-btn-primary {
		background: var(--tp-accent, #7c8ef5);
		border-color: var(--tp-accent, #7c8ef5);
		color: #0b0f1a;
		font-weight: 600;
	}

	.mpp-btn-danger {
		margin-right: auto;
		color: var(--trip-danger, #f87171);
	}

	:global(.mpp-marker) {
		font-size: 1.8rem;
		line-height: 1;
		cursor: grab;
		filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.6));
	}
</style>
