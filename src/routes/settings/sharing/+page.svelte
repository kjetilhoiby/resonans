<script lang="ts">
	import type { PageData } from './$types';
	import { enhance } from '$app/forms';
	import { AppPage, Button, PageHeader, PageSection } from '$lib/components/ui';

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
<PageSection>
<PageHeader title="Deling" titleHref="/settings" />
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
									<Button type="submit" variant="danger">Trekk tilbake</Button>
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
</PageSection>
</AppPage>

<style>
	main {
		max-width: 1000px;
		margin: 0 auto;
		padding: 0 0 1rem;
	}
	.lead {
		color: var(--text-secondary);
		margin-bottom: 1.5rem;
	}
	.warn {
		background: var(--warning-bg);
		border: 1px solid var(--warning-border);
		color: var(--text-primary);
		padding: 0.75rem;
		border-radius: 8px;
		margin-bottom: 1rem;
	}
	.empty {
		color: var(--text-tertiary);
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
		border-bottom: 1px solid var(--border-subtle);
		font-size: 0.85rem;
		vertical-align: top;
	}
	th {
		font-size: 0.75rem;
		text-transform: uppercase;
		color: var(--text-tertiary);
		letter-spacing: 0.04em;
	}
	.title {
		font-weight: 500;
		color: var(--text-primary);
	}
	.url a {
		font-size: 0.75rem;
		color: var(--accent-light);
		text-decoration: none;
	}
	.url a:hover {
		text-decoration: underline;
	}
	.revoked {
		opacity: 0.5;
	}
	.revoked-tag {
		color: var(--text-tertiary);
		font-size: 0.75rem;
	}
</style>
