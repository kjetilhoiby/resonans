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
		/** Foretrukket kartlag valgt ved deling ('topo' | 'sat'); ellers satellitt. */
		defaultBasemap?: string | null;
	}

	let {
		playback,
		title,
		sportType = null,
		startedAt = null,
		ownerName = null,
		defaultBasemap = null
	}: Props = $props();

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
	// Standard kartlag følger valget fra deling (Ekko) om satt; ellers satellitt
	// (global dekning). Topo (Kartverket) er alltid togglebar.
	let basemap = $state<Basemap>(defaultBasemap === 'topo' ? 'topo' : 'sat');

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
	// Rute-andelen (0..1) som vises nå. Driver tidslinja: avspilling øker den over tid,
	// og å dra i tidslinja setter den direkte (scrubbing). > 0 betyr «avspilling er i gang
	// eller satt på pause» → transporten viser tidslinje + pauseknapp i stedet for «Spill av».
	let progress = $state(0);
	// Transporten har startet (spiller, står på pause midtveis, eller er ferdig) → vis
	// tidslinje-baren. Før første avspilling vises bare den høyrejusterte «Spill av»-knappen.
	const transportActive = $derived(playing || finished || progress > 0);
	let lightboxIndex = $state<number | null>(null);
	const lightbox = $derived(lightboxIndex != null ? (imagePins[lightboxIndex] ?? null) : null);
	let touchStartX = 0;

	function closeLightbox() {
		lightboxIndex = null;
	}
	function stepLightbox(n: number) {
		if (lightboxIndex == null || imagePins.length === 0) return;
		lightboxIndex = (lightboxIndex + n + imagePins.length) % imagePins.length;
	}
	function onLightboxKey(e: KeyboardEvent) {
		if (lightboxIndex == null) return;
		if (e.key === 'Escape') closeLightbox();
		else if (e.key === 'ArrowLeft') stepLightbox(-1);
		else if (e.key === 'ArrowRight') stepLightbox(1);
	}
	function onLightboxTouchStart(e: TouchEvent) {
		touchStartX = e.changedTouches[0]?.clientX ?? 0;
	}
	function onLightboxTouchEnd(e: TouchEvent) {
		const dx = (e.changedTouches[0]?.clientX ?? 0) - touchStartX;
		if (Math.abs(dx) > 40) stepLightbox(dx < 0 ? 1 : -1);
	}
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
	/** Kompakt klokke (m:ss / t:mm:ss) for tidslinja. */
	function fmtClock(s: number): string {
		const sec = Math.max(0, Math.round(s));
		const h = Math.floor(sec / 3600);
		const m = Math.floor((sec % 3600) / 60);
		const ss = sec % 60;
		return h > 0
			? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
			: `${m}:${String(ss).padStart(2, '0')}`;
	}
	// Forløpt/total tid langs tidslinja. Uten lagret varighet vises prosent i stedet.
	const progressLabel = $derived.by(() => {
		const total = playback.stats.durationSeconds;
		if (total == null || total <= 0) return `${Math.round(progress * 100)} %`;
		return `${fmtClock(progress * total)} / ${fmtClock(total)}`;
	});
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
			if (id != null && pinsById[id]) lightboxIndex = Number(id);
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

	/**
	 * Tegner ett bilde av fly-through-en ved rute-andel `f` (0..1): vokser linja, avdekker
	 * bilder, flytter «hodet» og retter kamera i reiseretning. `smooth` lerp-er bearing (jevn
	 * avspilling); uten den settes bearing direkte (scrubbing skal treffe umiddelbart).
	 */
	function renderFrame(f: number, smooth: boolean) {
		if (!map) return;
		const eased = Math.max(0, Math.min(1, f));
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
		smoothedBearing = smooth ? lerpAngle(smoothedBearing, targetBearing, BEARING_LERP) : targetBearing;
		setHeadData(lead);
		map.jumpTo({ center: lead, zoom: FOLLOW_ZOOM, pitch: FOLLOW_PITCH, bearing: smoothedBearing });
		progress = eased;
	}

	// Tid-andel t → rute-andel (rask start, mjuk landing). Invers brukes for å gjenoppta
	// avspilling fra en vilkårlig posisjon (etter pause/scrubbing).
	const easeProgress = (t: number) => 1 - Math.pow(1 - t, 2);
	const invEaseProgress = (p: number) => 1 - Math.sqrt(Math.max(0, 1 - p));

	function play() {
		if (!map || !mapReady || coords.length < 2) return;
		stopLoop();
		finished = false;
		playing = true;

		if (reduceMotion) {
			renderFrame(1, false);
			progress = 1;
			playing = false;
			finished = true;
			return;
		}

		// Gjenoppta fra der vi står; er turen ferdig (eller ikke startet) begynner vi på nytt.
		const startProgress = progress >= 1 ? 0 : progress;
		if (startProgress === 0) {
			const startAhead = partialPath(coords, Math.min(1, lookaheadFraction));
			const startAim = startAhead[startAhead.length - 1] ?? coords[1] ?? coords[0];
			smoothedBearing = coords.length >= 2 ? bearingBetween(coords[0], startAim) : 0;
			map.jumpTo({ center: coords[0], zoom: FOLLOW_ZOOM, pitch: FOLLOW_PITCH, bearing: smoothedBearing });
		}

		const t0 = performance.now() - invEaseProgress(startProgress) * playDurationMs;
		const step = (now: number) => {
			if (!map) return;
			const t = Math.min(1, (now - t0) / playDurationMs);
			renderFrame(easeProgress(t), true);
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

	/** Setter avspillingen på pause og beholder posisjonen (tidslinja står stille). */
	function pause() {
		stopLoop();
		playing = false;
	}

	/** Scrubbing: hopp til en rute-andel fra tidslinja og stopp der (bruker styrer selv). */
	function scrubTo(f: number) {
		if (!map || coords.length < 2) return;
		stopLoop();
		playing = false;
		finished = f >= 1;
		renderFrame(f, false);
	}

	/** Play/pause-veksling for transport-knappen. */
	function togglePlay() {
		if (playing) pause();
		else play();
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
				data: {
					type: 'Feature' as const,
					properties: {},
					geometry: { type: 'LineString' as const, coordinates: [] as [number, number][] }
				}
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

	{#if mapReady && !preparing}
		<button
			type="button"
			class="wpb-basemap-btn"
			onclick={() => (basemap = basemap === 'sat' ? 'topo' : 'sat')}
			aria-label={basemap === 'sat' ? 'Bytt til topografisk kart' : 'Bytt til satellittkart'}
			title={basemap === 'sat' ? 'Topografisk kart' : 'Satellittkart'}
			data-track="tur-avspilling:kartlag"
		>
			<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">
				<path d="M12 2 2 7l10 5 10-5-10-5Z" />
				<path d="m2 17 10 5 10-5" />
				<path d="m2 12 10 5 10-5" />
			</svg>
		</button>
	{/if}

	{#if preparing}
		<div class="wpb-loading" aria-live="polite">
			<div class="wpb-spinner" aria-hidden="true"></div>
			<span>Forbereder 3D-terreng …</span>
		</div>
	{/if}

	{#if mapReady && !preparing}
		<div class="wpb-transport" class:wpb-transport-active={transportActive}>
			{#if !transportActive}
				<button type="button" class="wpb-play" onclick={play} data-track="tur-avspilling:spill-av">
					▶ Spill av
				</button>
			{:else}
				<div class="wpb-bar">
					<button
						type="button"
						class="wpb-toggle"
						onclick={togglePlay}
						aria-label={playing ? 'Pause' : finished ? 'Spill av igjen' : 'Fortsett avspilling'}
						data-track="tur-avspilling:play-pause"
					>
						{playing ? '⏸' : finished ? '↺' : '▶'}
					</button>
					<input
						type="range"
						class="wpb-timeline"
						min="0"
						max="1"
						step="0.001"
						value={progress}
						oninput={(e) => scrubTo(+e.currentTarget.value)}
						style={`--wpb-fill:${progress * 100}%`}
						aria-label="Tidslinje"
						data-track="tur-avspilling:tidslinje"
					/>
					<span class="wpb-time">{progressLabel}</span>
				</div>
			{/if}
		</div>
	{/if}

	{#if lightbox}
		<div class="wpb-lightbox" role="dialog" aria-modal="true" aria-label="Bilde fra turen">
			<!-- Bakteppe som knapp: klikk lukker, sveip bytter bilde. Bildet over er
			     pointer-transparent så sveip treffer bakteppet uansett hvor man drar. -->
			<button
				type="button"
				class="wpb-lb-backdrop"
				aria-label="Lukk bilde"
				onclick={closeLightbox}
				ontouchstart={onLightboxTouchStart}
				ontouchend={onLightboxTouchEnd}
				data-track="tur-avspilling:lukk-bilde"
			></button>

			<button
				type="button"
				class="wpb-lb-btn wpb-lb-close"
				aria-label="Lukk bilde"
				onclick={closeLightbox}
			>
				✕
			</button>
			{#if imagePins.length > 1}
				<button
					type="button"
					class="wpb-lb-btn wpb-lb-prev"
					aria-label="Forrige bilde"
					onclick={() => stepLightbox(-1)}
				>
					‹
				</button>
				<button
					type="button"
					class="wpb-lb-btn wpb-lb-next"
					aria-label="Neste bilde"
					onclick={() => stepLightbox(1)}
				>
					›
				</button>
			{/if}
			<figure>
				<img src={lightbox.url} alt={lightbox.caption ?? ''} />
				{#if lightbox.caption}<figcaption>{lightbox.caption}</figcaption>{/if}
			</figure>
			{#if imagePins.length > 1}
				<div class="wpb-lb-count">{(lightboxIndex ?? 0) + 1} / {imagePins.length}</div>
			{/if}
		</div>
	{/if}
</div>

<svelte:window onkeydown={onLightboxKey} />

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
		right: 16px;
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
	/* Transport: bunn-linje som holder «Spill av»-knappen (høyrejustert) og morfer til
	   tidslinje + pauseknapp under avspilling. Venstre kant klarer kartlag-knappen (left:16, 48px). */
	.wpb-transport {
		position: absolute;
		bottom: max(28px, calc(env(safe-area-inset-bottom) + 20px));
		left: 76px;
		right: 16px;
		z-index: 4;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		pointer-events: none;
	}
	.wpb-transport > * {
		pointer-events: auto;
	}
	.wpb-play {
		padding: 12px 28px;
		border-radius: 999px;
		border: 1px solid rgba(255, 255, 255, 0.25);
		background: #7c8ef5;
		color: #0b0f1a;
		font-weight: 700;
		font-size: 1rem;
		cursor: pointer;
		box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
		transition: background 0.15s ease;
	}
	.wpb-play:hover {
		background: #93a2f7;
	}
	/* Morfet transport-linje: pauseknapp + tidslinje + tid, i én pille. */
	.wpb-bar {
		display: flex;
		align-items: center;
		gap: 12px;
		width: min(520px, 100%);
		padding: 8px 16px 8px 8px;
		border-radius: 999px;
		border: 1px solid rgba(255, 255, 255, 0.22);
		background: rgba(10, 14, 26, 0.62);
		backdrop-filter: blur(8px);
		box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
	}
	.wpb-toggle {
		flex: 0 0 auto;
		width: 40px;
		height: 40px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		border: none;
		background: #7c8ef5;
		color: #0b0f1a;
		font-size: 1.05rem;
		line-height: 1;
		cursor: pointer;
		transition: background 0.15s ease;
	}
	.wpb-toggle:hover {
		background: #93a2f7;
	}
	.wpb-timeline {
		flex: 1 1 auto;
		min-width: 0;
		height: 6px;
		-webkit-appearance: none;
		appearance: none;
		border-radius: 999px;
		/* Fylt del (avspilt) i aksentfarge, resten dempet. --wpb-fill settes inline. */
		background: linear-gradient(
			to right,
			#7c8ef5 0%,
			#7c8ef5 var(--wpb-fill, 0%),
			rgba(255, 255, 255, 0.22) var(--wpb-fill, 0%),
			rgba(255, 255, 255, 0.22) 100%
		);
		cursor: pointer;
	}
	.wpb-timeline::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: #fff;
		border: 2px solid #7c8ef5;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
		cursor: pointer;
	}
	.wpb-timeline::-moz-range-thumb {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: #fff;
		border: 2px solid #7c8ef5;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
		cursor: pointer;
	}
	.wpb-time {
		flex: 0 0 auto;
		font-size: 0.75rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: rgba(255, 255, 255, 0.85);
		white-space: nowrap;
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
	/* Rund kartlag-knapp, venstrejustert på samme linje som «Spill av». */
	.wpb-basemap-btn {
		position: absolute;
		bottom: max(28px, calc(env(safe-area-inset-bottom) + 20px));
		left: 16px;
		z-index: 4;
		width: 48px;
		height: 48px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		border: 1px solid rgba(255, 255, 255, 0.22);
		background: rgba(10, 14, 26, 0.62);
		color: #fff;
		cursor: pointer;
		backdrop-filter: blur(8px);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
	}
	.wpb-basemap-btn:hover {
		background: rgba(24, 30, 48, 0.8);
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
	.wpb-lb-backdrop {
		position: absolute;
		inset: 0;
		z-index: 1;
		border: none;
		padding: 0;
		background: transparent;
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
		z-index: 2;
		pointer-events: none; /* slipp sveip gjennom til bakteppe-knappen */
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
	.wpb-lb-btn {
		position: absolute;
		z-index: 21;
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.14);
		color: #fff;
		cursor: pointer;
		backdrop-filter: blur(4px);
	}
	.wpb-lb-btn:hover {
		background: rgba(255, 255, 255, 0.26);
	}
	.wpb-lb-close {
		top: max(16px, env(safe-area-inset-top));
		right: 16px;
		width: 40px;
		height: 40px;
		font-size: 1.1rem;
	}
	.wpb-lb-prev,
	.wpb-lb-next {
		top: 50%;
		transform: translateY(-50%);
		width: 48px;
		height: 48px;
		font-size: 1.8rem;
		line-height: 1;
	}
	.wpb-lb-prev {
		left: 12px;
	}
	.wpb-lb-next {
		right: 12px;
	}
	.wpb-lb-count {
		position: absolute;
		bottom: max(20px, env(safe-area-inset-bottom));
		left: 50%;
		transform: translateX(-50%);
		z-index: 21;
		padding: 4px 12px;
		border-radius: 999px;
		background: rgba(0, 0, 0, 0.5);
		color: rgba(255, 255, 255, 0.85);
		font-size: 0.85rem;
		font-variant-numeric: tabular-nums;
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
