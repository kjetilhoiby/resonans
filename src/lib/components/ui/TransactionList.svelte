<script lang="ts">
	interface Tx {
		date: string;
		description: string;
		amount: number;
		category: string;
		emoji: string;
		label: string;
	}

	interface Props {
		transactions: Tx[];
		title: string;
		onclose: () => void;
	}

	let { transactions, title, onclose }: Props = $props();

	let search = $state('');
	let selectedCategory = $state<string | null>(null);

	const categories = $derived(
		[...new Map(transactions.map((t) => [t.category, { id: t.category, label: t.label, emoji: t.emoji }])).values()]
			.sort((a, b) => a.label.localeCompare(b.label))
	);

	const filtered = $derived(
		transactions
			.filter((t) => {
				if (selectedCategory && t.category !== selectedCategory) return false;
				if (search.trim()) {
					const q = search.toLowerCase();
					if (!t.description.toLowerCase().includes(q) && !t.label.toLowerCase().includes(q)) return false;
				}
				return true;
			})
			.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
	);

	const totalFiltered = $derived(
		filtered.reduce((sum, t) => sum + Math.abs(t.amount), 0)
	);

	function formatNOK(amount: number): string {
		return new Intl.NumberFormat('nb-NO', {
			style: 'currency',
			currency: 'NOK',
			maximumFractionDigits: 0
		}).format(amount);
	}

	function formatDate(iso: string): string {
		return new Intl.DateTimeFormat('nb-NO', { day: '2-digit', month: '2-digit' }).format(new Date(iso));
	}
</script>

<div class="tl-overlay" role="dialog" aria-modal="true" aria-label={title}>
	<!-- Header -->
	<div class="tl-header">
		<button class="tl-back" type="button" onclick={onclose} aria-label="Lukk">
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
				<polyline points="15 18 9 12 15 6"></polyline>
			</svg>
		</button>
		<div class="tl-header-copy">
			<h2 class="tl-title">{title}</h2>
			<p class="tl-subtitle">{filtered.length} transaksjoner · {formatNOK(totalFiltered)}</p>
		</div>
	</div>

	<!-- Search -->
	<div class="tl-search-wrap">
		<svg class="tl-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<circle cx="11" cy="11" r="8"></circle>
			<line x1="21" y1="21" x2="16.65" y2="16.65"></line>
		</svg>
		<input
			class="tl-search"
			type="search"
			placeholder="Søk i transaksjoner…"
			bind:value={search}
			autocomplete="off"
		/>
	</div>

	<!-- Category filter chips -->
	{#if categories.length > 1}
		<div class="tl-chips" role="group" aria-label="Filtrer etter kategori">
			<button
				class="tl-chip"
				class:tl-chip-active={selectedCategory === null}
				type="button"
				onclick={() => (selectedCategory = null)}
			>
				Alle
			</button>
			{#each categories as cat}
				<button
					class="tl-chip"
					class:tl-chip-active={selectedCategory === cat.id}
					type="button"
					onclick={() => (selectedCategory = selectedCategory === cat.id ? null : cat.id)}
				>
					{cat.emoji} {cat.label}
				</button>
			{/each}
		</div>
	{/if}

	<!-- Transaction list -->
	<div class="tl-list-wrap">
		{#if filtered.length === 0}
			<p class="tl-empty">Ingen transaksjoner matcher søket.</p>
		{:else}
			<ul class="tl-list">
				{#each filtered as tx}
					<li class="tl-item">
						<span class="tl-emoji">{tx.emoji}</span>
						<div class="tl-item-main">
							<p class="tl-desc">{tx.description.length > 36 ? `${tx.description.slice(0, 34)}…` : tx.description}</p>
							<p class="tl-meta">{tx.label} · {formatDate(tx.date)}</p>
						</div>
						<p class="tl-amount">{formatNOK(Math.abs(tx.amount))}</p>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>

<style>
	.tl-overlay {
		position: fixed;
		inset: 0;
		z-index: 60;
		background: #0f0f0f;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.tl-header {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: env(safe-area-inset-top, 12px) 16px 12px;
		border-bottom: 1px solid #1e1e1e;
		flex-shrink: 0;
	}

	.tl-back {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 10px;
		color: #ccc;
		cursor: pointer;
		flex-shrink: 0;
	}

	.tl-header-copy {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.tl-title {
		margin: 0;
		font-size: 1rem;
		font-weight: 700;
		color: #e8e8e8;
		letter-spacing: -0.02em;
	}

	.tl-subtitle {
		margin: 0;
		font-size: 0.75rem;
		color: #666;
	}

	.tl-search-wrap {
		position: relative;
		padding: 12px 16px 0;
		flex-shrink: 0;
	}

	.tl-search-icon {
		position: absolute;
		left: 28px;
		top: 50%;
		transform: translateY(-20%);
		color: #555;
		pointer-events: none;
	}

	.tl-search {
		width: 100%;
		box-sizing: border-box;
		background: #141414;
		border: 1px solid #242424;
		border-radius: 12px;
		padding: 10px 12px 10px 38px;
		color: #ddd;
		font: inherit;
		font-size: 0.9rem;
	}

	.tl-search:focus {
		outline: none;
		border-color: #3c4f9f;
	}

	.tl-search::-webkit-search-cancel-button {
		filter: invert(1) opacity(0.4);
	}

	.tl-chips {
		display: flex;
		gap: 8px;
		padding: 10px 16px 0;
		overflow-x: auto;
		flex-shrink: 0;
		scrollbar-width: none;
	}

	.tl-chips::-webkit-scrollbar {
		display: none;
	}

	.tl-chip {
		white-space: nowrap;
		background: #141414;
		border: 1px solid #2a2a2a;
		border-radius: 20px;
		padding: 5px 12px;
		color: #999;
		font: inherit;
		font-size: 0.78rem;
		cursor: pointer;
		flex-shrink: 0;
	}

	.tl-chip-active {
		background: #1e2550;
		border-color: #3a4a85;
		color: #a8b4f8;
	}

	.tl-list-wrap {
		flex: 1;
		overflow-y: auto;
		padding: 12px 16px 32px;
	}

	.tl-empty {
		text-align: center;
		color: #555;
		font-size: 0.85rem;
		padding: 40px 0;
	}

	.tl-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.tl-item {
		display: grid;
		grid-template-columns: 2rem 1fr auto;
		align-items: center;
		gap: 10px;
		padding: 10px 0;
		border-bottom: 1px solid #161616;
	}

	.tl-item:last-child {
		border-bottom: none;
	}

	.tl-emoji {
		font-size: 1.1rem;
		text-align: center;
	}

	.tl-item-main {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.tl-desc {
		margin: 0;
		font-size: 0.85rem;
		color: #ddd;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.tl-meta {
		margin: 0;
		font-size: 0.72rem;
		color: #666;
	}

	.tl-amount {
		margin: 0;
		font-size: 0.85rem;
		font-weight: 600;
		color: #ccc;
		white-space: nowrap;
	}
</style>
