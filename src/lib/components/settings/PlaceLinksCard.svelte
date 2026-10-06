<script lang="ts">
	/**
	 * Koblingene mellom Aksers og Ekkos steder. Hver app eier sine steder; Resonans kobler
	 * dem — automatisk når de overlapper og sier det samme, ellers som et forslag her.
	 *
	 * Kortet viser forslagene først, fordi det er dem brukeren skal gjøre noe med. Koblede
	 * steder står under som en kvittering. Ingen koordinater, bare navn og avstand.
	 * Se `docs/changelog/2026-10-06-akser-integrasjon.md`, fase 5.
	 */
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui';
	import { extractApiErrorMessage } from '$lib/client/api-error';

	type Link = {
		id: string;
		status: 'auto' | 'suggested' | 'confirmed' | 'rejected';
		distanceMeters: number | null;
		akser: { name: string; named: boolean; category: string } | null;
		ekko: { name: string } | null;
	};

	let links = $state<Link[] | null>(null);
	let error = $state<string | null>(null);
	let busy = $state<string | null>(null);

	const suggested = $derived((links ?? []).filter((l) => l.status === 'suggested'));
	const linked = $derived((links ?? []).filter((l) => l.status === 'auto' || l.status === 'confirmed'));

	function akserName(link: Link): string {
		if (!link.akser) return 'et sted i Akser';
		return link.akser.named ? link.akser.name : 'et sted uten navn i Akser';
	}

	async function load() {
		error = null;
		try {
			const res = await fetch('/api/steder/koblinger');
			if (!res.ok) {
				error = extractApiErrorMessage(res.status, await res.text());
				return;
			}
			links = ((await res.json()) as { links: Link[] }).links;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Kunne ikke hente stedene';
		}
	}

	async function answer(link: Link, status: 'confirmed' | 'rejected') {
		busy = link.id;
		error = null;
		try {
			const res = await fetch(`/api/steder/koblinger/${link.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ status })
			});
			if (!res.ok) {
				error = extractApiErrorMessage(res.status, await res.text());
				return;
			}
			await load();
		} finally {
			busy = null;
		}
	}

	onMount(load);
</script>

<section class="card">
	<h2>Steder fra Akser og Ekko</h2>
	<p class="meta">
		Akser og Ekko har hver sine steder. Overlapper to av dem og sier det samme — samme navn,
		eller begge er «hjem» — kobles de automatisk. Ellers spør vi her. Ingen av appene endres;
		koblingen gjør bare at Resonans skjønner at «barnehagen» i Ekko er det samme stedet Akser
		har sett deg på.
	</p>

	{#if error}
		<p class="err" role="alert">{error}</p>
	{/if}

	{#if links === null && !error}
		<p class="meta">Henter …</p>
	{:else if links && links.length === 0}
		<p class="meta">
			Ingenting å koble ennå. Det krever at både Akser og Ekko er koblet til Resonans og har sendt
			stedene sine, og at noen av dem ligger på samme sted.
		</p>
	{/if}

	{#if suggested.length > 0}
		<h3>Er dette samme sted?</h3>
		<ul class="list">
			{#each suggested as link (link.id)}
				<li class="row">
					<div class="names">
						<strong>{link.ekko?.name ?? 'Et sted i Ekko'}</strong>
						<span class="meta">og {akserName(link)}{link.distanceMeters != null ? `, ${link.distanceMeters} m fra hverandre` : ''}</span>
					</div>
					<div class="actions">
						<Button variant="secondary" disabled={busy === link.id} onClick={() => answer(link, 'confirmed')}>
							Samme sted
						</Button>
						<Button variant="ghost" disabled={busy === link.id} onClick={() => answer(link, 'rejected')}>
							Ikke samme sted
						</Button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}

	{#if linked.length > 0}
		<h3>Koblet</h3>
		<ul class="list">
			{#each linked as link (link.id)}
				<li class="row compact">
					<span>{link.ekko?.name ?? '?'} = {akserName(link)}</span>
					<span class="meta">{link.status === 'confirmed' ? 'bekreftet' : 'automatisk'}</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.card {
		background: var(--card-bg-subtle, #141414);
		border: 1px solid var(--card-border, #242424);
		border-radius: var(--card-radius, 16px);
		padding: var(--card-padding, 16px);
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	h2 {
		font-size: 1.05rem;
		font-weight: 700;
		color: var(--text-primary, #eee);
		margin: 0;
	}
	h3 {
		margin: 0.5rem 0 0;
		font-size: 0.78rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-tertiary, #777);
	}
	.meta {
		margin: 0;
		font-size: 0.82rem;
		color: var(--text-secondary, #aaa);
		line-height: 1.5;
	}
	.err {
		margin: 0;
		font-size: 0.82rem;
		color: #f87171;
		line-height: 1.5;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		color: var(--text-primary, #eee);
		font-size: 0.88rem;
	}
	.row.compact {
		font-size: 0.82rem;
	}
	.names {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	.actions {
		display: flex;
		gap: 0.4rem;
	}
</style>
