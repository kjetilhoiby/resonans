<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { RESONANS_DARK_MAP_STYLE, mapTransformRequest } from '$lib/components/charts/mapStyle';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let lat = $state(data.lastLat);
	let lng = $state(data.lastLon);
	let speedMps = $state(data.lastSpeedMps);
	let etaSeconds = $state(data.etaSeconds);
	let distanceRemainingM = $state(data.distanceRemainingM);
	let progressFraction = $state(data.progressFraction);
	let lastPingAt = $state(data.lastPingAt);
	let endedAt = $state(data.endedAt);
	let endedReason = $state(data.endedReason);
	let secondsSinceUpdate = $state(0);

	let map: maplibregl.Map | null = null;
	let posMarker: maplibregl.Marker | null = null;
	let destMarker: maplibregl.Marker | null = null;
	let pollInterval: ReturnType<typeof setInterval> | null = null;
	let tickInterval: ReturnType<typeof setInterval> | null = null;

	const isActive = $derived(!endedAt);
	const hasPosition = $derived(lat !== null && lng !== null);
	const hasDest = $derived(data.destLat !== null && data.destLon !== null);
	const speedKmh = $derived(speedMps !== null ? Math.round(speedMps * 3.6) : null);
	const isStale = $derived(secondsSinceUpdate > 120);
	const hasArrived = $derived(!isActive && endedReason === 'arrived');
	const arrivalClock = $derived(hasArrived && endedAt ? formatClock(endedAt) : null);

	function formatClock(ts: string): string {
		try {
			return new Date(ts).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
		} catch {
			return '';
		}
	}

	function formatEta(secs: number | null): string {
		if (secs === null) return '—';
		const min = Math.round(secs / 60);
		if (min < 1) return 'snart fremme';
		if (min < 60) return `ca. ${min} min`;
		const h = Math.floor(min / 60);
		const m = min % 60;
		return m === 0 ? `ca. ${h} t` : `ca. ${h} t ${m} min`;
	}

	function formatUpdated(secs: number): string {
		if (secs < 10) return 'akkurat nå';
		if (secs < 60) return `${secs} sek siden`;
		return `${Math.round(secs / 60)} min siden`;
	}

	function calcSecondsSince(ts: string | null): number {
		if (!ts) return 999;
		return Math.round((Date.now() - new Date(ts).getTime()) / 1000);
	}

	function createPositionDot(): HTMLDivElement {
		const el = document.createElement('div');
		el.style.cssText = 'width:20px;height:20px;border-radius:50%;background:#4285f4;border:3px solid #fff;box-shadow:0 0 0 2px rgba(66,133,244,.3);';
		return el;
	}

	function createDestPin(): HTMLDivElement {
		const el = document.createElement('div');
		el.style.cssText = 'width:14px;height:14px;border-radius:50%;background:#ef4444;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.3);';
		return el;
	}

	async function poll() {
		try {
			const res = await fetch(`/api/live/${data.token}`);
			if (!res.ok) return;
			const d = await res.json();
			lat = d.lastLat;
			lng = d.lastLon;
			speedMps = d.lastSpeedMps;
			etaSeconds = d.etaSeconds;
			distanceRemainingM = d.distanceRemainingM;
			progressFraction = d.progressFraction;
			lastPingAt = d.lastPingAt;
			endedAt = d.endedAt;
			endedReason = d.endedReason;
			secondsSinceUpdate = calcSecondsSince(d.lastPingAt);
			if (lat !== null && lng !== null) {
				posMarker?.setLngLat([lng, lat]);
				updateRouteProgress();
				map?.easeTo({ center: [lng, lat], duration: 1000 });
			}
			if (endedAt && pollInterval) {
				clearInterval(pollInterval);
				pollInterval = null;
			}
		} catch { /* neste poll prøver igjen */ }
	}

	function updateRouteProgress() {
		if (!map || lat === null || lng === null) return;
		const routeCoords = data.routeCoordinates as number[][] | null;
		if (!routeCoords || routeCoords.length < 2 || !map.getSource('route-progress')) return;

		let nearestIdx = 0;
		let nearestDist = Infinity;
		for (let i = 0; i < routeCoords.length; i++) {
			const dlat = routeCoords[i][0] - lat;
			const dlng = routeCoords[i][1] - lng;
			const dist = dlat * dlat + dlng * dlng;
			if (dist < nearestDist) { nearestDist = dist; nearestIdx = i; }
		}

		const completed = routeCoords.slice(0, nearestIdx + 1).map(c => [c[1], c[0]]);
		completed.push([lng, lat]);

		(map.getSource('route-progress') as maplibregl.GeoJSONSource).setData({
			type: 'Feature', properties: {},
			geometry: { type: 'LineString', coordinates: completed }
		});
	}

	onMount(async () => {
		secondsSinceUpdate = calcSecondsSince(lastPingAt);

		const maplibregl = await import('maplibre-gl');
		await import('maplibre-gl/dist/maplibre-gl.css');

		const mapEl = document.getElementById('live-map');
		if (!mapEl) return;

		const center: [number, number] =
			lat !== null && lng !== null ? [lng, lat]
			: data.destLon !== null && data.destLat !== null ? [data.destLon, data.destLat]
			: [10.75, 59.91];

		map = new maplibregl.Map({
			container: mapEl,
			style: RESONANS_DARK_MAP_STYLE,
			transformRequest: mapTransformRequest,
			center, zoom: 13,
			attributionControl: false
		});

		map.on('load', () => {
			if (!map) return;

			const routeCoords = data.routeCoordinates as number[][] | null;
			if (routeCoords && routeCoords.length >= 2) {
				map.addSource('route', {
					type: 'geojson',
					data: {
						type: 'Feature', properties: {},
						geometry: { type: 'LineString', coordinates: routeCoords.map(c => [c[1], c[0]]) }
					}
				});
				map.addLayer({
					id: 'route', type: 'line', source: 'route',
					paint: { 'line-color': '#94a3b8', 'line-width': 4, 'line-opacity': 0.5 }
				});
			}

			if (routeCoords && routeCoords.length >= 2) {
				map.addSource('route-progress', {
					type: 'geojson',
					data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } }
				});
				map.addLayer({
					id: 'route-progress', type: 'line', source: 'route-progress',
					paint: { 'line-color': '#4285f4', 'line-width': 4, 'line-opacity': 0.85 }
				});
				updateRouteProgress();
			}

			if (hasDest && data.destLon !== null && data.destLat !== null) {
				destMarker = new maplibregl.Marker({ element: createDestPin() })
					.setLngLat([data.destLon, data.destLat]).addTo(map);
				if (data.destLabel) {
					destMarker.setPopup(new maplibregl.Popup({ offset: 12, closeButton: false }).setText(data.destLabel));
					destMarker.togglePopup();
				}
			}

			if (hasPosition && lng !== null && lat !== null) {
				posMarker = new maplibregl.Marker({ element: createPositionDot() })
					.setLngLat([lng, lat]).addTo(map);
			}

			if (hasPosition && hasDest && lng !== null && lat !== null && data.destLon !== null && data.destLat !== null) {
				const bounds = new maplibregl.LngLatBounds([lng, lat], [data.destLon, data.destLat]);
				if (routeCoords) {
					for (const c of routeCoords) bounds.extend([c[1], c[0]]);
				}
				map.fitBounds(bounds, { padding: 60 });
			}
		});

		if (isActive) {
			pollInterval = setInterval(poll, 10_000);
		}
		tickInterval = setInterval(() => {
			secondsSinceUpdate = calcSecondsSince(lastPingAt);
		}, 1000);
	});

	onDestroy(() => {
		if (pollInterval) clearInterval(pollInterval);
		if (tickInterval) clearInterval(tickInterval);
		map?.remove();
	});
</script>

<svelte:head>
	<title>{data.ownerName ? `${data.ownerName} er underveis` : 'Live posisjon'}</title>
	<meta name="robots" content="noindex" />
	<meta property="og:title" content={data.ownerName ? `${data.ownerName} er underveis` : 'Live posisjon'} />
	<meta property="og:description" content={data.destLabel
		? `På vei til ${data.destLabel}${etaSeconds ? ` · ankomst ${formatEta(etaSeconds)}` : ''}`
		: 'Se live posisjon'} />
	<meta property="og:image" content={`/api/live/${data.token}/og.png`} />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
</svelte:head>

<main class="live-page">
	{#if !isActive}
		<div class="ended-banner">
			{#if hasArrived}
				Framme{#if arrivalClock} kl. {arrivalClock}{/if}!
			{:else}
				Turen er avsluttet
			{/if}
		</div>
	{/if}

	<div id="live-map" class="map"></div>

	<div class="info-card">
		<header>
			{#if data.ownerName}<div class="owner">{data.ownerName}</div>{/if}
			{#if data.routeLabel}
				<h1>{data.routeLabel}</h1>
			{/if}
			{#if data.destLabel}
				<p class="dest">→ {data.destLabel}</p>
			{/if}
		</header>

		{#if !hasPosition && isActive}
			<p class="empty">Venter på posisjon fra appen …</p>
		{:else if isActive}
			<div class="stats">
				<div class="stat">
					<span class="label">Ankomst</span>
					<span class="value">{formatEta(etaSeconds)}</span>
				</div>
				<div class="stat">
					<span class="label">Igjen</span>
					<span class="value">
						{distanceRemainingM !== null ? `${(distanceRemainingM / 1000).toFixed(1)} km` : '—'}
					</span>
				</div>
				<div class="stat">
					<span class="label">Fart</span>
					<span class="value">{speedKmh !== null ? `${speedKmh} km/t` : '—'}</span>
				</div>
			</div>
			<p class="updated" class:stale={isStale}>
				{formatUpdated(secondsSinceUpdate)}
				{#if isStale}<span class="stale-tag">· signal mistet</span>{/if}
			</p>
		{:else if hasArrived}
			<div class="arrived-summary">
				<span class="arrived-label">Framme</span>
				<span class="arrived-time">{arrivalClock ?? '—'}</span>
			</div>
		{/if}
	</div>
</main>

<style>
	.live-page {
		display: flex;
		flex-direction: column;
		height: 100dvh;
		position: relative;
		font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
		color: #1a1a1a;
	}
	.map {
		flex: 1;
		min-height: 200px;
	}
	.info-card {
		padding: 1rem 1rem 1.5rem;
	}
	.owner {
		font-size: 0.8rem;
		color: #999;
		margin-bottom: 0.15rem;
	}
	.info-card h1 {
		font-size: 1.3rem;
		margin: 0 0 0.1rem;
	}
	.dest {
		color: #555;
		margin: 0 0 0.75rem;
		font-size: 0.95rem;
	}
	.empty {
		color: #777;
		text-align: center;
		padding: 1rem 0;
	}
	.stats {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}
	.stat {
		background: #f4f5f9;
		border-radius: 8px;
		padding: 0.6rem;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.stat .label {
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #777;
	}
	.stat .value {
		font-size: 1.1rem;
		font-weight: 600;
	}
	.updated {
		font-size: 0.8rem;
		color: #999;
		text-align: center;
	}
	.updated.stale { color: #b16a00; }
	.stale-tag { margin-left: 0.2rem; }
	.arrived-summary {
		display: flex;
		align-items: baseline;
		justify-content: center;
		gap: 0.5rem;
		background: #ecfdf3;
		border: 1px solid #abefc6;
		border-radius: 8px;
		padding: 0.7rem;
	}
	.arrived-label {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #1a9c4f;
		font-weight: 600;
	}
	.arrived-time {
		font-size: 1.3rem;
		font-weight: 700;
		color: #1a1a1a;
	}
	.ended-banner {
		position: absolute;
		top: 1rem;
		left: 50%;
		transform: translateX(-50%);
		background: #22c55e;
		color: white;
		padding: 0.6rem 1.5rem;
		border-radius: 999px;
		font-weight: 600;
		font-size: 1.1rem;
		z-index: 1000;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
	}
</style>
