<script lang="ts">
	import { goto } from '$app/navigation';
	import { AppPage, PageHeader, PageSection } from '$lib/components/ui';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let items = $state(data.items);
	$effect(() => {
		items = data.items;
	});

	function formatNOK(value: number): string {
		return new Intl.NumberFormat('nb-NO', {
			style: 'currency',
			currency: 'NOK',
			maximumFractionDigits: 0
		}).format(value);
	}
	function formatTxDate(iso: string): string {
		return new Date(iso).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' });
	}

	async function toggle(item: (typeof items)[number]) {
		const next = !item.checked;
		items = items.map((i) => (i.id === item.id ? { ...i, checked: next } : i));
		await fetch(`/api/tema/${item.themeId}/tasks`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ itemId: item.id, checked: next })
		});
	}
</script>

<svelte:head>
	<title>{data.selectedStore ?? 'Handlelister'} · Resonans</title>
</svelte:head>

<AppPage>
	<PageSection>
		<PageHeader title={data.selectedStore ? `🛒 ${data.selectedStore}` : 'Handlelister'} titleHref="/" />

		{#if !data.selectedStore}
			{#if data.groups.length === 0}
				<p class="empty">Ingen innkjøp ennå. Marker oppgaver med «kjøp: vare på butikk» i et prosjekt.</p>
			{:else}
				<div class="store-grid">
					{#each data.groups as g (g.store)}
						<button
							class="store-card"
							data-track="handleliste:apne-butikk"
							onclick={() => goto(`/handleliste?store=${encodeURIComponent(g.store)}`)}
						>
							<span class="store-name">🛒 {g.store}</span>
							<span class="store-count">{g.open} igjen{#if g.total > g.open} · {g.total - g.open} kjøpt{/if}</span>
						</button>
					{/each}
				</div>
			{/if}
		{:else}
			<a class="back-link" href="/handleliste">← Alle butikker</a>
			{#if items.length === 0}
				<p class="empty">Ingenting å kjøpe på {data.selectedStore}.</p>
			{:else}
				<ul class="shop-list">
					{#each items as item (item.id)}
						<li class="shop-row">
							<input
								type="checkbox"
								checked={item.checked}
								aria-label={item.text}
								data-track="handleliste:kryss-av"
								onchange={() => toggle(item)}
							/>
							<span class="shop-text" class:done={item.checked}>{item.text}</span>
							<a class="project-chip" href={`/tema/${item.themeId}`} title={item.projectName}>
								{item.projectEmoji ?? '🔨'} {item.projectName}
							</a>
						</li>
					{/each}
				</ul>
			{/if}

			{#if data.transactions.length > 0}
				<section class="tx-section">
					<div class="tx-head">
						<h3>Kjøp på {data.selectedStore}</h3>
						<span class="tx-total">{formatNOK(data.totalSpent)} · {data.txCount} kjøp siste 180 dager</span>
					</div>
					{#if data.txCount > data.transactions.length}
						<p class="tx-note">Viser de {data.transactions.length} siste</p>
					{/if}
					<ul class="tx-list">
						{#each data.transactions as tx (tx.date + tx.description + tx.amount)}
							<li class="tx-row">
								<span class="tx-date">{formatTxDate(tx.date)}</span>
								<span class="tx-desc">{tx.description ?? data.selectedStore}</span>
								<span class="tx-amount" class:expense={tx.amount < 0}>{formatNOK(tx.amount)}</span>
							</li>
						{/each}
					</ul>
				</section>
			{/if}
		{/if}
	</PageSection>
</AppPage>

<style>
	.empty {
		color: var(--text-secondary);
		font-size: 0.9rem;
		text-align: center;
		padding: 2rem 0;
	}
	.store-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
		gap: 0.75rem;
	}
	.store-card {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		align-items: flex-start;
		background: var(--bg-card);
		border: 1px solid var(--border-color);
		border-radius: 12px;
		padding: 0.85rem;
		font: inherit;
		color: inherit;
		text-align: left;
		cursor: pointer;
		transition: border-color 0.2s;
	}
	.store-card:hover {
		border-color: var(--accent-primary);
	}
	.store-name {
		font-weight: 600;
		font-size: 0.95rem;
	}
	.store-count {
		font-size: 0.8rem;
		color: var(--text-secondary);
	}
	.back-link {
		display: inline-block;
		margin-bottom: 1rem;
		color: var(--text-secondary);
		font-size: 0.85rem;
		text-decoration: none;
	}
	.back-link:hover {
		color: var(--text-primary);
	}
	.shop-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.shop-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.6rem 0.7rem;
		background: var(--bg-card);
		border: 1px solid var(--border-color);
		border-radius: 10px;
	}
	.shop-row input[type='checkbox'] {
		width: 1.05rem;
		height: 1.05rem;
		accent-color: var(--accent-primary);
		cursor: pointer;
		flex-shrink: 0;
	}
	.shop-text {
		flex: 1;
		font-size: 0.92rem;
		min-width: 0;
	}
	.shop-text.done {
		text-decoration: line-through;
		color: var(--text-tertiary);
	}
	.project-chip {
		flex-shrink: 0;
		font-size: 0.72rem;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		background: var(--bg-hover);
		color: var(--text-secondary);
		text-decoration: none;
		max-width: 45%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.project-chip:hover {
		color: var(--text-primary);
	}
	.tx-section {
		margin-top: 2rem;
	}
	.tx-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.5rem;
		margin-bottom: 0.6rem;
	}
	.tx-head h3 {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 600;
	}
	.tx-total {
		font-size: 0.8rem;
		color: var(--text-secondary);
		text-align: right;
	}
	.tx-note {
		margin: 0 0 0.4rem;
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}
	.tx-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.tx-row {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		padding: 0.55rem 0.1rem;
		border-bottom: 1px solid var(--border-subtle);
		font-size: 0.85rem;
	}
	.tx-date {
		flex-shrink: 0;
		color: var(--text-tertiary);
		font-size: 0.78rem;
		width: 3.2rem;
	}
	.tx-desc {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text-secondary);
	}
	.tx-amount {
		flex-shrink: 0;
		font-variant-numeric: tabular-nums;
		color: var(--text-secondary);
	}
	.tx-amount.expense {
		color: var(--text-primary);
	}
</style>
