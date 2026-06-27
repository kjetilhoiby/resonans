<!--
  TripMapStoryFull — fullskjerm scrollytelling for kartfortellingen.

  Kartet ligger fixed i bakgrunnen og er ALLTID synlig. Man scroller stegvis fra
  dag til dag; for hvert steg flyr kamera til strekningen mellom forrige og denne
  dagen, rutelinja vokser inkrementelt fram til dagen, og den aktive markøren lyser
  opp mens de andre dempes. Dag-innholdet (dato, vær, sted, oneliner, bilder) kommer
  som et kort over nedre halvdel med en mørk gradient bak teksten — kartet fades
  aldri bort. Frie bilde-nåler vises hele veien og lyser opp på sin egen dato.

  Åpnes fra «▶ Spill av» i TripMapStory. Gjenbruker dag-nåler, partialPath og den
  delte mørke basiskart-stilen (RESONANS_DARK_MAP_STYLE).
-->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { fade } from 'svelte/transition';
	import type { Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl';
	import { RESONANS_DARK_MAP_STYLE } from '../charts/mapStyle';
	import { partialPath, cumulativeFractions, type DayPin } from './trip-map-story';
	import type { ImagePin } from './trip-api';

	interface Props {
		dayPins: DayPin[];
		imagePins?: ImagePin[];
		onclose: () => void;
	}

	let { dayPins, imagePins = [], onclose }: Props = $props();

	let mapContainer = $state<HTMLDivElement | null>(null);
	let scroller = $state<HTMLDivElement | null>(null);
	let activeIndex = $state(-1); // -1 = intro-steget (oversikt over hele ruten)
	// Steg-høyde i ekte piksler. Vi kan IKKE stole på svh/dvh-CSS-enheter — i enkelte
	// in-app-browsere resol­verer de ikke, og da kollapser korte steg (outro/hale) til
	// innholdshøyde, så scrollen bunner før siste kort. window.innerHeight funker overalt.
	let vpH = $state(typeof window !== 'undefined' ? window.innerHeight : 800);

	let map: MapLibreMap | null = null;
	let mapReady = $state(false);
	let LngLatBoundsCtor: typeof import('maplibre-gl').LngLatBounds | null = null;
	const dayMarkers: MapLibreMarker[] = [];
	const dayMarkerEls: HTMLElement[] = [];
	const imageMarkers = new Map<string, MapLibreMarker>();
	let animTimer: number | null = null;
	let currentFraction = 0;
	let dayCardEls: HTMLElement[] = [];
	let scrollRaf: number | null = null;
	let dbg = $state(''); // midlertidig diagnose

	const routeCoords = $derived(dayPins.map((p) => [p.lon, p.lat] as [number, number]));
	const fractions = $derived(cumulativeFractions(routeCoords));

	const reduceMotion =
		typeof window !== 'undefined' &&
		window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

	function fmtDate(iso: string): string {
		try {
			return new Intl.DateTimeFormat('nb-NO', {
				weekday: 'long',
				day: 'numeric',
				month: 'long'
			}).format(new Date(`${iso}T12:00:00`));
		} catch {
			return iso;
		}
	}

	function fmtRange(): string {
		if (dayPins.length === 0) return '';
		const a = fmtDate(dayPins[0].date);
		const b = fmtDate(dayPins[dayPins.length - 1].date);
		return a === b ? a : `${a} – ${b}`;
	}

	async function initMap() {
		if (!mapContainer || typeof window === 'undefined' || map) return;
		const { Map, Marker, LngLatBounds } = await import('maplibre-gl');
		LngLatBoundsCtor = LngLatBounds; // lagres så applyStep kan være synkron (unngår race ved rask scroll)

		const start = routeCoords[0] ?? [10.75, 59.91];
		map = new Map({
			container: mapContainer,
			style: RESONANS_DARK_MAP_STYLE,
			center: start,
			zoom: 5,
			attributionControl: { compact: true },
			interactive: false // kamera styres av scroll — kartet er en lerret, ikke et leketøy
		});

		map.on('load', () => {
			if (!map) return;
			mapReady = true;
			map.resize();

			map.addSource('story-route', {
				type: 'geojson',
				data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } }
			});
			map.addLayer({
				id: 'story-route-shadow',
				type: 'line',
				source: 'story-route',
				layout: { 'line-cap': 'round', 'line-join': 'round' },
				paint: { 'line-color': 'rgba(0,0,0,0.4)', 'line-width': 7 }
			});
			map.addLayer({
				id: 'story-route-line',
				type: 'line',
				source: 'story-route',
				layout: { 'line-cap': 'round', 'line-join': 'round' },
				paint: { 'line-color': '#7c8ef5', 'line-width': 3.5 }
			});

			dayPins.forEach((pin, i) => {
				const el = document.createElement('div');
				el.className = 'tmf-day-marker';
				el.textContent = String(i + 1);
				const marker = new Marker({ element: el }).setLngLat([pin.lon, pin.lat]).addTo(map!);
				dayMarkers.push(marker);
				dayMarkerEls.push(el);
			});

			for (const pin of imagePins) {
				const el = document.createElement('div');
				el.className = 'tmf-img-marker';
				const img = document.createElement('img');
				img.src = pin.url;
				img.alt = pin.caption ?? '';
				el.appendChild(img);
				const marker = new Marker({ element: el }).setLngLat([pin.lon, pin.lat]).addTo(map!);
				imageMarkers.set(pin.id, marker);
			}

			// Start på oversikt: hele ruten i utsnittet, ingen markør fremhevet.
			if (routeCoords.length >= 2) {
				const bounds = new LngLatBounds(routeCoords[0], routeCoords[0]);
				for (const c of routeCoords) bounds.extend(c);
				map.fitBounds(bounds, { padding: framePadding(), maxZoom: 12, animate: false });
			} else if (routeCoords.length === 1) {
				map.setCenter(routeCoords[0]);
				map.setZoom(9);
			}

			// Reager på steget som allerede er synlig (intro ved åpning).
			applyStep(activeIndex);
		});
	}

	function setRouteData(coords: Array<[number, number]>) {
		const src = map?.getSource('story-route') as { setData: (d: unknown) => void } | undefined;
		src?.setData({
			type: 'Feature',
			properties: {},
			geometry: { type: 'LineString', coordinates: coords }
		});
	}

	function animateRouteTo(target: number) {
		if (!map) return;
		if (animTimer) cancelAnimationFrame(animTimer);
		const from = currentFraction;
		if (reduceMotion || routeCoords.length < 2) {
			currentFraction = target;
			setRouteData(partialPath(routeCoords, target));
			return;
		}
		const t0 = performance.now();
		const dur = 700;
		const step = (now: number) => {
			const t = Math.min(1, (now - t0) / dur);
			const eased = 1 - Math.pow(1 - t, 3);
			currentFraction = from + (target - from) * eased;
			setRouteData(partialPath(routeCoords, currentFraction));
			if (t < 1) animTimer = requestAnimationFrame(step);
		};
		animTimer = requestAnimationFrame(step);
	}

	// Bunn-padding holder den aktive nåla i øvre, ledige halvdel — over dag-kortet.
	function framePadding() {
		const h = typeof window !== 'undefined' ? window.innerHeight : 800;
		return { top: 80, bottom: Math.round(h * 0.5), left: 48, right: 48 };
	}

	function highlightMarker(index: number) {
		dayMarkerEls.forEach((el, i) => {
			const active = i === index;
			el.classList.toggle('is-active', active);
			el.classList.toggle('is-dimmed', index >= 0 && i > index);
			// Løft aktiv markør til topps. Flere dager på samme sted stables ellers
			// oppå hverandre, og den øverste (høyeste nr.) skjuler den aktive.
			el.style.zIndex = active ? '20' : '1';
		});
		const activeDate = index >= 0 ? dayPins[index]?.date : null;
		for (const pin of imagePins) {
			const el = imageMarkers.get(pin.id)?.getElement();
			if (el) el.classList.toggle('is-active', !!activeDate && pin.date === activeDate);
		}
	}

	// To koordinater regnes som samme sted hvis de er nærmere enn ~80 m. Flere dager
	// på samme sted (f.eks. hjemme) ga ellers en degenerert «strekning», og fitBounds
	// på et nullareal flytter ikke kameraet — så det ble hengende på forrige utsnitt.
	function sameSpot(a: [number, number], b: [number, number]): boolean {
		return Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.0008;
	}

	// Synkron: kjører umiddelbart per activeIndex-endring. Var tidligere async (await
	// import) — da kunne et gammelt kall vinne over et nyere ved rask scroll, så kart
	// og kort kom ut av synk.
	function applyStep(index: number) {
		if (!map || !mapReady || !LngLatBoundsCtor) return;

		if (index < 0) {
			// Intro/oversikt øverst: vis hele reisens utsnitt, men med blank rute —
			// så vokser linja naturlig fra dag 1 når man scroller (ingen retrett).
			highlightMarker(-1);
			if (routeCoords.length >= 2) {
				const bounds = new LngLatBoundsCtor(routeCoords[0], routeCoords[0]);
				for (const c of routeCoords) bounds.extend(c);
				map.fitBounds(bounds, { padding: framePadding(), maxZoom: 12, duration: 800 });
			}
			animateRouteTo(0);
			return;
		}

		highlightMarker(index);
		animateRouteTo(fractions[index] ?? 0);

		const here = routeCoords[index];
		const prev = index > 0 ? routeCoords[index - 1] : null;
		if (prev && !sameSpot(prev, here)) {
			// Reell reise fra forrige dag → ramm inn strekningen som ble reist.
			const bounds = new LngLatBoundsCtor(prev, prev);
			bounds.extend(here);
			map.fitBounds(bounds, {
				padding: framePadding(),
				maxZoom: 13,
				duration: reduceMotion ? 0 : 650
			});
		} else {
			// Første dag, eller samme sted som i går → senter på dagens punkt, fast zoom.
			map.flyTo({
				center: here,
				zoom: 12,
				padding: framePadding(),
				duration: reduceMotion ? 0 : 550
			});
		}
	}

	$effect(() => {
		const idx = activeIndex;
		if (mapReady) void applyStep(idx);
	});

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}

	// Aktiv dag = kortet hvis senter er nærmest «leselinja» (~58 % ned i bildet).
	// Vi måler selve KORTET, ikke steget — kortet er forankret nederst i steget,
	// så å observere stegets senter ville fått kamera til å ligge et hakk foran
	// kortet man faktisk leser. Helt øverst viser vi oversikten (-1).
	function updateActive() {
		if (!scroller) return;
		// VIKTIG: bruk den SYNLIGE viewporthøyden (window.innerHeight), ikke
		// scroller.clientHeight. I in-app-browsere er clientHeight (layout-viewporten)
		// større enn skjermen, mens kort-rektanglene fra getBoundingClientRect er
		// relativ til den synlige viewporten — bruker vi clientHeight havner leselinja
		// under skjermkanten og treffer et kort 1–2 hakk for langt ned.
		const vh = vpH || scroller.clientHeight;
		const target = vh * 0.5;
		let best = -1;
		let bestDist = Infinity;
		dayCardEls.forEach((el, i) => {
			if (!el) return;
			const r = el.getBoundingClientRect();
			const dist = Math.abs(r.top + r.height / 2 - target);
			if (dist < bestDist) {
				bestDist = dist;
				best = i;
			}
		});
		if (scroller.scrollTop < vh * 0.45) best = -1;
		activeIndex = best;
		dbg = `aktiv ${best} (${best >= 0 ? (dayPins[best]?.place ?? '?') : 'intro'}) · top ${Math.round(scroller.scrollTop)} · vpH ${vpH} · ch ${scroller.clientHeight}`;
	}

	function onScroll() {
		if (scrollRaf != null) return;
		scrollRaf = requestAnimationFrame(() => {
			scrollRaf = null;
			updateActive();
		});
	}

	// Mål viewport på nytt ved rotasjon (ikke ved hver resize — chrome som vises/skjules
	// under scroll ville ellers endret steg-høyden midt i scrollen og gitt hopp).
	function onOrient() {
		setTimeout(() => {
			vpH = window.innerHeight;
			updateActive();
		}, 250);
	}

	onMount(() => {
		document.body.style.overflow = 'hidden';
		vpH = window.innerHeight;
		void initMap();
		updateActive();
	});

	onDestroy(() => {
		document.body.style.overflow = '';
		if (animTimer) cancelAnimationFrame(animTimer);
		if (scrollRaf != null) cancelAnimationFrame(scrollRaf);
		map?.remove();
		map = null;
	});
</script>

<svelte:window onkeydown={onKey} onorientationchange={onOrient} />

<div class="tmf-root" transition:fade={{ duration: 220 }} style="--app-vh:{vpH}px">
	<div bind:this={mapContainer} class="tmf-map"></div>
	<div class="tmf-veil"></div>

	<button type="button" class="tmf-close" aria-label="Lukk kartfortelling" onclick={onclose} data-track="reise-kart:lukk-fullskjerm">✕</button>

	{#if dbg}<div class="tmf-debug">{dbg}</div>{/if}

	<div bind:this={scroller} class="tmf-scroller" onscroll={onScroll}>
		<!-- Intro / oversikt -->
		<section class="tmf-step tmf-step-intro">
			<div class="tmf-intro-card">
				<span class="tmf-kicker">🗺️ Kartfortelling</span>
				<h1 class="tmf-title">{fmtRange()}</h1>
				<p class="tmf-sub">{dayPins.length} {dayPins.length === 1 ? 'dag' : 'dager'} på kartet</p>
				<span class="tmf-scroll-hint">Scroll for å reise gjennom dagene ↓</span>
			</div>
		</section>

		{#each dayPins as pin, i (pin.date)}
			<section class="tmf-step">
				<div class="tmf-day-card" bind:this={dayCardEls[i]}>
					<div class="tmf-day-head">
						<span class="tmf-day-num">{i + 1}</span>
						<div class="tmf-day-meta">
							<span class="tmf-day-date">{fmtDate(pin.date)}</span>
							<span class="tmf-day-where">
								{#if pin.place}<span class="tmf-place">📍 {pin.place}</span>{/if}
								{#if pin.weatherEmoji}<span class="tmf-weather">{pin.weatherEmoji}{#if pin.weatherTemp != null}&nbsp;{pin.weatherTemp}°{/if}</span>{/if}
							</span>
						</div>
					</div>
					{#if pin.content}
						<p class="tmf-day-text">{pin.content}</p>
					{/if}
					{#if pin.images.length}
						<div class="tmf-day-imgs">
							{#each pin.images as url (url)}
								<img src={url} alt="" loading="lazy" />
							{/each}
						</div>
					{/if}
				</div>
			</section>
		{/each}

		<!-- Avslutning: tilbake til oversikt -->
		<section class="tmf-step tmf-step-outro">
			<div class="tmf-intro-card">
				<span class="tmf-kicker">Reisens slutt</span>
				<p class="tmf-sub">Hele ruten · {dayPins.length} {dayPins.length === 1 ? 'dag' : 'dager'}</p>
				<button type="button" class="tmf-done" onclick={onclose} data-track="reise-kart:fullfor-fullskjerm">Lukk</button>
			</div>
		</section>

		<div class="tmf-tail" aria-hidden="true"></div>
	</div>
</div>

<style>
	.tmf-root {
		position: fixed;
		inset: 0;
		z-index: 300;
		background: var(--tp-bg-0, #0b0f1a);
		overflow: hidden;
	}

	.tmf-map {
		position: absolute;
		inset: 0;
		/* Kartet er ikke-interaktivt; scrolleren over skal eie all touch. Uten
		   dette kan et langt trykk treffe kart-canvaset og trigge iOS sin
		   tekstmarkerings-meny i stedet for å scrolle. */
		pointer-events: none;
	}

	/* Lett vignett så hvite tekstkort alltid har kontrast mot kartet. */
	.tmf-veil {
		position: absolute;
		inset: 0;
		pointer-events: none;
		background: radial-gradient(120% 80% at 50% 0%, transparent 40%, rgba(0, 0, 0, 0.35) 100%);
	}

	.tmf-close {
		position: absolute;
		top: max(14px, env(safe-area-inset-top));
		right: 14px;
		z-index: 3;
		width: 40px;
		height: 40px;
		border-radius: 50%;
		border: 1px solid rgba(255, 255, 255, 0.18);
		background: rgba(0, 0, 0, 0.5);
		color: #fff;
		font-size: 1.1rem;
		line-height: 1;
		cursor: pointer;
		backdrop-filter: blur(6px);
	}
	.tmf-close:hover {
		background: rgba(0, 0, 0, 0.7);
	}

	/* Midlertidig diagnose-linje — fjernes når synk er bekreftet. */
	.tmf-debug {
		position: absolute;
		top: max(14px, env(safe-area-inset-top));
		left: 12px;
		z-index: 4;
		max-width: 72%;
		padding: 4px 8px;
		border-radius: 8px;
		background: rgba(0, 0, 0, 0.72);
		color: #9fffa0;
		font-size: 0.64rem;
		font-family: ui-monospace, monospace;
		line-height: 1.3;
		pointer-events: none;
	}

	/* Scrolleren dekker hele overlayet (inset:0) så den fanger ALL touch — ellers
	   blir det en død sone der kart-canvaset stjeler trykk og hindrer scroll.
	   At siste steg ikke gjemmer seg bak nettleser-chromet løses i stedet med rikelig
	   bunn-padding på stegene (kortene løftes over chromet). */
	.tmf-scroller {
		position: absolute;
		inset: 0;
		z-index: 2;
		overflow-y: auto;
		scroll-behavior: smooth;
		overscroll-behavior: contain;
		touch-action: pan-y;
		/* Drag skal scrolle, ikke markere tekst (unngår iOS-callout midt i fortellingen). */
		-webkit-user-select: none;
		user-select: none;
		-webkit-touch-callout: none;
	}

	.tmf-step {
		min-height: var(--app-vh, 100vh);
		display: flex;
		align-items: flex-end;
		/* Rikelig bunn-klaring: et aktivt kort er forankret nederst i steget, så
		   uten dette havner det rett over (eller bak) nettleserens bunn-bar. */
		padding: calc(env(safe-area-inset-top) + 64px) 16px calc(env(safe-area-inset-bottom) + 150px);
		box-sizing: border-box;
	}

	/* Ekstra scroll-rom etter siste steg, så det nederste dag-kortet alltid kan
	   løftes godt over nettleser-baren. */
	.tmf-tail {
		height: calc(var(--app-vh, 100vh) * 0.3);
		flex: 0 0 auto;
	}

	.tmf-step-intro,
	.tmf-step-outro {
		align-items: center;
		justify-content: center;
		text-align: center;
	}

	.tmf-intro-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 28px 24px;
		border-radius: 18px;
		background: rgba(10, 14, 26, 0.62);
		border: 1px solid rgba(255, 255, 255, 0.12);
		backdrop-filter: blur(8px);
		max-width: 420px;
	}
	.tmf-kicker {
		font-size: 0.82rem;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--tp-accent, #7c8ef5);
	}
	.tmf-title {
		margin: 0;
		font-size: 1.5rem;
		font-weight: 700;
		color: #fff;
		text-transform: capitalize;
	}
	.tmf-sub {
		margin: 0;
		color: rgba(255, 255, 255, 0.7);
		font-size: 0.92rem;
	}
	.tmf-scroll-hint {
		margin-top: 10px;
		font-size: 0.85rem;
		color: rgba(255, 255, 255, 0.55);
		animation: tmf-bob 1.8s ease-in-out infinite;
	}
	@keyframes tmf-bob {
		0%, 100% { transform: translateY(0); }
		50% { transform: translateY(4px); }
	}

	.tmf-done {
		margin-top: 12px;
		padding: 9px 22px;
		border-radius: 10px;
		border: 1px solid rgba(255, 255, 255, 0.22);
		background: var(--tp-accent, #7c8ef5);
		color: #0b0f1a;
		font-weight: 600;
		font-size: 0.9rem;
		cursor: pointer;
	}

	/* Dag-kortet: glir opp i nedre halvdel, mørk gradient bak teksten. */
	.tmf-day-card {
		width: 100%;
		max-width: 560px;
		margin: 0 auto;
		padding: 16px 18px;
		border-radius: 16px;
		background: linear-gradient(180deg, rgba(10, 14, 26, 0.78), rgba(10, 14, 26, 0.92));
		border: 1px solid rgba(255, 255, 255, 0.1);
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
		backdrop-filter: blur(10px);
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.tmf-day-head {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.tmf-day-num {
		flex: 0 0 auto;
		width: 30px;
		height: 30px;
		border-radius: 50%;
		background: var(--tp-accent, #7c8ef5);
		color: #0b0f1a;
		font-weight: 700;
		font-size: 0.88rem;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.tmf-day-meta {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.tmf-day-date {
		font-size: 1.02rem;
		font-weight: 600;
		color: #fff;
		text-transform: capitalize;
	}
	.tmf-day-where {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 10px;
		font-size: 0.85rem;
		color: rgba(255, 255, 255, 0.72);
	}
	.tmf-day-text {
		margin: 0;
		color: rgba(255, 255, 255, 0.92);
		font-size: 0.96rem;
		line-height: 1.45;
	}
	.tmf-day-imgs {
		display: flex;
		gap: 8px;
		overflow-x: auto;
		-webkit-overflow-scrolling: touch;
		margin: 0 -2px;
		padding: 2px;
	}
	.tmf-day-imgs img {
		height: 132px;
		width: auto;
		max-width: 78vw;
		flex: 0 0 auto;
		object-fit: cover;
		border-radius: 10px;
		border: 1px solid rgba(255, 255, 255, 0.12);
	}

	/* Markører (globalt — MapLibre rendrer utenfor scope). */
	:global(.tmf-day-marker) {
		width: 26px;
		height: 26px;
		border-radius: 50%;
		background: #7c8ef5;
		color: #0b0f1a;
		font-size: 0.78rem;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 2px solid #fff;
		box-shadow: 0 1px 5px rgba(0, 0, 0, 0.6);
		transition: transform 0.35s ease, opacity 0.35s ease, box-shadow 0.35s ease;
	}
	:global(.tmf-day-marker.is-dimmed) {
		opacity: 0.4;
	}
	:global(.tmf-day-marker.is-active) {
		transform: scale(1.45);
		opacity: 1;
		box-shadow: 0 0 0 6px rgba(124, 142, 245, 0.35), 0 2px 10px rgba(0, 0, 0, 0.7);
	}
	:global(.tmf-img-marker) {
		width: 38px;
		height: 38px;
		border-radius: 8px;
		overflow: hidden;
		border: 2px solid #fff;
		box-shadow: 0 1px 5px rgba(0, 0, 0, 0.6);
		opacity: 0.85;
		transition: transform 0.35s ease, opacity 0.35s ease, box-shadow 0.35s ease;
	}
	:global(.tmf-img-marker img) {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	:global(.tmf-img-marker.is-active) {
		transform: scale(1.3);
		opacity: 1;
		box-shadow: 0 0 0 5px rgba(124, 142, 245, 0.35), 0 2px 10px rgba(0, 0, 0, 0.7);
	}

	@media (prefers-reduced-motion: reduce) {
		.tmf-scroll-hint {
			animation: none;
		}
		:global(.tmf-day-marker),
		:global(.tmf-img-marker) {
			transition: none;
		}
	}
</style>
