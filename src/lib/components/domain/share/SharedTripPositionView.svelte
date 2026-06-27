<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { RESONANS_DARK_MAP_STYLE, mapTransformRequest } from '$lib/components/charts/mapStyle';

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

	// Maks-lengder speiler serveren (src/lib/server/services/live-messages.ts).
	const MAX_SENDER_LEN = 40;
	const MAX_TEXT_LEN = 280;
	const SENDER_STORAGE_KEY = 'resonans-live-sender';

	let senderName = $state('');
	let messageText = $state('');
	let sending = $state(false);
	let sendStatus = $state<'idle' | 'sent' | 'error' | 'rate_limited'>('idle');

	type IncomingMessage = { id: string; sender: string | null; text: string; createdAt: string | null };
	let incomingMessages = $state<IncomingMessage[]>([]);
	let lastIncomingId: string | null = null;

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
	let incomingInterval: ReturnType<typeof setInterval> | null = null;

	const isActive = $derived(!endedAt);
	const hasPosition = $derived(lat !== null && lng !== null);
	const hasDest = $derived(resource.destLat !== null && resource.destLon !== null);
	const speedKmh = $derived(speedMps !== null ? Math.round(speedMps * 3.6) : null);
	const isStale = $derived(secondsSinceUpdate > 120);
	const hasArrived = $derived(!isActive && endedReason === 'arrived');
	// Ankomsttidspunkt (klokkeslett) når turen er fullført. endedAt settes når
	// appen registrerer ankomst (DELETE med reason 'arrived').
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

	// Henter løper→seer-meldinger (svar fra den som løper). `after`-markøren gjør
	// at vi bare får nye. Kjøres i samme puls som posisjons-pollingen.
	async function pollIncoming() {
		try {
			const params = new URLSearchParams({ token });
			if (lastIncomingId) params.set('after', lastIncomingId);
			const res = await fetch(`/api/apps/live-session/messages?${params}`);
			if (!res.ok) return;
			const d = await res.json();
			const fresh: IncomingMessage[] = Array.isArray(d.messages) ? d.messages : [];
			if (fresh.length > 0) {
				incomingMessages = [...incomingMessages, ...fresh];
				lastIncomingId = fresh[fresh.length - 1].id;
			}
		} catch { /* neste puls prøver igjen */ }
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
			if (endedAt) {
				if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
				// Én siste henting av eventuelle svar, så stopper vi meldings-pulsen.
				if (incomingInterval) {
					void pollIncoming();
					clearInterval(incomingInterval);
					incomingInterval = null;
				}
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

	async function sendMessage(event: SubmitEvent) {
		event.preventDefault();
		const text = messageText.trim();
		if (!text || sending) return;

		sending = true;
		sendStatus = 'idle';
		try {
			const res = await fetch(`/api/apps/live-session/messages?token=${encodeURIComponent(token)}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ sender: senderName.trim() || undefined, text })
			});
			if (res.status === 429) {
				sendStatus = 'rate_limited';
				return;
			}
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			messageText = '';
			sendStatus = 'sent';
			if (senderName.trim()) {
				try {
					localStorage.setItem(SENDER_STORAGE_KEY, senderName.trim());
				} catch { /* private mode e.l. */ }
			}
		} catch (err) {
			sendStatus = 'error';
			console.error(err);
		} finally {
			sending = false;
		}
	}

	onMount(async () => {
		secondsSinceUpdate = calcSecondsSince(lastPingAt);

		try {
			senderName = localStorage.getItem(SENDER_STORAGE_KEY) ?? '';
		} catch { /* private mode e.l. */ }

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
			style: RESONANS_DARK_MAP_STYLE,
			transformRequest: mapTransformRequest,
			center, zoom: 13,
			attributionControl: false
		});

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

		void pollIncoming();
		if (isActive) {
			pollInterval = setInterval(poll, 10_000);
			incomingInterval = setInterval(pollIncoming, 2_000);
		}
		tickInterval = setInterval(() => {
			secondsSinceUpdate = calcSecondsSince(lastPingAt);
		}, 1000);
	});

	onDestroy(() => {
		if (pollInterval) clearInterval(pollInterval);
		if (tickInterval) clearInterval(tickInterval);
		if (incomingInterval) clearInterval(incomingInterval);
		map?.remove();
	});
</script>

<section class="trip-position">
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
		{:else if hasArrived}
			<div class="arrived-summary">
				<span class="arrived-label">Framme</span>
				<span class="arrived-time">{arrivalClock ?? '—'}</span>
			</div>
		{/if}

		{#if incomingMessages.length > 0}
			<div class="incoming">
				{#each incomingMessages as msg (msg.id)}
					<div class="incoming-msg">
						<span class="incoming-from">{msg.sender || resource.ownerName || 'Løperen'}</span>
						<span class="incoming-text">{msg.text}</span>
					</div>
				{/each}
			</div>
		{/if}

		{#if isActive}
			<form class="composer" onsubmit={sendMessage}>
				<p class="composer-hint">
					Send en heiarop — {resource.ownerName ?? 'løperen'} får den lest opp.
				</p>
				<input
					class="sender-input"
					type="text"
					placeholder="Navnet ditt (valgfritt)"
					bind:value={senderName}
					maxlength={MAX_SENDER_LEN}
					aria-label="Navnet ditt"
					data-track="delt-posisjon:avsendernavn"
				/>
				<div class="message-row">
					<input
						class="message-input"
						type="text"
						placeholder="Skriv en melding …"
						bind:value={messageText}
						maxlength={MAX_TEXT_LEN}
						aria-label="Melding"
						data-track="delt-posisjon:melding"
					/>
					<button
						type="submit"
						class="send-btn"
						disabled={sending || !messageText.trim()}
						data-track="delt-posisjon:send-melding"
					>
						{sending ? 'Sender …' : 'Send'}
					</button>
				</div>
				{#if sendStatus === 'sent'}
					<p class="composer-status ok">Sendt! Den blir lest opp.</p>
				{:else if sendStatus === 'rate_limited'}
					<p class="composer-status err">Litt for ivrig — vent et øyeblikk før neste melding.</p>
				{:else if sendStatus === 'error'}
					<p class="composer-status err">Kunne ikke sende. Prøv igjen.</p>
				{/if}
			</form>
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
	.incoming {
		margin-top: 0.85rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.incoming-msg {
		background: #eef2ff;
		border-radius: 10px 10px 10px 2px;
		padding: 0.5rem 0.7rem;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		align-self: flex-start;
		max-width: 85%;
	}
	.incoming-from {
		font-size: 0.7rem;
		font-weight: 600;
		color: #4f5bd5;
	}
	.incoming-text {
		font-size: 0.95rem;
		color: #1a1a1a;
		word-break: break-word;
	}
	.composer {
		margin-top: 0.85rem;
		padding-top: 0.85rem;
		border-top: 1px solid #ececf1;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.composer-hint {
		margin: 0;
		font-size: 0.8rem;
		color: #777;
	}
	.sender-input,
	.message-input {
		width: 100%;
		box-sizing: border-box;
		padding: 0.6rem 0.7rem;
		border: 1px solid #d9dae2;
		border-radius: 8px;
		font-size: 0.95rem;
		background: #fff;
		color: #1a1a1a;
	}
	.sender-input:focus,
	.message-input:focus {
		outline: none;
		border-color: #4285f4;
	}
	.message-row {
		display: flex;
		gap: 0.5rem;
	}
	.message-row .message-input {
		flex: 1;
	}
	.send-btn {
		flex-shrink: 0;
		padding: 0.6rem 1rem;
		border: none;
		border-radius: 8px;
		background: #4285f4;
		color: #fff;
		font-weight: 600;
		font-size: 0.95rem;
		cursor: pointer;
	}
	.send-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.composer-status {
		margin: 0;
		font-size: 0.82rem;
	}
	.composer-status.ok { color: #1a9c4f; }
	.composer-status.err { color: #c2410c; }
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
