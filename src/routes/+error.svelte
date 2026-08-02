<!--
  Feilside for hele appen.

  Fram til nå fantes ingen +error.svelte, så en 500 ble SvelteKits engelske
  standardside — «Internal Error», ingen id, ingenting å rapportere videre. Med
  `handleError` i hooks.server.ts har feilen nå både en melding og en `errorId`
  som gjentas i serverloggen (`[500] id=…`), og de skal fram til brukeren.

  Bevisst uten AppPage/PageSection: en feilside må ikke kunne feile selv, så den
  har ingen avhengigheter utover $app/state og CSS-variablene fra layouten.
-->
<script lang="ts">
	import { page } from '$app/state';

	const titles: Record<number, string> = {
		404: 'Finner ikke siden',
		403: 'Ingen tilgang',
		500: 'Noe gikk galt'
	};

	let title = $derived(titles[page.status] ?? 'Noe gikk galt');
	let message = $derived(page.error?.message ?? '');
	let errorId = $derived(page.error?.errorId ?? '');
	// Ikke gjenta selve statusteksten som «detalj» — SvelteKit setter message til
	// «Not Found»/«Internal Error» når vi ikke har noe bedre.
	let showMessage = $derived(!!message && !/^(not found|internal error|forbidden)$/i.test(message));
</script>

<main class="error-page">
	<p class="status">{page.status}</p>
	<h1>{title}</h1>

	{#if showMessage}
		<p class="detail">{message}</p>
	{/if}

	{#if errorId}
		<p class="error-id">Feil-id: <span>{errorId}</span></p>
	{/if}

	<div class="actions">
		<button type="button" onclick={() => location.reload()} data-track="feilside:last-inn-igjen">
			Prøv igjen
		</button>
		<a href="/" data-track="feilside:til-hjem">Til hjem</a>
	</div>
</main>

<style>
	.error-page {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 8px;
		min-height: 70svh;
		justify-content: center;
		padding: 24px 20px;
		color: var(--text-primary, #eee);
	}

	.status {
		margin: 0;
		font-size: 0.7rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: #666;
	}

	h1 {
		margin: 0;
		font-size: 1.5rem;
		font-weight: 700;
		letter-spacing: -0.02em;
	}

	.detail {
		margin: 4px 0 0;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.72rem;
		line-height: 1.5;
		color: #888;
		overflow-wrap: anywhere;
		user-select: all;
	}

	.error-id {
		margin: 0;
		font-size: 0.72rem;
		color: #666;
	}

	.error-id span {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		color: #999;
		user-select: all;
	}

	.actions {
		display: flex;
		gap: 8px;
		margin-top: 16px;
	}

	.actions button,
	.actions a {
		padding: 8px 14px;
		border-radius: 10px;
		border: 1px solid #2a2a2a;
		background: #1a1a1a;
		color: #7c8ef5;
		font: inherit;
		font-size: 0.85rem;
		text-decoration: none;
		cursor: pointer;
	}
</style>
