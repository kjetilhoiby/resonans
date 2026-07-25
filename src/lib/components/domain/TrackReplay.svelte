<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { Map as MapLibreMap, Marker as MapLibreMarker, GeoJSONSource } from 'maplibre-gl';
	import { buildReplay, type ReplayTrackPoint, type ReplayPhotoInput } from './track-replay';

	interface WorkoutResource {
		sportType?: string | null;
		distanceM?: number | null;
		durationS?: number | null;
		elevationM?: number | null;
		startedAt?: string | null;
		trackPoints: ReplayTrackPoint[];
		photos: ReplayPhotoInput[];
	}

	let { resource, title }: { resource: WorkoutResource; title: string } = $props();

	const DURATION = 60; // sekunder for full avspilling

	const replay = $derived(buildReplay(resource.trackPoints, resource.photos));

	let container = $state<HTMLDivElement | null>(null);
	let map: MapLibreMap | null = null;
	let posMarker: MapLibreMarker | null = null;
	let photoMarkers: MapLibreMarker[] = [];
	let mapReady = $state(false);

	let progress = $state(0); // 0..1
	let playing = $state(false);

	// Gjeldende bilde: siste bilde vi har «passert» i avspillingen.
	const currentPhoto = $derived.by(() => {
		let found: (typeof replay.photos)[number] | null = null;
		for (const p of replay.photos) {
			if (p.fraction <= progress + 1e-6) found = p;
			else break;
		}
		return found;
	});

	function fmtDistance(m?: number | null): string {
		if (!m) return '–';
		return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
	}
	function fmtDuration(s?: number | null): string {
		if (!s) return '–';
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		return h > 0 ? `${h}t ${m}m` : `${m} min`;
	}

	function bearing(a: [number, number], b: [number, number]): number {
		const lat1 = (a[1] * Math.PI) / 180;
		const lat2 = (b[1] * Math.PI) / 180;
		const dLon = ((b[0] - a[0]) * Math.PI) / 180;
		const y = Math.sin(dLon) * Math.cos(lat2);
		const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
		return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
	}

	// Init kart (kun i nettleser).
	$effect(() => {
		if (!container || replay.coords.length < 2 || typeof window === 'undefined') return;
		void initMap(container);
		return () => {
			map?.remove();
			map = null;
			mapReady = false;
		};
	});

	async function initMap(el: HTMLDivElement) {
		const maplibre = await import('maplibre-gl');
		const { Map, LngLatBounds, Marker } = maplibre;

		const coords = replay.coords;
		const bounds = new LngLatBounds(coords[0], coords[0]);
		for (const c of coords) bounds.extend(c);

		map = new Map({
			container: el,
			maxPitch: 85,
			attributionControl: { compact: true },
			style: {
				version: 8,
				sources: {
					sat: {
						type: 'raster',
						tiles: [
							'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
						],
						tileSize: 256,
						maxzoom: 19,
						attribution: 'Esri, Maxar, Earthstar Geographics'
					},
					dem: {
						type: 'raster-dem',
						tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
						encoding: 'terrarium',
						tileSize: 256,
						maxzoom: 15,
						attribution: 'Mapzen, USGS'
					}
				},
				layers: [{ id: 'sat', type: 'raster', source: 'sat' }]
			},
			bounds,
			fitBoundsOptions: { padding: 60, pitch: 50 }
		});

		map.on('load', () => {
			if (!map) return;
			// Satellitt strukket over 3D-terreng med lett overdrivelse.
			map.setTerrain({ source: 'dem', exaggeration: 1.5 });

			map.addSource('route', {
				type: 'geojson',
				data: lineFeature(coords.slice(0, 1))
			});
			map.addLayer({
				id: 'route-shadow',
				type: 'line',
				source: 'route',
				layout: { 'line-join': 'round', 'line-cap': 'round' },
				paint: { 'line-color': 'rgba(0,0,0,0.4)', 'line-width': 7 }
			});
			map.addLayer({
				id: 'route-line',
				type: 'line',
				source: 'route',
				layout: { 'line-join': 'round', 'line-cap': 'round' },
				paint: { 'line-color': '#ffd23f', 'line-width': 4 }
			});

			// Posisjonsprikk i hodet av sporet.
			const dot = document.createElement('div');
			dot.className = 'replay-pos';
			posMarker = new Marker({ element: dot }).setLngLat(coords[0]).addTo(map);

			// Bilde-markører langs ruta.
			for (const p of replay.photos) {
				const el2 = document.createElement('div');
				el2.className = 'replay-photo-pin';
				photoMarkers.push(new Marker({ element: el2 }).setLngLat([p.lon, p.lat]).addTo(map));
			}

			mapReady = true;
		});
	}

	function lineFeature(coords: [number, number][]) {
		return {
			type: 'Feature' as const,
			properties: {},
			geometry: { type: 'LineString' as const, coordinates: coords }
		};
	}

	// Tegn ruta opp til `progress` og fly kameraet bak posisjonen.
	$effect(() => {
		// Avhengigheter: progress + mapReady.
		const p = progress;
		if (!mapReady || !map) return;

		const coords = replay.coords;
		const maxIdx = coords.length - 1;
		const idx = Math.min(maxIdx, Math.max(1, Math.round(p * maxIdx)));

		const src = map.getSource('route') as GeoJSONSource | undefined;
		src?.setData(lineFeature(coords.slice(0, idx + 1)));

		const head = coords[idx];
		posMarker?.setLngLat(head);

		// Marker gjeldende bilde.
		const cur = currentPhoto;
		photoMarkers.forEach((mrk, i) => {
			mrk.getElement().classList.toggle('active', replay.photos[i] === cur);
		});

		// Kamera: framing ved start, chase-cam under avspilling.
		if (p > 0.001) {
			const back = Math.max(0, idx - 6);
			const brg = bearing(coords[back], head);
			map.jumpTo({ center: head, bearing: brg, pitch: 64, zoom: 14.5 });
		}
	});

	// Avspillingsløkke.
	$effect(() => {
		if (!playing) return;
		let raf = 0;
		let last = performance.now();
		const stepFn = (now: number) => {
			const dt = (now - last) / 1000;
			last = now;
			progress = Math.min(1, progress + dt / DURATION);
			if (progress >= 1) {
				playing = false;
			} else {
				raf = requestAnimationFrame(stepFn);
			}
		};
		raf = requestAnimationFrame(stepFn);
		return () => cancelAnimationFrame(raf);
	});

	function togglePlay() {
		if (progress >= 1) progress = 0;
		playing = !playing;
	}

	onDestroy(() => {
		map?.remove();
		map = null;
	});
</script>

<section class="replay" aria-label={title}>
	<div bind:this={container} class="replay-map"></div>

	<header class="replay-top">
		<h1>{title}</h1>
		<div class="replay-stats">
			<span>{fmtDistance(resource.distanceM)}</span>
			<span>·</span>
			<span>{fmtDuration(resource.durationS)}</span>
			{#if resource.elevationM}
				<span>·</span>
				<span>↑ {Math.round(resource.elevationM)} m</span>
			{/if}
		</div>
	</header>

	{#if currentPhoto}
		<figure class="replay-photo">
			<img src={currentPhoto.url} alt={currentPhoto.caption ?? 'Bilde fra turen'} />
			{#if currentPhoto.caption}
				<figcaption>{currentPhoto.caption}</figcaption>
			{/if}
		</figure>
	{/if}

	<div class="replay-controls">
		<button onclick={togglePlay} aria-label={playing ? 'Pause' : 'Spill av'}>
			{playing ? '⏸' : '▶'}
		</button>
		<input
			type="range"
			min="0"
			max="1"
			step="0.001"
			bind:value={progress}
			aria-label="Skrubb avspilling"
		/>
	</div>

	<div class="replay-credit">Satellitt: Esri · Terreng: Mapzen/USGS</div>
</section>

<style>
	.replay {
		position: fixed;
		inset: 0;
		background: #000;
		overflow: hidden;
	}
	.replay-map {
		position: absolute;
		inset: 0;
	}
	.replay-top {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		padding: 16px 20px;
		background: linear-gradient(to bottom, rgba(0, 0, 0, 0.6), transparent);
		color: #fff;
		pointer-events: none;
	}
	.replay-top h1 {
		margin: 0;
		font-size: 1.1rem;
		font-weight: 600;
	}
	.replay-stats {
		display: flex;
		gap: 6px;
		font-size: 0.85rem;
		opacity: 0.85;
		margin-top: 2px;
	}
	.replay-photo {
		position: absolute;
		top: 72px;
		right: 16px;
		width: min(42vw, 280px);
		margin: 0;
		border-radius: 12px;
		overflow: hidden;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
		background: #111;
		animation: pop 0.35s ease;
	}
	.replay-photo img {
		display: block;
		width: 100%;
		height: auto;
		max-height: 40vh;
		object-fit: cover;
	}
	.replay-photo figcaption {
		padding: 6px 10px;
		font-size: 0.8rem;
		color: #eee;
	}
	@keyframes pop {
		from {
			transform: scale(0.9);
			opacity: 0;
		}
		to {
			transform: scale(1);
			opacity: 1;
		}
	}
	.replay-controls {
		position: absolute;
		left: 16px;
		right: 16px;
		bottom: 24px;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 14px;
		background: rgba(0, 0, 0, 0.45);
		border-radius: 16px;
		backdrop-filter: blur(6px);
	}
	.replay-controls button {
		flex: 0 0 auto;
		width: 44px;
		height: 44px;
		border: none;
		border-radius: 50%;
		background: #ffd23f;
		color: #111;
		font-size: 1.1rem;
		cursor: pointer;
	}
	.replay-controls input[type='range'] {
		flex: 1;
		accent-color: #ffd23f;
	}
	.replay-credit {
		position: absolute;
		bottom: 4px;
		right: 8px;
		font-size: 0.65rem;
		color: rgba(255, 255, 255, 0.6);
		pointer-events: none;
	}
	:global(.replay-pos) {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: #ffd23f;
		border: 3px solid #fff;
		box-shadow: 0 0 8px rgba(0, 0, 0, 0.6);
	}
	:global(.replay-photo-pin) {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.7);
		border: 2px solid #ffd23f;
		transition: transform 0.2s;
	}
	:global(.replay-photo-pin.active) {
		transform: scale(1.8);
		background: #ffd23f;
	}
</style>
