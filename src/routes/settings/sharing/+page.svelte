<script lang="ts">
	import type { PageData } from './$types';
	import { enhance } from '$app/forms';
	import { AppPage, PageHeader } from '$lib/components/ui';

	let { data }: { data: PageData } = $props();

	function origin(): string {
		if (typeof window === 'undefined') return '';
		return window.location.origin;
	}

	function resourceLabel(resourceType: string): string {
		if (resourceType === 'checklist') return 'Sjekkliste';
		if (resourceType === 'themeList') return 'Tema-liste';
		if (resourceType === 'tripPosition') return 'Live posisjon';
		return resourceType;
	}

	function formatDate(d: Date | string | null): string {
		if (!d) return '—';
		const date = typeof d === 'string' ? new Date(d) : d;
		return date.toLocaleString('nb-NO');
	}
</script>

<svelte:head>
	<title>Deling – Innstillinger | Resonans</title>
</svelte:head>

<AppPage>
<PageHeader title="Deling" backHref="/settings" />
<main>
	<p class="lead">
		Her ser du alle delingslenker du har laget. Hver lenke gir tilgang til én ressurs — enten åpent
		for hvem som helst med lenken, eller låst til en bestemt e-postadresse.
	</p>

	{#if !data.tableReady}
		<div class="warn">
			Databasetabellen <code>share_tokens</code> finnes ikke enda. Kjør
			<code>npm run db:push</code> eller <code>npm run db:migrate</code> først.
		</div>
	{:else if data.shares.length === 0}
		<p class="empty">Du har ingen aktive delinger ennå.</p>
	{:else}
		<table>
			<thead>
				<tr>
					<th>Ressurs</th>
					<th>Type</th>
					<th>Mottaker</th>
					<th>Tilgang</th>
					<th>Besøk</th>
					<th>Sist åpnet</th>
					<th>Opprettet</th>
					<th></th>
				</tr>
			</thead>
			<tbody>
				{#each data.shares as share (share.id)}
					<tr class:revoked={share.revokedAt !== null}>
						<td>
							<div class="title">{share.label ?? share.resourceTitle ?? '(ukjent)'}</div>
							<div class="url">
								<a href="/share/{share.token}" target="_blank" rel="noopener">
									{origin()}/share/{share.token}
								</a>
							</div>
						</td>
						<td>{resourceLabel(share.resourceType)}</td>
						<td>{share.allowedEmail ?? 'Åpen lenke'}</td>
						<td>{share.accessMode === 'write' ? 'Kan endre' : 'Kun lese'}</td>
						<td>{share.accessCount}</td>
						<td>{formatDate(share.lastAccessedAt)}</td>
						<td>{formatDate(share.createdAt)}</td>
						<td>
							{#if share.revokedAt === null}
								<form method="POST" action="?/revoke" use:enhance>
									<input type="hidden" name="id" value={share.id} />
									<button type="submit" class="danger">Trekk tilbake</button>
								</form>
							{:else}
								<span class="revoked-tag">Trukket tilbake</span>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</main>
</AppPage>

<style>
	main {
		max-width: 1000px;
		margin: 0 auto;
		padding: 1.5rem 1rem;
		font-family: system-ui, -apple-system, sans-serif;
	}
	.lead {
		color: #555;
		margin-bottom: 1.5rem;
	}
	.warn {
		background: #fff7e0;
		border: 1px solid #f0d486;
		padding: 0.75rem;
		border-radius: 8px;
		margin-bottom: 1rem;
	}
	.empty {
		color: #777;
		font-style: italic;
	}
	table {
		width: 100%;
		border-collapse: collapse;
	}
	th,
	td {
		text-align: left;
		padding: 0.6rem 0.5rem;
		border-bottom: 1px solid #eee;
		font-size: 0.85rem;
		vertical-align: top;
	}
	th {
		font-size: 0.75rem;
		text-transform: uppercase;
		color: #777;
		letter-spacing: 0.04em;
	}
	.title {
		font-weight: 500;
	}
	.url a {
		font-size: 0.75rem;
		color: #7c8ef5;
		text-decoration: none;
	}
	.url a:hover {
		text-decoration: underline;
	}
	.danger {
		background: white;
		color: #b00020;
		border: 1px solid #f5c2c2;
		padding: 0.3rem 0.7rem;
		border-radius: 6px;
		cursor: pointer;
		font-size: 0.8rem;
	}
	.revoked {
		opacity: 0.5;
	}
	.revoked-tag {
		color: #888;
		font-size: 0.75rem;
	}
</style>
