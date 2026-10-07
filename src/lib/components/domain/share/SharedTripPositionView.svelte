<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import {
		KARTVERKET_GRAY_STYLE,
		OPENFREEMAP_LIGHT_STYLE,
		mapTransformRequest
	} from '$lib/components/charts/mapStyle';
	import {
		STALE_AFTER_SECONDS,
		describeLiveShare,
		formatDistanceLeft,
		formatMinutesLeft,
		formatUpdatedAgo
	} from '$lib/domain/live-share';
	import { allInMainlandNorway } from '$lib/domain/norway-coverage';

	/**
	 * «Jeg er på vei» — den delte live-posisjonen fra Ekko. Lys, rolig og med
	 * ankomsttida som det største på siden: det er det mottakeren åpner lenka for.
	 * Ordene kommer fra `$lib/domain/live-share.ts`, så siden, forhåndsvisningen og
	 * OG-bildet sier det samme.
	 */

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

	let {
		resource,
		token,
		viewerIsOwner = false
	}: { resource: Resource; token: string; viewerIsOwner?: boolean } = $props();

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
	let lastPingAt = $state(resource.lastPingAt);
	let endedAt = $state(resource.endedAt);
	let endedReason = $state(resource.endedReason);
	let nowMs = $state(Date.now());

	let mapEl: HTMLDivElement | undefined = $state();
	let map: maplibregl.Map | null = null;
	let posMarker: maplibregl.Marker | null = null;
	let pollInterval: ReturnType<typeof setInterval> | null = null;
	let tickInterval: ReturnType<typeof setInterval> | null = null;
	let incomingInterval: ReturnType<typeof setInterval> | null = null;

	const summary = $derived(
		describeLiveShare(
			{
				destLabel: resource.destLabel,
				etaSeconds,
				lastPingAt,
				lastLat: lat,
				lastLon: lng,
				endedAt,
				endedReason
			},
			new Date(nowMs)
		)
	);
	const isActive = $derived(summary.state === 'active' || summary.state === 'waiting');
	const dest = $derived(resource.destLabel?.trim() || null);
	const speedKmh = $derived(speedMps !== null ? Math.round(speedMps * 3.6) : null);
	const distanceLeft = $derived(formatDistanceLeft(distanceRemainingM));
	const minutesLeftText = $derived(formatMinutesLeft(summary.minutesLeft));
	const secondsSinceUpdate = $derived(
		lastPingAt ? Math.max(0, Math.round((nowMs - new Date(lastPingAt).getTime()) / 1000)) : null
	);
	const isStale = $derived(secondsSinceUpdate !== null && secondsSinceUpdate > STALE_AFTER_SECONDS);

	const ACCENT = '#2f5f8f';
	const INK = '#1d2733';

	function createPositionDot(): HTMLDivElement {
		const el = document.createElement('div');
		el.className = 'trip-pos-dot';
		el.style.cssText = `width:18px;height:18px;border-radius:50%;background:${ACCENT};border:3px solid #fff;box-shadow:0 0 0 7px rgba(47,95,143,.18),0 1px 4px rgba(29,39,51,.35);`;
		return el;
	}

	function createDestPin(): HTMLDivElement {
		const el = document.createElement('div');
		el.style.cssText = `width:16px;height:16px;border-radius:50%;background:#fff;border:4px solid ${INK};box-shadow:0 1px 4px rgba(29,39,51,.3);`;
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
			lastPingAt = d.lastPingAt;
			endedAt = d.endedAt;
			endedReason = d.endedReason;
			if (lat !== null && lng !== null && map) {
				if (posMarker) posMarker.setLngLat([lng, lat]);
				else void addPositionMarker();
				updateRouteProgress();
				map.easeTo({ center: [lng, lat], duration: 1000 });
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

	async function addPositionMarker() {
		if (!map || lat === null || lng === null || posMarker) return;
		const maplibregl = await import('maplibre-gl');
		posMarker = new maplibregl.Marker({ element: createPositionDot() }).setLngLat([lng, lat]).addTo(map);
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
		try {
			senderName = localStorage.getItem(SENDER_STORAGE_KEY) ?? '';
		} catch { /* private mode e.l. */ }

		void pollIncoming();
		if (isActive) {
			pollInterval = setInterval(poll, 10_000);
			incomingInterval = setInterval(pollIncoming, 2_000);
		}
		tickInterval = setInterval(() => {
			nowMs = Date.now();
		}, 1000);

		const maplibregl = await import('maplibre-gl');
		await import('maplibre-gl/dist/maplibre-gl.css');
		if (!mapEl) return;

		const routeCoords = resource.routeCoordinates;
		const points: [number, number][] = [...(routeCoords ?? [])];
		if (lat !== null && lng !== null) points.push([lat, lng]);
		if (resource.destLat !== null && resource.destLon !== null) {
			points.push([resource.destLat, resource.destLon]);
		}

		const center: [number, number] =
			lat !== null && lng !== null ? [lng, lat]
			: resource.destLon !== null && resource.destLat !== null ? [resource.destLon, resource.destLat]
			: [10.75, 59.91];

		map = new maplibregl.Map({
			container: mapEl,
			style: allInMainlandNorway(points) ? KARTVERKET_GRAY_STYLE : OPENFREEMAP_LIGHT_STYLE,
			transformRequest: mapTransformRequest,
			center,
			zoom: 13,
			attributionControl: { compact: true }
		});

		map.on('load', () => {
			if (!map) return;

			if (routeCoords && routeCoords.length >= 2) {
				map.addSource('route', {
					type: 'geojson',
					data: {
						type: 'Feature', properties: {},
						geometry: { type: 'LineString', coordinates: routeCoords.map((c) => [c[1], c[0]]) }
					}
				});
				map.addLayer({
					id: 'route-casing', type: 'line', source: 'route',
					layout: { 'line-cap': 'round', 'line-join': 'round' },
					paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.9 }
				});
				map.addLayer({
					id: 'route', type: 'line', source: 'route',
					layout: { 'line-cap': 'round', 'line-join': 'round' },
					paint: { 'line-color': ACCENT, 'line-width': 5, 'line-opacity': 0.35 }
				});

				map.addSource('route-progress', {
					type: 'geojson',
					data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } }
				});
				map.addLayer({
					id: 'route-progress', type: 'line', source: 'route-progress',
					layout: { 'line-cap': 'round', 'line-join': 'round' },
					paint: { 'line-color': ACCENT, 'line-width': 5 }
				});
				updateRouteProgress();
			}

			if (resource.destLon !== null && resource.destLat !== null) {
				new maplibregl.Marker({ element: createDestPin() })
					.setLngLat([resource.destLon, resource.destLat])
					.addTo(map);
			}

			void addPositionMarker();

			if (points.length >= 2) {
				const bounds = new maplibregl.LngLatBounds([points[0][1], points[0][0]], [points[0][1], points[0][0]]);
				for (const [pLat, pLon] of points) bounds.extend([pLon, pLat]);
				map.fitBounds(bounds, { padding: { top: 48, bottom: 64, left: 40, right: 40 }, maxZoom: 15, duration: 0 });
			}
		});
	});

	onDestroy(() => {
		if (pollInterval) clearInterval(pollInterval);
		if (tickInterval) clearInterval(tickInterval);
		if (incomingInterval) clearInterval(incomingInterval);
		map?.remove();
	});
</script>

<main class="trip">
	<div class="map-wrap">
		<div bind:this={mapEl} class="map" aria-label="Kart over turen"></div>
	</div>

	<article class="card">
		{#if resource.ownerName}<p class="who">{resource.ownerName}</p>{/if}
		<h1>{summary.title}</h1>
		{#if dest}<p class="dest">{isActive ? `til ${dest}` : dest}</p>{/if}

		{#if summary.state === 'waiting'}
			<p class="note">Venter på første posisjon fra appen …</p>
		{:else if summary.state === 'active'}
			{#if summary.arrivalClock}
				<div class="eta">
					<span class="eta-label">Framme ca. kl.</span>
					<span class="eta-clock">{summary.arrivalClock}</span>
					{#if minutesLeftText}<span class="eta-rel">{minutesLeftText}</span>{/if}
				</div>
			{:else}
				<p class="note">Ankomsttida kommer når appen har regnet den ut.</p>
			{/if}

			{#if distanceLeft || speedKmh !== null}
				<dl class="facts">
					{#if distanceLeft}
						<div><dt>Igjen</dt><dd>{distanceLeft}</dd></div>
					{/if}
					{#if speedKmh !== null}
						<div><dt>Fart</dt><dd>{speedKmh} km/t</dd></div>
					{/if}
				</dl>
			{/if}

			{#if secondsSinceUpdate !== null}
				<p class="updated" class:stale={isStale}>
					{#if isStale}
						Ingen ny posisjon på {Math.round(secondsSinceUpdate / 60)} min — signalet kan være borte.
					{:else}
						Oppdatert {formatUpdatedAgo(secondsSinceUpdate)}
					{/if}
				</p>
			{/if}
		{:else if summary.state === 'arrived'}
			<div class="eta arrived">
				<span class="eta-label">Framme kl.</span>
				<span class="eta-clock">{summary.arrivalClock ?? '—'}</span>
			</div>
		{:else}
			<p class="note">{summary.description}</p>
		{/if}

		{#if incomingMessages.length > 0}
			<div class="incoming">
				{#each incomingMessages as msg (msg.id)}
					<div class="incoming-msg">
						<span class="incoming-from">{msg.sender || resource.ownerName || 'Svar'}</span>
						<span class="incoming-text">{msg.text}</span>
					</div>
				{/each}
			</div>
		{/if}

		{#if isActive}
			<form class="composer" onsubmit={sendMessage}>
				<p class="composer-hint">
					Send en hilsen — {resource.ownerName ?? 'den som er på vei'} får den lest opp.
				</p>
				<input
					class="field"
					type="text"
					placeholder="Navnet ditt (valgfritt)"
					bind:value={senderName}
					maxlength={MAX_SENDER_LEN}
					aria-label="Navnet ditt"
					data-track="delt-posisjon:avsendernavn"
				/>
				<div class="message-row">
					<input
						class="field"
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

		{#if viewerIsOwner}
			<p class="owner-note">
				Du deler denne. Stopp eller begrens delingen i
				<a href="/settings/sharing">Innstillinger → Deling</a>.
			</p>
		{/if}
	</article>
</main>

<style>
	.trip {
		--ink: #1d2733;
		--muted: #5f6b76;
		--line: #e4e2dc;
		--accent: #2f5f8f;
		--paper: #f4f3ef;
		--warn: #8a5a12;

		min-height: 100dvh;
		background: var(--paper);
		color: var(--ink);
		font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
		display: flex;
		flex-direction: column;
	}
	.map-wrap {
		position: relative;
		height: 52dvh;
		min-height: 280px;
		max-height: 620px;
	}
	.map {
		position: absolute;
		inset: 0;
	}
	.card {
		position: relative;
		z-index: 1;
		box-sizing: border-box;
		width: 100%;
		max-width: 560px;
		margin: -28px auto 0;
		padding: 1.4rem 1.25rem 2rem;
		background: #fff;
		border-radius: 20px 20px 0 0;
		box-shadow: 0 -4px 18px rgba(29, 39, 51, 0.08);
		flex: 1;
	}
	@media (min-width: 600px) {
		.card {
			flex: none;
			margin-bottom: 2rem;
			border-radius: 20px;
			box-shadow: 0 6px 24px rgba(29, 39, 51, 0.1);
		}
	}
	.who {
		margin: 0;
		font-size: 0.85rem;
		color: var(--muted);
	}
	h1 {
		margin: 0.1rem 0 0;
		font-size: 1.6rem;
		font-weight: 700;
		letter-spacing: -0.01em;
	}
	.dest {
		margin: 0.15rem 0 0;
		font-size: 1rem;
		color: var(--muted);
	}
	.eta {
		margin-top: 1.1rem;
		display: grid;
		grid-template-columns: auto 1fr;
		grid-template-areas:
			'label label'
			'clock rel';
		align-items: baseline;
		column-gap: 0.75rem;
	}
	.eta-label {
		grid-area: label;
		font-size: 0.85rem;
		color: var(--muted);
	}
	.eta-clock {
		grid-area: clock;
		font-size: 3.4rem;
		line-height: 1;
		font-weight: 700;
		letter-spacing: -0.02em;
		font-variant-numeric: tabular-nums;
	}
	.eta-rel {
		grid-area: rel;
		font-size: 1rem;
		color: var(--muted);
	}
	.eta.arrived .eta-clock {
		color: var(--ink);
	}
	.note {
		margin: 1rem 0 0;
		color: var(--muted);
	}
	.facts {
		margin: 1.1rem 0 0;
		display: flex;
		gap: 1.75rem;
		padding-top: 0.9rem;
		border-top: 1px solid var(--line);
	}
	.facts div {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	.facts dt {
		font-size: 0.75rem;
		color: var(--muted);
	}
	.facts dd {
		margin: 0;
		font-size: 1.1rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.updated {
		margin: 0.8rem 0 0;
		font-size: 0.8rem;
		color: var(--muted);
	}
	.updated.stale {
		color: var(--warn);
	}
	.incoming {
		margin-top: 1.1rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.incoming-msg {
		background: #eef2f6;
		border-radius: 12px 12px 12px 3px;
		padding: 0.5rem 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		align-self: flex-start;
		max-width: 85%;
	}
	.incoming-from {
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--accent);
	}
	.incoming-text {
		font-size: 0.95rem;
		word-break: break-word;
	}
	.composer {
		margin-top: 1.25rem;
		padding-top: 1rem;
		border-top: 1px solid var(--line);
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.composer-hint {
		margin: 0;
		font-size: 0.82rem;
		color: var(--muted);
	}
	.field {
		width: 100%;
		box-sizing: border-box;
		padding: 0.65rem 0.75rem;
		border: 1px solid var(--line);
		border-radius: 10px;
		font-size: 1rem;
		background: #fafaf8;
		color: var(--ink);
	}
	.field:focus {
		outline: none;
		border-color: var(--accent);
		background: #fff;
	}
	.message-row {
		display: flex;
		gap: 0.5rem;
	}
	.send-btn {
		flex-shrink: 0;
		padding: 0.65rem 1.1rem;
		border: none;
		border-radius: 10px;
		background: var(--ink);
		color: #fff;
		font-weight: 600;
		font-size: 0.95rem;
		cursor: pointer;
	}
	.send-btn:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.composer-status {
		margin: 0;
		font-size: 0.82rem;
	}
	.composer-status.ok { color: #3d7a5a; }
	.composer-status.err { color: #a2401f; }
	.owner-note {
		margin: 1.5rem 0 0;
		font-size: 0.8rem;
		color: var(--muted);
	}
	.owner-note a {
		color: var(--accent);
	}
</style>
