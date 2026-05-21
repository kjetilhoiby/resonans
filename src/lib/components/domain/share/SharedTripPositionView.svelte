<script lang="ts">
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

	let { resource }: { resource: Resource } = $props();

	function formatRelative(timestamp: Date | string | null): string {
		if (!timestamp) return 'aldri';
		const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
		const diffSec = Math.round((Date.now() - date.getTime()) / 1000);
		if (diffSec < 60) return `${diffSec} sek siden`;
		if (diffSec < 3600) return `${Math.round(diffSec / 60)} min siden`;
		const hours = Math.round(diffSec / 3600);
		if (hours < 24) return `${hours} t siden`;
		return date.toLocaleString('nb-NO');
	}

	function formatEta(minutes: number | null): string {
		if (minutes === null) return '—';
		if (minutes < 1) return 'snart fremme';
		if (minutes < 60) return `${minutes} min`;
		const h = Math.floor(minutes / 60);
		const m = minutes % 60;
		return m === 0 ? `${h} t` : `${h} t ${m} min`;
	}

	function mapUrl(lat: number, lng: number): string {
		return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}&zoom=12`;
	}

	const hasPosition = $derived(resource.currentLat !== null && resource.currentLng !== null);
</script>

<section class="trip-position">
	<header>
		<h1>
			{#if resource.themeEmoji}<span class="emoji">{resource.themeEmoji}</span>{/if}
			{resource.themeName}
		</h1>
		{#if resource.destination}
			<p class="dest">På vei til <strong>{resource.destination}</strong></p>
		{/if}
	</header>

	{#if !hasPosition}
		<div class="empty">
			<p>Ingen posisjonsdata enda. Vent litt — appen sender posisjon snart.</p>
		</div>
	{:else}
		<div class="stats">
			<div class="stat">
				<span class="label">Estimert ankomst</span>
				<span class="value">{formatEta(resource.etaMinutes)}</span>
			</div>
			<div class="stat">
				<span class="label">Avstand</span>
				<span class="value">
					{resource.distanceKm !== null ? `${resource.distanceKm.toFixed(1)} km` : '—'}
				</span>
			</div>
			<div class="stat">
				<span class="label">Fart</span>
				<span class="value">
					{resource.currentSpeedKmh !== null ? `${Math.round(resource.currentSpeedKmh)} km/t` : '—'}
				</span>
			</div>
		</div>

		<p class="updated" class:stale={resource.isStale}>
			Sist oppdatert {formatRelative(resource.currentTimestamp)}
			{#if resource.isStale}<span class="stale-tag">(forsinket signal)</span>{/if}
		</p>

		<div class="map-links">
			{#if resource.currentLat !== null && resource.currentLng !== null}
				<a href={mapUrl(resource.currentLat, resource.currentLng)} target="_blank" rel="noopener">
					Vis nåværende posisjon på kart
				</a>
			{/if}
			{#if resource.destLat !== null && resource.destLng !== null}
				<a href={mapUrl(resource.destLat, resource.destLng)} target="_blank" rel="noopener">
					Vis destinasjon på kart
				</a>
			{/if}
		</div>
	{/if}
</section>

<style>
	.trip-position h1 {
		font-size: 1.6rem;
		margin: 0 0 0.25rem;
	}
	.emoji {
		margin-right: 0.4rem;
	}
	.dest {
		color: #555;
		margin: 0 0 1.25rem;
	}
	.empty {
		background: #f7f7f8;
		border-radius: 8px;
		padding: 1.5rem;
		text-align: center;
		color: #777;
	}
	.stats {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.75rem;
		margin-bottom: 1rem;
	}
	.stat {
		background: #f4f5f9;
		border-radius: 8px;
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.stat .label {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #777;
	}
	.stat .value {
		font-size: 1.2rem;
		font-weight: 600;
	}
	.updated {
		font-size: 0.85rem;
		color: #666;
		margin: 0 0 1rem;
	}
	.updated.stale {
		color: #b16a00;
	}
	.stale-tag {
		margin-left: 0.3rem;
	}
	.map-links {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.map-links a {
		color: #7c8ef5;
		text-decoration: none;
	}
	.map-links a:hover {
		text-decoration: underline;
	}
</style>
