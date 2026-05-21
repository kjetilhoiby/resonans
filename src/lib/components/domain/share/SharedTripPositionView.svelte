<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

	type Resource = {
		kind: 'tripPosition';
		themeId: string;
		themeName: string;
		themeEmoji: string | null;
		destination: string | null;
		destLat: number | null;
		destLng: number | null;
		currentLat: number | null;
		currentLng: number | null;
		currentSpeedKmh: number | null;
		currentTimestamp: Date | string | null;
		etaMinutes: number | null;
		distanceKm: number | null;
		isStale: boolean;
	};

	let { resource, token }: { resource: Resource; token: string } = $props();

	let lat = $state(resource.currentLat);
	let lng = $state(resource.currentLng);
	let speedKmh = $state(resource.currentSpeedKmh);
	let distanceKm = $state(resource.distanceKm);
	let etaMinutes = $state(resource.etaMinutes);
	let isStale = $state(resource.isStale);
	let ended = $state(false);
	let lastTimestamp = $state(resource.currentTimestamp);
	let secondsSinceUpdate = $state(0);

	let map: maplibregl.Map | null = null;
	let positionMarker: maplibregl.Marker | null = null;
	let destMarker: maplibregl.Marker | null = null;
	let pollInterval: ReturnType<typeof setInterval> | null = null;
	let tickInterval: ReturnType<typeof setInterval> | null = null;

	const hasPosition = $derived(lat !== null && lng !== null);
	const hasDest = $derived(resource.destLat !== null && resource.destLng !== null);

	function formatEta(minutes: number | null): string {
		if (minutes === null) return '—';
		if (minutes < 1) return 'snart fremme';
		if (minutes < 60) return `ca. ${minutes} min`;
		const h = Math.floor(minutes / 60);
		const m = minutes % 60;
		return m === 0 ? `ca. ${h} t` : `ca. ${h} t ${m} min`;
	}

	function formatUpdated(secs: number): string {
		if (secs < 10) return 'akkurat nå';
		if (secs < 60) return `${secs} sek siden`;
		return `${Math.round(secs / 60)} min siden`;
	}

	function calcSecondsSince(ts: Date | string | null): number {
		if (!ts) return 999;
		const d = typeof ts === 'string' ? new Date(ts) : ts;
		return Math.round((Date.now() - d.getTime()) / 1000);
	}

	async function poll() {
		try {
			const res = await fetch(`/api/share-link/${token}/position`);
			if (!res.ok) return;
			const d = await res.json();
			lat = d.currentLat;
			lng = d.currentLng;
			speedKmh = d.speedKmh;
			distanceKm = d.distanceKm;
			etaMinutes = d.etaMinutes;
			isStale = d.isStale;
			ended = d.ended ?? false;
			lastTimestamp = d.timestamp;
			secondsSinceUpdate = calcSecondsSince(d.timestamp);
			updateMap();
			if (ended && pollInterval) {
				clearInterval(pollInterval);
				pollInterval = null;
			}
		} catch {
			// neste poll prøver igjen
		}
	}

	function updateMap() {
		if (!map || lat === null || lng === null) return;
		positionMarker?.setLngLat([lng, lat]);
		if (map.getSource('route-line')) {
			(map.getSource('route-line') as maplibregl.GeoJSONSource).setData({
				type: 'Feature',
				properties: {},
				geometry: {
					type: 'LineString',
					coordinates:
						resource.destLng !== null && resource.destLat !== null
							? [[lng, lat], [resource.destLng, resource.destLat]]
							: [[lng, lat]]
				}
			});
		}
		map.easeTo({ center: [lng, lat], duration: 1000 });
	}

	function createPulsingDot(): HTMLDivElement {
		const el = document.createElement('div');
		el.style.cssText =
			'width:20px;height:20px;border-radius:50%;background:#4285f4;border:3px solid #fff;box-shadow:0 0 0 2px rgba(66,133,244,.3);';
		return el;
	}

	function createDestPin(): HTMLDivElement {
		const el = document.createElement('div');
		el.style.cssText =
			'width:14px;height:14px;border-radius:50%;background:#ef4444;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.3);';
		return el;
	}

	onMount(async () => {
		secondsSinceUpdate = calcSecondsSince(lastTimestamp);

		const maplibregl = await import('maplibre-gl');
		await import('maplibre-gl/dist/maplibre-gl.css');

		const mapEl = document.getElementById('live-map');
		if (!mapEl) return;

		const center: [number, number] =
			lat !== null && lng !== null
				? [lng, lat]
				: resource.destLng !== null && resource.destLat !== null
					? [resource.destLng, resource.destLat]
					: [10.75, 59.91];

		map = new maplibregl.Map({
			container: mapEl,
			style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
			center,
			zoom: 13,
			attributionControl: false
		});

		map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

		map.on('load', () => {
			if (!map) return;

			if (hasDest && resource.destLng !== null && resource.destLat !== null) {
				destMarker = new maplibregl.Marker({ element: createDestPin() })
					.setLngLat([resource.destLng, resource.destLat])
					.addTo(map);

				if (resource.destination) {
					destMarker.setPopup(
						new maplibregl.Popup({ offset: 12, closeButton: false }).setText(resource.destination)
					);
					destMarker.togglePopup();
				}
			}

			if (hasPosition && lng !== null && lat !== null) {
				positionMarker = new maplibregl.Marker({ element: createPulsingDot() })
					.setLngLat([lng, lat])
					.addTo(map);
			}

			if (hasPosition && hasDest && lng !== null && lat !== null && resource.destLng !== null && resource.destLat !== null) {
				map.addSource('route-line', {
					type: 'geojson',
					data: {
						type: 'Feature',
						properties: {},
						geometry: {
							type: 'LineString',
							coordinates: [[lng, lat], [resource.destLng, resource.destLat]]
						}
					}
				});

				map.addLayer({
					id: 'route-line',
					type: 'line',
					source: 'route-line',
					paint: {
						'line-color': '#4285f4',
						'line-width': 2,
						'line-dasharray': [4, 4],
						'line-opacity': 0.5
					}
				});

				const bounds = new maplibregl.LngLatBounds(
					[lng, lat],
					[resource.destLng, resource.destLat]
				);
				map.fitBounds(bounds, { padding: 60 });
			}
		});

		pollInterval = setInterval(poll, 10_000);
		tickInterval = setInterval(() => {
			secondsSinceUpdate = calcSecondsSince(lastTimestamp);
		}, 1000);
	});

	onDestroy(() => {
		if (pollInterval) clearInterval(pollInterval);
		if (tickInterval) clearInterval(tickInterval);
		map?.remove();
	});
</script>

<section class="trip-position">
	{#if ended}
		<div class="ended-banner">Framme!</div>
	{/if}

	<div id="live-map" class="map"></div>

	<div class="info-card">
		<header>
			<h1>
				{#if resource.themeEmoji}<span class="emoji">{resource.themeEmoji}</span>{/if}
				{resource.themeName}
			</h1>
			{#if resource.destination}
				<p class="dest">→ {resource.destination}</p>
			{/if}
		</header>

		{#if !hasPosition && !ended}
			<p class="empty">Venter på posisjon fra appen …</p>
		{:else if !ended}
			<div class="stats">
				<div class="stat">
					<span class="label">Ankomst</span>
					<span class="value">{formatEta(etaMinutes)}</span>
				</div>
				<div class="stat">
					<span class="label">Avstand</span>
					<span class="value">
						{distanceKm !== null ? `${distanceKm.toFixed(1)} km` : '—'}
					</span>
				</div>
				<div class="stat">
					<span class="label">Fart</span>
					<span class="value">
						{speedKmh !== null ? `${Math.round(speedKmh)} km/t` : '—'}
					</span>
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
	.info-card h1 {
		font-size: 1.3rem;
		margin: 0 0 0.15rem;
	}
	.emoji {
		margin-right: 0.3rem;
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
	.updated.stale {
		color: #b16a00;
	}
	.stale-tag {
		margin-left: 0.2rem;
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
