<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

	type Resource = {
		kind: 'tripPosition';
		ownerName: string | null;
		sportType: string;
		routeLabel: string | null;
		routeCoordinates: [number, number][] | null;
		destLat: number | null;
		destLon: number | null;
		destLabel: string | null;
		routeDistanceM: number | null;
		lastLat: number | null;
		lastLon: number | null;
		lastSpeedMps: number | null;
		etaSeconds: number | null;
		distanceRemainingM: number | null;
		progressFraction: number | null;
		startedAt: string;
		lastPingAt: string | null;
		endedAt: string | null;
		endedReason: string | null;
	};

	let { resource, token }: { resource: Resource; token: string } = $props();

	let lat = $state(resource.lastLat);
	let lng = $state(resource.lastLon);
	let speedMps = $state(resource.lastSpeedMps);
	let etaSeconds = $state(resource.etaSeconds);
	let distanceRemainingM = $state(resource.distanceRemainingM);
	let progressFraction = $state(resource.progressFraction);
	let lastPingAt = $state(resource.lastPingAt);
	let endedAt = $state(resource.endedAt);
	let endedReason = $state(resource.endedReason);
	let secondsSinceUpdate = $state(0);

	let map: maplibregl.Map | null = null;
	let posMarker: maplibregl.Marker | null = null;
	let destMarker: maplibregl.Marker | null = null;
	let pollInterval: ReturnType<typeof setInterval> | null = null;
	let tickInterval: ReturnType<typeof setInterval> | null = null;

	const isActive = $derived(!endedAt);
	const hasPosition = $derived(lat !== null && lng !== null);
	const hasDest = $derived(resource.destLat !== null && resource.destLon !== null);
	const speedKmh = $derived(speedMps !== null ? Math.round(speedMps * 3.6) : null);
	const isStale = $derived(secondsSinceUpdate > 120);

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
			const res = await fetch(`/api/share-link/${token}/position`);
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
		const routeCoords = resource.routeCoordinates;
		if (!routeCoords || routeCoords.length < 2 || !map.getSource('route-progress')) return;

		let nearestIdx = 0;
		let nearestDist = Infinity;
		for (let i = 0; i < routeCoords.length; i++) {
			const dlat = routeCoords[i][0] - lat;
			const dlng = routeCoords[i][1] - lng;
			const dist = dlat * dlat + dlng * dlng;
			if (dist < nearestDist) { nearestDist = dist; nearestIdx = i; }
		}

		const completed = routeCoords.slice(0, nearestIdx + 1).map((c) => [c[1], c[0]]);
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
			: resource.destLon !== null && resource.destLat !== null ? [resource.destLon, resource.destLat]
			: [10.75, 59.91];

		map = new maplibregl.Map({
			container: mapEl,
			style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
			center, zoom: 13,
			attributionControl: false
		});
		map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

		map.on('load', () => {
			if (!map) return;

			const routeCoords = resource.routeCoordinates;
			if (routeCoords && routeCoords.length >= 2) {
				map.addSource('route', {
					type: 'geojson',
					data: {
						type: 'Feature', properties: {},
						geometry: { type: 'LineString', coordinates: routeCoords.map((c) => [c[1], c[0]]) }
					}
				});
				map.addLayer({
					id: 'route', type: 'line', source: 'route',
					paint: { 'line-color': '#94a3b8', 'line-width': 4, 'line-opacity': 0.5 }
				});

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

			if (hasDest && resource.destLon !== null && resource.destLat !== null) {
				destMarker = new maplibregl.Marker({ element: createDestPin() })
					.setLngLat([resource.destLon, resource.destLat]).addTo(map);
				if (resource.destLabel) {
					destMarker.setPopup(new maplibregl.Popup({ offset: 12, closeButton: false }).setText(resource.destLabel));
					destMarker.togglePopup();
				}
			}

			if (hasPosition && lng !== null && lat !== null) {
				posMarker = new maplibregl.Marker({ element: createPositionDot() })
					.setLngLat([lng, lat]).addTo(map);
			}

			if (hasPosition && hasDest && lng !== null && lat !== null && resource.destLon !== null && resource.destLat !== null) {
				const bounds = new maplibregl.LngLatBounds([lng, lat], [resource.destLon, resource.destLat]);
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

<section class="trip-position">
	{#if !isActive}
		<div class="ended-banner">
			{endedReason === 'arrived' ? 'Framme!' : 'Turen er avsluttet'}
		</div>
	{/if}

	<div id="live-map" class="map"></div>

	<div class="info-card">
		<header>
			{#if resource.ownerName}<div class="owner">{resource.ownerName}</div>{/if}
			{#if resource.routeLabel}
				<h1>{resource.routeLabel}</h1>
			{/if}
			{#if resource.destLabel}
				<p class="dest">→ {resource.destLabel}</p>
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
		{/if}
	</div>
</section>

<style>
	.trip-position {
		display: flex;
		flex-direction: column;
		height: calc(100dvh - 3rem);
		position: relative;
	}
	.map {
		flex: 1;
		min-height: 200px;
		border-radius: 12px;
		z-index: 0;
	}
	.info-card {
		padding: 1rem;
	}
	.owner {
		font-size: 0.8rem;
		color: var(--text-tertiary);
		margin-bottom: 0.15rem;
	}
	.info-card h1 {
		font-size: 1.3rem;
		margin: 0 0 0.1rem;
	}
	.dest {
		color: var(--text-secondary);
		margin: 0 0 0.75rem;
		font-size: 0.95rem;
	}
	.empty {
		color: var(--text-tertiary);
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
		background: var(--bg-elevated);
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
		color: var(--text-tertiary);
	}
	.stat .value {
		font-size: 1.1rem;
		font-weight: 600;
	}
	.updated {
		font-size: 0.8rem;
		color: var(--text-tertiary);
		text-align: center;
	}
	.updated.stale { color: var(--warning-text); }
	.stale-tag { margin-left: 0.2rem; }
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
