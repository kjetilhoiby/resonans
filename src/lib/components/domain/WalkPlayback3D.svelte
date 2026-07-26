<!--
  WalkPlayback3D — 3D-avspilling av en gåtur.

  Kartet ligger fixed i bakgrunnen med terrenghøyde (raster-DEM) og en pitchet
  himmel, så landskapet reiser seg i relieff. Ved «spill av» flyr kamera langs
  ruten mens linja vokser og kameraet holder reiseretningen (bearing) — en 3D
  fly-through, ikke en flat 2D-animasjon. Vedlagte bilder dukker opp som markører
  når kamera passerer stedet de ble tatt; tapp for å se dem i full størrelse.

  Bygget på den delte mørke basiskart-stilen (RESONANS_DARK_MAP_STYLE) og
  partialPath fra kartfortellingen. Terrenget bruker gratis Terrarium-fliser
  (ingen API-nøkkel); feiler de, faller kartet trygt tilbake til flatt relieff.
-->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
	import { partialPath } from './trip-map-story';
	import type { WalkPlayback, WalkImagePin } from './walk-playback';

	interface Props {
		playback: WalkPlayback;
		title: string;
		sportType?: string | null;
		startedAt?: string | null;
		ownerName?: string | null;
	}

	let { playback, title, sportType = null, startedAt = null, ownerName = null }: Props = $props();

	const coords = $derived(playback.coords);
	const imagePins = $derived(playback.imagePins);

	// Gratis global terreng-DEM (Terrarium-encoding). Ingen nøkkel; feiler den,
	// blir kartet bare flatt — ingen krasj.
	const TERRAIN_DEM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

	// Raster-basiskart som draperes over terrenget. Vektor-stiler gir tynne linjer
	// (bekker/veier) som «gardiner» seg vertikalt over 3D-terreng — raster gjør ikke det,
	// og både topo (høydekurver) og satellitt er langt lettere å lese terreng på.
	const KARTVERKET_TOPO_TILES =
		'https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png';
	const ESRI_SAT_TILES =
		'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

	type Basemap = 'topo' | 'sat';
	let basemap = $state<Basemap>('topo');

	function buildStyle(initial: Basemap): StyleSpecification {
		return {
			version: 8,
			sources: {
				topo: {
					type: 'raster',
					tiles: [KARTVERKET_TOPO_TILES],
					tileSize: 256,
					maxzoom: 18,
					attribution: '© Kartverket'
				},
				sat: {
					type: 'raster',
					tiles: [ESRI_SAT_TILES],
					tileSize: 256,
					maxzoom: 19,
					attribution: 'Esri, Maxar, Earthstar Geographics'
				}
			},
			layers: [
				{
					id: 'basemap-topo',
					type: 'raster',
					source: 'topo',
					layout: { visibility: initial === 'topo' ? 'visible' : 'none' }
				},
				{
					id: 'basemap-sat',
					type: 'raster',
					source: 'sat',
					layout: { visibility: initial === 'sat' ? 'visible' : 'none' }
				}
			]
		};
	}

	// Bytt basiskart uten å bygge kartet på nytt.
	$effect(() => {
		const b = basemap;
		if (!map || !mapReady) return;
		map.setLayoutProperty('basemap-topo', 'visibility', b === 'topo' ? 'visible' : 'none');
		map.setLayoutProperty('basemap-sat', 'visibility', b === 'sat' ? 'visible' : 'none');
	});

	let mapContainer = $state<HTMLDivElement | null>(null);
	let map: MapLibreMap | null = null;
	let mapReady = $state(false);
	const pinsById: Record<string, WalkImagePin> = {};

	let playing = $state(false);
	let preparing = $state(true);
	let finished = $state(false);
	let lightbox = $state<WalkImagePin | null>(null);
	let raf: number | null = null;
	let smoothedBearing = 0;

	const reduceMotion =
		typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

	// Fly-through-lengde skalert med sporlengde, men holdt i et behagelig vindu.
	const playDurationMs = $derived(Math.min(22_000, Math.max(8_000, coords.length * 70)));
	// Roligere kamera (lavere zoom/pitch) → færre terreng-fliser i sikte, som rekker å lastes,
	// så vi unngår vertikale «gardiner» (stup mot ennå-ulastede høyde-0-fliser) og svarte tomrom.
	const FOLLOW_ZOOM = 13.8;
	const FOLLOW_PITCH = 52;
	// Lavere = roligere/saktere sving-til-side («stabilisert» uttrykk).
	const BEARING_LERP = 0.07;
	// Hvor langt fram (andel av ruta) kameraet sikter — ~220 m, klampet. Sikte-punktet ligger
	// forbi en skarp sving, så kameraet begynner å dreie før vi når den, og hårnåler dempes.
	const lookaheadFraction = $derived(
		Math.min(0.15, Math.max(0.02, 220 / (playback.stats.distanceMeters || 1000)))
	);

	function fmtDistance(m: number): string {
		return m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m)} m`;
	}
	function fmtDuration(s: number | null): string {
		if (s == null) return '';
		const h = Math.floor(s / 3600);
		const min = Math.round((s % 3600) / 60);
		return h > 0 ? `${h} t ${min} min` : `${min} min`;
	}
	function fmtStart(iso: string | null): string {
		if (!iso) return '';
		try {
			return new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' }).format(
				new Date(iso)
			);
		} catch {
			return '';
		}
	}

	function bearingBetween(a: [number, number], b: [number, number]): number {
		const toRad = (d: number) => (d * Math.PI) / 180;
		const toDeg = (r: number) => (r * 180) / Math.PI;
		const lon1 = toRad(a[0]);
		const lat1 = toRad(a[1]);
		const lon2 = toRad(b[0]);
		const lat2 = toRad(b[1]);
		const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
		const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
		return (toDeg(Math.atan2(y, x)) + 360) % 360;
	}

	// Korteste vinkel-lerp så bearing ikke spinner den lange veien rundt.
	function lerpAngle(from: number, to: number, t: number): number {
		let diff = ((to - from + 540) % 360) - 180;
		return (from + diff * t + 360) % 360;
	}

	function setRouteData(part: Array<[number, number]>) {
		const src = map?.getSource('walk-route') as { setData: (d: unknown) => void } | undefined;
		src?.setData({
			type: 'Feature',
			properties: {},
			geometry: { type: 'LineString', coordinates: part }
		});
	}

	function headFeature(lngLat: [number, number]) {
		return {
			type: 'Feature' as const,
			properties: {},
			geometry: { type: 'Point' as const, coordinates: lngLat }
		};
	}
	function setHeadData(lngLat: [number, number]) {
		const src = map?.getSource('walk-head') as { setData: (d: unknown) => void } | undefined;
		src?.setData(headFeature(lngLat));
	}

	// Bildene tegnes som et symbol-lag (kart-rendret) i stedet for DOM-markører, så de er
	// terreng-korrekt plassert og ikke henger etter når kartet panner.
	function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
		ctx.beginPath();
		ctx.moveTo(x + r, y);
		ctx.arcTo(x + w, y, x + w, y + h, r);
		ctx.arcTo(x + w, y + h, x, y + h, r);
		ctx.arcTo(x, y + h, x, y, r);
		ctx.arcTo(x, y, x + w, y, r);
		ctx.closePath();
	}

	function photoCollection(revealFraction: number) {
		return {
			type: 'FeatureCollection' as const,
			features: imagePins
				.map((pin, i) => ({ pin, i }))
				.filter(({ pin }) => pin.fraction <= revealFraction + 0.001)
				.map(({ pin, i }) => ({
					type: 'Feature' as const,
					properties: { icon: `wpb-photo-${i}`, pin: String(i) },
					geometry: { type: 'Point' as const, coordinates: [pin.lon, pin.lat] as [number, number] }
				}))
		};
	}

	function setPhotosRevealed(fraction: number) {
		const src = map?.getSource('walk-photos') as { setData: (d: unknown) => void } | undefined;
		src?.setData(photoCollection(fraction));
	}

	/** Laster ett bilde, tegner et avrundet miniatyr på canvas og registrerer det som kart-ikon. */
	function loadPhotoIcon(pin: WalkImagePin, i: number, size: number): Promise<void> {
		return new Promise((resolve) => {
			const img = new Image();
			img.crossOrigin = 'anonymous';
			img.onload = () => {
				pinsById[String(i)] = pin;
				const name = `wpb-photo-${i}`;
				try {
					const canvas = document.createElement('canvas');
					canvas.width = size;
					canvas.height = size;
					const ctx = canvas.getContext('2d');
					if (!ctx || !map) return resolve();
					const b = 4;
					roundRect(ctx, 0, 0, size, size, 14);
					ctx.fillStyle = '#fff';
					ctx.fill();
					ctx.save();
					roundRect(ctx, b, b, size - 2 * b, size - 2 * b, 11);
					ctx.clip();
					const inner = size - 2 * b;
					const scale = Math.max(inner / img.width, inner / img.height);
					const w = img.width * scale;
					const h = img.height * scale;
					ctx.drawImage(img, b + (inner - w) / 2, b + (inner - h) / 2, w, h);
					ctx.restore();
					const data = ctx.getImageData(0, 0, size, size);
					if (!map.hasImage(name)) map.addImage(name, data, { pixelRatio: 2 });
				} catch {
					// Tainted canvas / CORS → hopp over miniatyr for dette bildet.
				}
				resolve();
			};
			img.onerror = () => resolve();
			img.src = pin.url;
		});
	}

	async function addPhotoLayer() {
		if (!map || !imagePins.length) return;
		await Promise.all(imagePins.map((pin, i) => loadPhotoIcon(pin, i, 108)));
		if (!map) return;
		map.addSource('walk-photos', { type: 'geojson', data: photoCollection(0) });
		map.addLayer({
			id: 'walk-photos',
			type: 'symbol',
			source: 'walk-photos',
			layout: {
				'icon-image': ['get', 'icon'],
				'icon-size': 0.9,
				'icon-anchor': 'bottom',
				'icon-allow-overlap': true
			}
		});
		map.on('click', 'walk-photos', (e) => {
			const id = e.features?.[0]?.properties?.pin as string | undefined;
			if (id != null && pinsById[id]) lightbox = pinsById[id];
		});
		map.on('mouseenter', 'walk-photos', () => {
			if (map) map.getCanvas().style.cursor = 'pointer';
		});
		map.on('mouseleave', 'walk-photos', () => {
			if (map) map.getCanvas().style.cursor = '';
		});
	}

	async function fitWholeRoute(animate: boolean) {
		if (!map) return;
		const [[minLon, minLat], [maxLon, maxLat]] = playback.bounds;
		if (coords.length >= 2) {
			const { LngLatBounds } = await import('maplibre-gl');
			if (!map) return;
			const b = new LngLatBounds([minLon, minLat], [maxLon, maxLat]);
			map.easeTo({ pitch: 30, bearing: 0, duration: animate ? 900 : 0 });
			map.fitBounds(b, { padding: 70, maxZoom: 14, pitch: 30, animate });
		} else if (coords.length === 1) {
			map.jumpTo({ center: coords[0], zoom: 14, pitch: 30 });
		}
	}

	/** Venter til kartet har lastet ferdig flisene i sikte (eller til timeout). */
	function waitForTiles(timeoutMs = 6000): Promise<void> {
		return new Promise((resolve) => {
			if (!map) return resolve();
			let done = false;
			const finish = () => {
				if (done) return;
				done = true;
				resolve();
			};
			map.once('idle', finish);
			setTimeout(finish, timeoutMs);
		});
	}

	/**
	 * Forhåndslaster fliser langs hele rute-korridoren ved fly-through-zoom, så avspillingen
	 * flyr gjennom allerede-lastet terreng/kart (i stedet for å chase fliser frame for frame).
	 * MapLibre har ingen keepBuffer; dette er «buffer»-en — vi feier kamera langs ruta og lar
	 * flisene fylle cachen først. Skjules bak et «forbereder»-dekke.
	 */
	async function prewarmRoute() {
		if (!map || coords.length < 2) return;
		const steps = Math.min(12, Math.max(4, Math.round(coords.length / 12)));
		const startedAtMs = performance.now();
		for (let i = 0; i <= steps; i++) {
			if (!map) return;
			const idx = Math.min(coords.length - 1, Math.round((i / steps) * (coords.length - 1)));
			const ahead = Math.min(coords.length - 1, idx + 3);
			const behind = Math.max(0, idx - 3);
			map.jumpTo({
				center: coords[idx],
				zoom: FOLLOW_ZOOM,
				pitch: FOLLOW_PITCH,
				bearing: bearingBetween(coords[behind], coords[ahead])
			});
			await waitForTiles(2000);
			if (performance.now() - startedAtMs > 14000) break; // hard tak
		}
	}

	function stopLoop() {
		if (raf != null) cancelAnimationFrame(raf);
		raf = null;
	}

	function play() {
		if (!map || !mapReady || coords.length < 2) return;
		stopLoop();
		finished = false;
		playing = true;

		if (reduceMotion) {
			setRouteData(coords);
			setHeadData(coords[coords.length - 1]);
			setPhotosRevealed(1);
			fitWholeRoute(false);
			playing = false;
			finished = true;
			return;
		}

		const startAhead = partialPath(coords, Math.min(1, lookaheadFraction));
		const startAim = startAhead[startAhead.length - 1] ?? coords[1] ?? coords[0];
		smoothedBearing = coords.length >= 2 ? bearingBetween(coords[0], startAim) : 0;
		map.jumpTo({ center: coords[0], zoom: FOLLOW_ZOOM, pitch: FOLLOW_PITCH, bearing: smoothedBearing });

		const t0 = performance.now();
		const step = (now: number) => {
			if (!map) return;
			const t = Math.min(1, (now - t0) / playDurationMs);
			const eased = 1 - Math.pow(1 - t, 2);
			const part = partialPath(coords, eased);
			setRouteData(part);
			setPhotosRevealed(eased);

			const lead = part[part.length - 1] ?? coords[0];
			// Sikt mot et punkt et stykke fram på hele ruta (ikke bare siste segment): kameraet
			// begynner å svinge før en skarp sving, og hårnåler/zig-zag «stabiliseres» fordi
			// sikte-punktet ligger lenger opp ruta enn selve svingen.
			const ahead = partialPath(coords, Math.min(1, eased + lookaheadFraction));
			const aim = ahead[ahead.length - 1] ?? lead;
			const targetBearing =
				aim[0] === lead[0] && aim[1] === lead[1] ? smoothedBearing : bearingBetween(lead, aim);
			smoothedBearing = lerpAngle(smoothedBearing, targetBearing, BEARING_LERP);
			setHeadData(lead);
			map.jumpTo({ center: lead, zoom: FOLLOW_ZOOM, pitch: FOLLOW_PITCH, bearing: smoothedBearing });

			if (t < 1) {
				raf = requestAnimationFrame(step);
			} else {
				playing = false;
				finished = true;
				fitWholeRoute(true);
			}
		};
		raf = requestAnimationFrame(step);
	}

	async function initMap() {
		if (!mapContainer || typeof window === 'undefined' || map) return;
		const { Map } = await import('maplibre-gl');

		map = new Map({
			container: mapContainer,
			style: buildStyle(basemap),
			center: playback.center[0] === 0 && playback.center[1] === 0 ? [10.75, 59.91] : playback.center,
			zoom: 9,
			pitch: 30,
			// Større flis-cache så hele rute-korridoren holdes lastet gjennom fly-through
			// (default kan evicte fliser bak kamera → popping når man svinger tilbake).
			maxTileCacheSize: 600,
			attributionControl: { compact: true }
		});

		map.on('load', async () => {
			if (!map) return;
			mapReady = true;
			map.resize();

			// Terreng-relieff. Trygt om DEM-flisene feiler — kartet blir bare flatt.
			try {
				map.addSource('terrain-dem', {
					type: 'raster-dem',
					tiles: [TERRAIN_DEM_TILES],
					encoding: 'terrarium',
					tileSize: 256,
					// Lav maxzoom → få, store DEM-fliser som dekker hele turen og lastes raskt
					// (overzoomes for nærbilde). Nok relieff for en fottur, langt mindre popping.
					maxzoom: 12,
					attribution: 'Terrain © AWS Terrain Tiles'
				});
				map.setTerrain({ source: 'terrain-dem', exaggeration: 1.2 });
				map.setSky({
					'sky-color': '#0b1020',
					'horizon-color': '#25304d',
					'fog-color': '#0b0f1a',
					'sky-horizon-blend': 0.6,
					'horizon-fog-blend': 0.6,
					'fog-ground-blend': 0.4
				});
			} catch {
				// Ignorer — pitchet fly-through fungerer også uten terreng.
			}

			map.addSource('walk-route', {
				type: 'geojson',
				data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } }
			});
			map.addLayer({
				id: 'walk-route-shadow',
				type: 'line',
				source: 'walk-route',
				layout: { 'line-cap': 'round', 'line-join': 'round' },
				paint: { 'line-color': 'rgba(0,0,0,0.45)', 'line-width': 8 }
			});
			map.addLayer({
				id: 'walk-route-line',
				type: 'line',
				source: 'walk-route',
				layout: { 'line-cap': 'round', 'line-join': 'round' },
				paint: { 'line-color': '#7c8ef5', 'line-width': 4 }
			});

			// Ledende «hode»-prikk som circle-lag: tegnes i skjermrom oppå kartet, så terreng
			// aldri skjuler den (til forskjell fra en DOM-markør, som okkluderes av 3D-terreng).
			map.addSource('walk-head', {
				type: 'geojson',
				data: headFeature(coords[0] ?? playback.center)
			});
			map.addLayer({
				id: 'walk-head',
				type: 'circle',
				source: 'walk-head',
				paint: {
					'circle-radius': 7,
					'circle-color': '#ffffff',
					'circle-stroke-color': '#7c8ef5',
					'circle-stroke-width': 3
				}
			});

			// Bilde-markører som kart-lag (skjult til kamera passerer stedet).
			await addPhotoLayer();
			if (!map) return;

			await fitWholeRoute(false);
			// Vent til oversikts-flisene er lastet, fei så gjennom korridoren for å forhåndslaste
			// fly-through-flisene, så vi ikke flyr inn i ennå-ulastede høyde-0-fliser (gardiner).
			await waitForTiles();
			if (!map) return;
			await prewarmRoute();
			if (!map) return;
			await fitWholeRoute(false);
			preparing = false;
			// Vis hele ruta som forhåndsvisning — brukeren starter selv fly-through med «Spill av».
			setRouteData(coords);
			setHeadData(coords[coords.length - 1]);
			setPhotosRevealed(1);
			if (reduceMotion) play();
		});
	}

	onMount(() => {
		void initMap();
	});

	onDestroy(() => {
		stopLoop();
		map?.remove();
		map = null;
	});
</script>

<div class="wpb-root">
	<div bind:this={mapContainer} class="wpb-map"></div>
	<div class="wpb-veil" aria-hidden="true"></div>

	<header class="wpb-header">
		<span class="wpb-kicker">🥾 3D-avspilling{ownerName ? ` · delt av ${ownerName}` : ''}</span>
		<h1 class="wpb-title">{title}</h1>
		{#if startedAt}<p class="wpb-when">{fmtStart(startedAt)}</p>{/if}
		<div class="wpb-stats">
			<span>{fmtDistance(playback.stats.distanceMeters)}</span>
			{#if playback.stats.durationSeconds != null}<span>· {fmtDuration(playback.stats.durationSeconds)}</span>{/if}
			{#if playback.stats.ascentMeters > 0}<span>· ↑ {playback.stats.ascentMeters} m</span>{/if}
			{#if imagePins.length}<span>· 📷 {imagePins.length}</span>{/if}
		</div>
	</header>

	<div class="wpb-basemap" role="group" aria-label="Kartlag">
		<button
			type="button"
			class:active={basemap === 'topo'}
			onclick={() => (basemap = 'topo')}
			data-track="tur-avspilling:kart-topo"
		>
			Topo
		</button>
		<button
			type="button"
			class:active={basemap === 'sat'}
			onclick={() => (basemap = 'sat')}
			data-track="tur-avspilling:kart-satellitt"
		>
			Satellitt
		</button>
	</div>

	{#if preparing}
		<div class="wpb-loading" aria-live="polite">
			<div class="wpb-spinner" aria-hidden="true"></div>
			<span>Forbereder 3D-terreng …</span>
		</div>
	{/if}

	{#if mapReady && !playing && !preparing}
		<button type="button" class="wpb-play" onclick={play} data-track="tur-avspilling:spill-av">
			{finished ? '↺ Spill av igjen' : '▶ Spill av'}
		</button>
	{/if}

	{#if lightbox}
		<button
			type="button"
			class="wpb-lightbox"
			aria-label="Lukk bilde"
			onclick={() => (lightbox = null)}
			data-track="tur-avspilling:lukk-bilde"
		>
			<figure>
				<img src={lightbox.url} alt={lightbox.caption ?? ''} />
				{#if lightbox.caption}<figcaption>{lightbox.caption}</figcaption>{/if}
			</figure>
		</button>
	{/if}
</div>

<style>
	.wpb-root {
		position: relative;
		width: 100%;
		height: 100dvh;
		background: #0b0f1a;
		overflow: hidden;
	}
	.wpb-map {
		position: absolute;
		inset: 0;
		z-index: 0;
		isolation: isolate;
	}
	.wpb-veil {
		position: absolute;
		inset: 0;
		z-index: 1;
		pointer-events: none;
		background: radial-gradient(120% 70% at 50% 0%, rgba(0, 0, 0, 0.5) 0%, transparent 45%);
	}
	.wpb-header {
		position: absolute;
		top: max(16px, env(safe-area-inset-top));
		left: 16px;
		right: 140px; /* gi plass til kartlag-velgeren øverst til høyre */
		z-index: 3;
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 14px 16px;
		border-radius: 14px;
		background: rgba(10, 14, 26, 0.62);
		border: 1px solid rgba(255, 255, 255, 0.12);
		backdrop-filter: blur(8px);
		max-width: 460px;
		pointer-events: none;
	}
	.wpb-kicker {
		font-size: 0.78rem;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		color: #7c8ef5;
	}
	.wpb-title {
		margin: 0;
		font-size: 1.3rem;
		font-weight: 700;
		color: #fff;
		text-transform: capitalize;
	}
	.wpb-when {
		margin: 0;
		font-size: 0.85rem;
		color: rgba(255, 255, 255, 0.68);
		text-transform: capitalize;
	}
	.wpb-stats {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 4px;
		font-size: 0.9rem;
		font-weight: 600;
		color: rgba(255, 255, 255, 0.9);
	}
	.wpb-play {
		position: absolute;
		bottom: max(28px, calc(env(safe-area-inset-bottom) + 20px));
		left: 50%;
		transform: translateX(-50%);
		z-index: 4;
		padding: 12px 28px;
		border-radius: 999px;
		border: 1px solid rgba(255, 255, 255, 0.25);
		background: #7c8ef5;
		color: #0b0f1a;
		font-weight: 700;
		font-size: 1rem;
		cursor: pointer;
		box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
	}
	.wpb-play:hover {
		background: #93a2f7;
	}
	.wpb-loading {
		position: absolute;
		inset: 0;
		z-index: 2;
		display: flex;
		flex-direction: column;
		gap: 14px;
		align-items: center;
		justify-content: center;
		background: #0b0f1a;
		color: rgba(255, 255, 255, 0.85);
		font-size: 0.95rem;
		font-weight: 600;
	}
	.wpb-spinner {
		width: 34px;
		height: 34px;
		border-radius: 50%;
		border: 3px solid rgba(255, 255, 255, 0.2);
		border-top-color: #7c8ef5;
		animation: wpb-spin 0.8s linear infinite;
	}
	@keyframes wpb-spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.wpb-spinner {
			animation-duration: 2s;
		}
	}
	.wpb-basemap {
		position: absolute;
		top: max(16px, env(safe-area-inset-top));
		right: 16px;
		z-index: 4;
		display: flex;
		gap: 2px;
		padding: 3px;
		border-radius: 999px;
		background: rgba(10, 14, 26, 0.62);
		border: 1px solid rgba(255, 255, 255, 0.12);
		backdrop-filter: blur(8px);
	}
	.wpb-basemap button {
		padding: 6px 14px;
		border: none;
		border-radius: 999px;
		background: transparent;
		color: rgba(255, 255, 255, 0.7);
		font-size: 0.82rem;
		font-weight: 600;
		cursor: pointer;
	}
	.wpb-basemap button.active {
		background: #7c8ef5;
		color: #0b0f1a;
	}
	/* Minimer krediteringen: liten, diskret ⓘ nede til høyre. */
	:global(.maplibregl-ctrl-bottom-right .maplibregl-ctrl-attrib) {
		font-size: 9px;
		opacity: 0.45;
		background: transparent;
	}
	:global(.maplibregl-ctrl-attrib-button) {
		opacity: 0.45;
		transform: scale(0.85);
	}
	.wpb-lightbox {
		position: fixed;
		inset: 0;
		z-index: 20;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px;
		border: none;
		background: rgba(0, 0, 0, 0.88);
		cursor: zoom-out;
	}
	.wpb-lightbox figure {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
		align-items: center;
		max-width: 100%;
		max-height: 100%;
	}
	.wpb-lightbox img {
		max-width: 100%;
		max-height: 78dvh;
		border-radius: 12px;
		object-fit: contain;
		box-shadow: 0 8px 40px rgba(0, 0, 0, 0.6);
	}
	.wpb-lightbox figcaption {
		color: rgba(255, 255, 255, 0.85);
		font-size: 0.95rem;
		text-align: center;
	}

	/* Markører (globalt — MapLibre rendrer utenfor scope). */
	:global(.wpb-head) {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: #fff;
		border: 3px solid #7c8ef5;
		box-shadow: 0 0 0 5px rgba(124, 142, 245, 0.35), 0 2px 8px rgba(0, 0, 0, 0.7);
	}
	:global(.wpb-img-marker) {
		width: 46px;
		height: 46px;
		padding: 0;
		border-radius: 10px;
		overflow: hidden;
		border: 2px solid #fff;
		background: #0b0f1a;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.7);
		cursor: pointer;
		opacity: 0;
		transform: scale(0.4) translateY(8px);
		transition: opacity 0.4s ease, transform 0.4s ease;
		pointer-events: none;
	}
	:global(.wpb-img-marker.is-visible) {
		opacity: 1;
		transform: scale(1) translateY(0);
		pointer-events: auto;
	}
	:global(.wpb-img-marker img) {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	@media (prefers-reduced-motion: reduce) {
		:global(.wpb-img-marker) {
			transition: none;
		}
	}
</style>
