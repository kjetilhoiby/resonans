<script lang="ts">
	/**
	 * PositionMapChart — kart over hvor bilen har kjørt.
	 *
	 * Tegner en polyline mellom alle posisjons-noder (kronologisk) og én markør
	 * per node. `stop`-noder (parkeringer) vises som store aksent-prikker med
	 * tidsrom; `move`-noder (kjøre-knekkpunkter) som små, dempede prikker.
	 * Noder kommer ferdig klynget fra serveren (clusterPositions), så en lang
	 * parkering er allerede ett punkt — ikke ett per kvarter.
	 */
	import { onMount, onDestroy } from 'svelte';
	import { RESONANS_DARK_MAP_STYLE, mapTransformRequest } from './mapStyle';

	interface PositionNode {
		lat: number;
		lon: number;
		kind: 'stop' | 'move';
		from: string;
		to: string;
		samples: number;
	}

	let { positions, title = 'Hvor vi har kjørt' }: { positions: PositionNode[]; title?: string } =
		$props();

	let mapEl = $state<HTMLDivElement | null>(null);
	let map: maplibregl.Map | null = null;

	const stops = $derived(positions.filter((p) => p.kind === 'stop').length);

	function fmtRange(from: string, to: string): string {
		const f = new Date(from);
		const t = new Date(to);
		const dayFmt: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' };
		const timeFmt: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
		const fDay = f.toLocaleDateString('nb-NO', dayFmt);
		const tDay = t.toLocaleDateString('nb-NO', dayFmt);
		const fTime = f.toLocaleTimeString('nb-NO', timeFmt);
		const tTime = t.toLocaleTimeString('nb-NO', timeFmt);
		if (from === to) return `${fDay} ${fTime}`;
		if (fDay === tDay) return `${fDay} ${fTime}–${tTime}`;
		return `${fDay} ${fTime} → ${tDay} ${tTime}`;
	}

	onMount(async () => {
		if (positions.length === 0) return;

		const maplibregl = await import('maplibre-gl');
		await import('maplibre-gl/dist/maplibre-gl.css');
		if (!mapEl) return;

		const coords: [number, number][] = positions.map((p) => [p.lon, p.lat]);

		map = new maplibregl.Map({
			container: mapEl,
			style: RESONANS_DARK_MAP_STYLE,
			transformRequest: mapTransformRequest,
			center: coords[coords.length - 1],
			zoom: 11,
			attributionControl: false
		});

		map.on('load', () => {
			if (!map) return;

			// Polyline gjennom alle noder i kronologisk rekkefølge.
			if (coords.length >= 2) {
				map.addSource('route', {
					type: 'geojson',
					data: {
						type: 'Feature',
						properties: {},
						geometry: { type: 'LineString', coordinates: coords }
					}
				});
				map.addLayer({
					id: 'route',
					type: 'line',
					layout: { 'line-cap': 'round', 'line-join': 'round' },
					source: 'route',
					paint: { 'line-color': '#7c8ef5', 'line-width': 3, 'line-opacity': 0.55 }
				});
			}

			// Punkter: ett per node, som GeoJSON circle-lag (skalerer til mange punkter).
			map.addSource('nodes', {
				type: 'geojson',
				data: {
					type: 'FeatureCollection',
					features: positions.map((p) => ({
						type: 'Feature',
						geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
						properties: {
							kind: p.kind,
							label: p.kind === 'stop' ? `Parkert ${fmtRange(p.from, p.to)}` : fmtRange(p.from, p.to)
						}
					}))
				}
			});

			// Kjøre-knekkpunkter: små, dempede.
			map.addLayer({
				id: 'nodes-move',
				type: 'circle',
				source: 'nodes',
				filter: ['==', ['get', 'kind'], 'move'],
				paint: {
					'circle-radius': 3.5,
					'circle-color': '#94a3b8',
					'circle-opacity': 0.85
				}
			});
			// Parkeringer: store aksent-prikker med kant.
			map.addLayer({
				id: 'nodes-stop',
				type: 'circle',
				source: 'nodes',
				filter: ['==', ['get', 'kind'], 'stop'],
				paint: {
					'circle-radius': 7,
					'circle-color': '#7c8ef5',
					'circle-stroke-width': 2,
					'circle-stroke-color': '#0b0b0f'
				}
			});

			// Klikk på et punkt → popup med tidsrom.
			const popup = new maplibregl.Popup({ offset: 12, closeButton: false });
			for (const layer of ['nodes-stop', 'nodes-move']) {
				map.on('click', layer, (e) => {
					const f = e.features?.[0];
					if (!f || !map) return;
					const c = (f.geometry as GeoJSON.Point).coordinates as [number, number];
					popup.setLngLat(c).setText(String(f.properties?.label ?? '')).addTo(map);
				});
				map.on('mouseenter', layer, () => {
					if (map) map.getCanvas().style.cursor = 'pointer';
				});
				map.on('mouseleave', layer, () => {
					if (map) map.getCanvas().style.cursor = '';
				});
			}

			// Zoom til å dekke alle punkter.
			if (coords.length === 1) {
				map.setCenter(coords[0]);
				map.setZoom(13);
			} else {
				const bounds = new maplibregl.LngLatBounds(coords[0], coords[0]);
				for (const c of coords) bounds.extend(c);
				map.fitBounds(bounds, { padding: 40, maxZoom: 14, duration: 0 });
			}
		});
	});

	onDestroy(() => {
		map?.remove();
		map = null;
	});
</script>

<div class="pm">
	<div class="pm-head">
		<span class="pm-title">{title}</span>
		{#if positions.length > 0}
			<span class="pm-meta">{stops} stopp · siste 7 dager</span>
		{/if}
	</div>
	{#if positions.length === 0}
		<p class="pm-empty">
			Ingen posisjoner registrert ennå. Posisjon hentes hvert kvarter mens bilen er våken
			(05–22).
		</p>
	{:else}
		<div class="pm-map" bind:this={mapEl}></div>
		<div class="pm-legend">
			<span class="pm-legend-item"><i class="dot stop"></i> Parkering</span>
			<span class="pm-legend-item"><i class="dot move"></i> Kjørepunkt</span>
		</div>
	{/if}
</div>

<style>
	.pm {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.pm-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
	}
	.pm-title {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text-primary, #e6e6e6);
	}
	.pm-meta {
		font-size: 0.66rem;
		color: #888;
		white-space: nowrap;
	}
	.pm-map {
		height: 320px;
		border-radius: var(--radius-md, 12px);
		overflow: hidden;
	}
	.pm-empty {
		margin: 0;
		padding: 28px 12px;
		text-align: center;
		font-size: 0.78rem;
		line-height: 1.5;
		color: #777;
	}
	.pm-legend {
		display: flex;
		gap: 14px;
		font-size: 0.66rem;
		color: #999;
	}
	.pm-legend-item {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		display: inline-block;
	}
	.dot.stop {
		background: #7c8ef5;
		border: 2px solid #0b0b0f;
	}
	.dot.move {
		background: #94a3b8;
	}
</style>
