<!--
  TripMapStory — kartfortelling for et reise-tema.

  Tegner reisen som en animert linje fra sted til sted (én nål per dagboknotat
  med oneliner + bilder i popup), pluss frie «bilde-nåler» man kan plassere
  hvor som helst på kartet. Dag-nålenes koordinat kommer fra notatets geokodede
  sted (eller turens geoByDay). Bilde-nåler lagres på tripProfile.imagePins.

  Gjenbruker MapLibre + den delte mørke basiskart-stilen (RESONANS_DARK_MAP_STYLE).
-->
<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import type { Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl';
	import { RESONANS_DARK_MAP_STYLE } from '../charts/mapStyle';
	import SectionLabel from '../ui/SectionLabel.svelte';
	import { uploadImage } from '$lib/client/upload-image';
	import { buildDayPins, partialPath, type DayPin } from './trip-map-story';
	import { tripApi, type TripApi, type DayGeo, type ImagePin, type GeoCoord } from './trip-api';
	import TripMapStoryFull from './TripMapStoryFull.svelte';

	interface Props {
		themeId: string;
		geoByDay?: Record<string, DayGeo>;
		imagePins?: ImagePin[];
		center?: GeoCoord | null;
		/** Kalles når bilde-nåler endres, så forelderen kan oppdatere tripProfile. */
		onImagePinsChange?: (pins: ImagePin[]) => void;
		api?: TripApi;
		height?: number;
	}

	let {
		themeId,
		geoByDay = {},
		imagePins = [],
		center = null,
		onImagePinsChange,
		api = tripApi,
		height = 320
	}: Props = $props();

	let container = $state<HTMLDivElement | null>(null);
	let dayPins = $state<DayPin[]>([]);
	let pins = $state<ImagePin[]>([...imagePins]);
	let loading = $state(true);
	let placing = $state(false);
	let uploading = $state(false);
	let error = $state('');
	let fullscreen = $state(false);

	let map: MapLibreMap | null = null;
	let initStarted = false;
	let dayMarkers: MapLibreMarker[] = [];
	const imageMarkers = new Map<string, MapLibreMarker>();
	let fileInput: HTMLInputElement | null = null;
	let pendingLngLat: { lat: number; lon: number } | null = null;
	let animTimer: number | null = null;

	const hasContent = $derived(dayPins.length > 0 || pins.length > 0 || center != null);

	function escapeHtml(s: string): string {
		return s.replace(/[&<>"']/g, (c) =>
			c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
		);
	}

	function fmtDate(iso: string): string {
		try {
			return new Intl.DateTimeFormat('nb-NO', { weekday: 'short', day: 'numeric', month: 'short' }).format(
				new Date(`${iso}T12:00:00`)
			);
		} catch {
			return iso;
		}
	}

	function dayPopupHtml(pin: DayPin): string {
		const head = [
			`<strong>${escapeHtml(fmtDate(pin.date))}</strong>`,
			pin.weatherEmoji ? `${pin.weatherEmoji}${pin.weatherTemp != null ? ` ${pin.weatherTemp}°` : ''}` : '',
			pin.place ? `📍 ${escapeHtml(pin.place)}` : ''
		]
			.filter(Boolean)
			.join(' · ');
		const text = pin.content ? `<p class="tms-pop-text">${escapeHtml(pin.content)}</p>` : '';
		const imgs = pin.images.length
			? `<div class="tms-pop-imgs">${pin.images
					.map((u) => `<img src="${escapeHtml(u)}" alt="" loading="lazy" />`)
					.join('')}</div>`
			: '';
		return `<div class="tms-pop">${head}${text}${imgs}</div>`;
	}

	async function loadDiary() {
		loading = true;
		try {
			const entries = await api.getDiary(themeId);
			dayPins = buildDayPins(entries ?? [], geoByDay);
		} catch {
			dayPins = [];
		} finally {
			loading = false;
		}
	}

	async function initMap() {
		if (!container || typeof window === 'undefined' || initStarted) return;
		initStarted = true;
		const { Map, Marker, Popup, LngLatBounds } = await import('maplibre-gl');

		const dayCoords = dayPins.map((p) => [p.lon, p.lat] as [number, number]);
		const all: Array<[number, number]> = [
			...dayCoords,
			...pins.map((p) => [p.lon, p.lat] as [number, number]),
			...(center ? [[center.lon, center.lat] as [number, number]] : [])
		];
		const start = all[0] ?? [10.75, 59.91];

		map = new Map({
			container,
			style: RESONANS_DARK_MAP_STYLE,
			center: start,
			zoom: 5,
			attributionControl: { compact: true }
		});

		map.on('load', () => {
			if (!map) return;

			// Rutelinje (skygge + farge), starter tom og animeres inn.
			map.addSource('story-route', {
				type: 'geojson',
				data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } }
			});
			map.addLayer({
				id: 'story-route-shadow',
				type: 'line',
				source: 'story-route',
				layout: { 'line-cap': 'round', 'line-join': 'round' },
				paint: { 'line-color': 'rgba(0,0,0,0.35)', 'line-width': 6 }
			});
			map.addLayer({
				id: 'story-route-line',
				type: 'line',
				source: 'story-route',
				layout: { 'line-cap': 'round', 'line-join': 'round' },
				paint: { 'line-color': '#7c8ef5', 'line-width': 3 }
			});

			// Dag-nåler, nummerert i rekkefølge.
			dayPins.forEach((pin, i) => {
				const el = document.createElement('div');
				el.className = 'tms-day-marker';
				el.textContent = String(i + 1);
				const marker = new Marker({ element: el })
					.setLngLat([pin.lon, pin.lat])
					.setPopup(new Popup({ offset: 18, maxWidth: '240px' }).setHTML(dayPopupHtml(pin)))
					.addTo(map!);
				dayMarkers.push(marker);
			});

			// Eksisterende bilde-nåler.
			for (const pin of pins) addImageMarker(pin, Marker, Popup);

			// Tilpass utsnitt.
			if (all.length >= 2) {
				const bounds = new LngLatBounds(all[0], all[0]);
				for (const c of all) bounds.extend(c);
				map.fitBounds(bounds, { padding: 56, maxZoom: 12 });
			} else if (all.length === 1) {
				map.setCenter(all[0]);
				map.setZoom(9);
			}

			animateRoute();
		});

		// Plassering av bilde-nål: klikk på kartet → velg bilde.
		map.on('click', (e) => {
			if (!placing) return;
			pendingLngLat = { lat: e.lngLat.lat, lon: e.lngLat.lng };
			fileInput?.click();
		});
	}

	function setRouteData(coords: Array<[number, number]>) {
		const src = map?.getSource('story-route') as
			| { setData: (d: unknown) => void }
			| undefined;
		src?.setData({
			type: 'Feature',
			properties: {},
			geometry: { type: 'LineString', coordinates: coords }
		});
	}

	function animateRoute() {
		if (!map || dayPins.length < 2) return;
		const coords = dayPins.map((p) => [p.lon, p.lat] as [number, number]);
		const durationMs = Math.min(800 + dayPins.length * 350, 4000);
		const t0 = performance.now();
		if (animTimer) cancelAnimationFrame(animTimer);
		const step = (now: number) => {
			const f = Math.min(1, (now - t0) / durationMs);
			setRouteData(partialPath(coords, f));
			if (f < 1) animTimer = requestAnimationFrame(step);
		};
		animTimer = requestAnimationFrame(step);
	}

	function addImageMarker(
		pin: ImagePin,
		Marker: typeof import('maplibre-gl').Marker,
		Popup: typeof import('maplibre-gl').Popup
	) {
		if (!map) return;
		const el = document.createElement('div');
		el.className = 'tms-img-marker';
		const img = document.createElement('img');
		img.src = pin.url;
		img.alt = pin.caption ?? '';
		el.appendChild(img);

		const popupHtml =
			`<div class="tms-pop"><img class="tms-pop-single" src="${escapeHtml(pin.url)}" alt="" />` +
			(pin.caption ? `<p class="tms-pop-text">${escapeHtml(pin.caption)}</p>` : '') +
			`<button type="button" class="tms-pop-remove" data-pin="${escapeHtml(pin.id)}">Fjern nål</button></div>`;
		const popup = new Popup({ offset: 14, maxWidth: '220px' }).setHTML(popupHtml);
		popup.on('open', () => {
			const btn = popup.getElement()?.querySelector('.tms-pop-remove');
			btn?.addEventListener('click', () => removeImagePin(pin.id));
		});

		const marker = new Marker({ element: el }).setLngLat([pin.lon, pin.lat]).setPopup(popup).addTo(map);
		imageMarkers.set(pin.id, marker);
	}

	async function onFileChosen(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		const at = pendingLngLat;
		pendingLngLat = null;
		placing = false;
		if (!file || !at) return;

		uploading = true;
		error = '';
		try {
			const { url } = await uploadImage(file);
			const pin: ImagePin = { id: crypto.randomUUID(), url, lat: at.lat, lon: at.lon };
			const next = [...pins, pin];
			pins = next;
			const { Marker, Popup } = await import('maplibre-gl');
			addImageMarker(pin, Marker, Popup);
			await persistPins(next);
		} catch {
			error = 'Klarte ikke laste opp bildet.';
		} finally {
			uploading = false;
		}
	}

	async function removeImagePin(id: string) {
		imageMarkers.get(id)?.remove();
		imageMarkers.delete(id);
		const next = pins.filter((p) => p.id !== id);
		pins = next;
		await persistPins(next);
	}

	async function persistPins(next: ImagePin[]) {
		onImagePinsChange?.(next);
		try {
			await api.saveTripProfile(themeId, { imagePins: next });
		} catch {
			error = 'Klarte ikke lagre bilde-nålen.';
		}
	}

	onMount(() => {
		void loadDiary().then(() => {
			if (container && hasContent && !map) void initMap();
		});
	});

	// Init når data er klart og container montert (dekker rekkefølge-variasjoner).
	// Avhenger bevisst IKKE av `fullscreen`: gjenoppretting etter fullskjerm
	// gjøres av closeFullscreen() (etter tick), så vi aldri har to kart i live.
	$effect(() => {
		if (!loading && container && hasContent && !map) void initMap();
	});

	function teardownMap() {
		if (animTimer) cancelAnimationFrame(animTimer);
		animTimer = null;
		dayMarkers = [];
		imageMarkers.clear();
		map?.remove();
		map = null;
		initStarted = false;
	}

	// iOS Safari/webview tåler få samtidige WebGL-kontekster: to MapLibre-kart
	// (inline + fullskjerm) kan gjøre at det eldste mister konteksten og blir
	// svart. Derfor river vi inline-kartet mens fullskjerm er åpent, og bygger
	// det opp igjen ved lukking.
	function openFullscreen() {
		teardownMap();
		fullscreen = true;
	}

	async function closeFullscreen() {
		fullscreen = false;
		await tick(); // vent til fullskjerm-kartet er revet (onDestroy) før vi gjenoppretter inline
		if (container && hasContent && !map) void initMap();
	}

	onDestroy(() => {
		teardownMap();
	});
</script>

<div class="trip-map-story">
	<div class="tms-head">
		<SectionLabel>🗺️ Kartfortelling</SectionLabel>
		{#if hasContent}
			<div class="tms-actions">
				{#if dayPins.length >= 2}
					<button
						type="button"
						class="tms-btn"
						onclick={openFullscreen}
						data-track="reise-kart:spill-av">▶ Spill av</button
					>
				{/if}
				<button
					type="button"
					class="tms-btn"
					class:tms-btn-active={placing}
					onclick={() => (placing = !placing)}
					disabled={uploading}
					data-track="reise-kart:plasser-bilde"
				>
					{uploading ? 'Laster opp…' : placing ? '✕ Avbryt' : '📌 Plasser bilde'}
				</button>
			</div>
		{/if}
	</div>

	{#if placing}
		<p class="tms-hint">Trykk på kartet der bildet hører hjemme.</p>
	{/if}
	{#if error}
		<p class="tms-error">{error}</p>
	{/if}

	{#if loading}
		<p class="tms-empty">Laster kart …</p>
	{:else if !hasContent}
		<p class="tms-empty">
			Skriv sted på dagene i reisedagboka — så tegner kartet seg fra sted til sted her.
		</p>
	{/if}

	<div
		bind:this={container}
		class="tms-map"
		class:tms-placing={placing}
		style:height="{height}px"
		style:display={hasContent ? 'block' : 'none'}
	></div>

	<input
		bind:this={fileInput}
		type="file"
		accept="image/*"
		hidden
		onchange={onFileChosen}
		data-track="reise-kart:bilde-fil"
	/>
</div>

{#if fullscreen}
	<TripMapStoryFull {dayPins} imagePins={pins} onclose={closeFullscreen} />
{/if}

<style>
	.trip-map-story {
		padding: 12px 16px 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.tms-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	.tms-actions {
		display: flex;
		gap: 6px;
	}
	.tms-btn {
		background: var(--tp-bg-2);
		border: 1px solid var(--tp-border-strong, var(--tp-border));
		color: var(--tp-text-soft);
		border-radius: 8px;
		font-size: 0.78rem;
		padding: 5px 10px;
		cursor: pointer;
	}
	.tms-btn:hover:not(:disabled) {
		border-color: var(--tp-accent);
		color: var(--tp-text);
	}
	.tms-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.tms-btn-active {
		border-color: var(--tp-accent);
		color: var(--tp-accent);
		background: var(--tp-accent-bg);
	}
	.tms-hint {
		margin: 0;
		font-size: 0.8rem;
		color: var(--tp-accent);
	}
	.tms-error {
		margin: 0;
		font-size: 0.8rem;
		color: hsl(0 70% 70%);
	}
	.tms-empty {
		margin: 0;
		font-size: 0.85rem;
		color: var(--tp-text-muted);
	}
	.tms-map {
		width: 100%;
		border-radius: 12px;
		overflow: hidden;
		border: 1px solid var(--tp-border);
	}
	.tms-map.tms-placing {
		cursor: crosshair;
	}

	/* Markører og popup-innhold (globalt fordi MapLibre rendrer utenfor scope). */
	:global(.tms-day-marker) {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		background: #7c8ef5;
		color: #0b0f1a;
		font-size: 0.75rem;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 2px solid #fff;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
		cursor: pointer;
	}
	:global(.tms-img-marker) {
		width: 40px;
		height: 40px;
		border-radius: 8px;
		overflow: hidden;
		border: 2px solid #fff;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
		cursor: pointer;
	}
	:global(.tms-img-marker img) {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	:global(.tms-pop) {
		font-size: 0.82rem;
		color: #1a1a1a;
	}
	:global(.tms-pop-text) {
		margin: 4px 0 0;
	}
	:global(.tms-pop-imgs) {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 6px;
	}
	:global(.tms-pop-imgs img) {
		width: 64px;
		height: 64px;
		object-fit: cover;
		border-radius: 6px;
	}
	:global(.tms-pop-single) {
		width: 100%;
		border-radius: 6px;
		display: block;
	}
	:global(.tms-pop-remove) {
		margin-top: 6px;
		background: #f0f0f0;
		border: 1px solid #ccc;
		border-radius: 6px;
		font-size: 0.75rem;
		padding: 3px 8px;
		cursor: pointer;
	}
</style>
