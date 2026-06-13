<script lang="ts">
	import type { PageData } from './$types';
	import SharedChecklistView from '$lib/components/domain/share/SharedChecklistView.svelte';
	import SharedThemeListView from '$lib/components/domain/share/SharedThemeListView.svelte';
	import SharedTripPositionView from '$lib/components/domain/share/SharedTripPositionView.svelte';

	let { data }: { data: PageData } = $props();

	// Rikt forhåndsvisningskort for delt live posisjon (kart-OG via satori).
	const trip = $derived(
		data.status === 'ok' && data.resource.kind === 'tripPosition' ? data.resource : null
	);
	const tripTitle = $derived(
		trip ? (data.status === 'ok' && data.ownerName ? `${data.ownerName} er underveis` : 'Live posisjon') : null
	);
	const tripToken = $derived(data.status === 'ok' ? data.token : '');
</script>

<svelte:head>
	{#if trip}
		<title>{tripTitle}</title>
		<meta name="robots" content="noindex" />
		<meta property="og:title" content={tripTitle} />
		<meta
			property="og:description"
			content={trip.destLabel ? `På vei til ${trip.destLabel}` : 'Se live posisjon'}
		/>
		<meta property="og:image" content={`/api/share-link/${tripToken}/og.png`} />
		<meta property="og:image:width" content="1200" />
		<meta property="og:image:height" content="630" />
	{:else}
		<title>Delt fra Resonans</title>
		<meta name="robots" content="noindex" />
	{/if}
</svelte:head>

<main class="share-page">
	{#if data.status === 'email_locked'}
		<section class="locked">
			<h1>Denne lenken er privat</h1>
			<p>
				Denne delingen er bare tilgjengelig for <strong>{data.maskedEmail}</strong>.
				Du er logget inn som <strong>{data.viewerEmail}</strong>.
			</p>
			<p>
				<a href="/auth/signout">Logg ut og logg inn med riktig konto</a>
			</p>
		</section>
	{:else if data.status === 'ok'}
		<header class="share-header">
			{#if data.ownerName}
				<div class="owner-line">Delt av {data.ownerName}</div>
			{/if}
		</header>

		{#if data.resource.kind === 'checklist'}
			<SharedChecklistView
				token={data.token}
				resource={data.resource}
				accessMode={data.accessMode}
			/>
		{:else if data.resource.kind === 'themeList'}
			<SharedThemeListView
				token={data.token}
				resource={data.resource}
				accessMode={data.accessMode}
			/>
		{:else if data.resource.kind === 'tripPosition'}
			<SharedTripPositionView resource={data.resource} token={data.token} />
		{/if}

		{#if data.viewerIsOwner}
			<footer class="owner-footer">
				Du er eier av denne ressursen. Forvalt delinger i
				<a href="/settings/sharing">Innstillinger → Deling</a>.
			</footer>
		{:else if data.viewerEmail}
			<footer class="viewer-footer">
				Du er logget inn som {data.viewerEmail}.
			</footer>
		{/if}
	{/if}
</main>

<style>
	.share-page {
		max-width: 640px;
		margin: 0 auto;
		padding: 1.5rem 1rem 3rem;
		color: var(--text-primary);
	}
	.share-header {
		margin-bottom: 1rem;
	}
	.owner-line {
		font-size: 0.85rem;
		color: var(--text-secondary);
	}
	.locked {
		text-align: center;
		padding: 3rem 1rem;
	}
	.locked h1 {
		font-size: 1.4rem;
		margin-bottom: 1rem;
	}
	.owner-footer,
	.viewer-footer {
		margin-top: 2rem;
		font-size: 0.85rem;
		color: var(--text-secondary);
		text-align: center;
	}
	.owner-footer a {
		color: var(--accent-light);
	}
</style>
