<script lang="ts">
	import type { PageData } from './$types';
	import SharedChecklistView from '$lib/components/domain/share/SharedChecklistView.svelte';
	import SharedThemeListView from '$lib/components/domain/share/SharedThemeListView.svelte';
	import SharedTripPositionView from '$lib/components/domain/share/SharedTripPositionView.svelte';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Delt fra Resonans</title>
	<meta name="robots" content="noindex" />
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
		font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
		color: #1a1a1a;
	}
	.share-header {
		margin-bottom: 1rem;
	}
	.owner-line {
		font-size: 0.85rem;
		color: #666;
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
		color: #666;
		text-align: center;
	}
	.owner-footer a {
		color: #7c8ef5;
	}
</style>
