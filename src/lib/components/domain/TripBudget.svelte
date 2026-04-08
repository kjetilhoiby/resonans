<!--
  TripBudget — Reiseregnskap for reise-tema.
  Viser utgifter i turperioden + søk utenfor perioden.
  Props:
    themeId     – tema-UUID
    startDate   – turens startdato (YYYY-MM-DD)
    endDate     – turens sluttdato (YYYY-MM-DD)
-->
<script lang="ts">
	interface Account {
		id: string;
		name: string | null;
	}

	interface Transaction {
		id: string;
		date: string;
		accountId: string | null;
		amount: number;
		description: string;
		category: string;
		label: string | null;
		emoji: string | null;
	}

	interface Props {
		themeId: string;
		startDate: string;
		endDate: string;
	}

	let { themeId, startDate, endDate }: Props = $props();

	// ── State ──────────────────────────────────────────────
	type Tab = 'tur' | 'søk';
	let activeTab = $state<Tab>('tur');

	let accounts = $state<Account[]>([]);
	let selectedAccountId = $state<string>('');  // '' = all

	// Tur-tab
	let turTransactions = $state<Transaction[]>([]);
	let turTotal = $state(0);
	let turLoading = $state(false);
	let turLoaded = $state(false);

	// Søk-tab
	let searchText = $state('');
	let searchFrom = $state('');
	let searchTo = $state('');
	let searchResults = $state<Transaction[]>([]);
	let searchTotal = $state(0);
	let searching = $state(false);
	let searchDone = $state(false);

	// ── Format helpers ─────────────────────────────────────
	function fmtAmount(nok: number): string {
		return new Intl.NumberFormat('nb-NO', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.abs(nok));
	}

	function fmtDate(iso: string): string {
		return new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short' }).format(new Date(iso));
	}

	// ── Load trip transactions ─────────────────────────────
	async function loadTur() {
		turLoading = true;
		try {
			const p = new URLSearchParams({ from: startDate, to: endDate });
			if (selectedAccountId) p.set('accountId', selectedAccountId);
			const res = await fetch(`/api/tema/${themeId}/transactions?${p}`);
			if (!res.ok) return;
			const data = await res.json() as { transactions: Transaction[]; accounts: Account[]; totalSpent: number };
			turTransactions = data.transactions;
			turTotal = data.totalSpent;
			if (data.accounts.length) accounts = data.accounts;
			turLoaded = true;
		} finally {
			turLoading = false;
		}
	}

	// ── Search ─────────────────────────────────────────────
	async function runSearch() {
		const q = searchText.trim();
		if (!q && !searchFrom) return;
		searching = true;
		searchDone = false;
		try {
			const p = new URLSearchParams();
			if (q) p.set('search', q);
			if (searchFrom) p.set('from', searchFrom);
			if (searchTo) p.set('to', searchTo || new Date().toISOString().slice(0, 10));
			if (selectedAccountId) p.set('accountId', selectedAccountId);
			const res = await fetch(`/api/tema/${themeId}/transactions?${p}`);
			if (!res.ok) return;
			const data = await res.json() as { transactions: Transaction[]; accounts: Account[]; totalSpent: number };
			searchResults = data.transactions;
			searchTotal = data.totalSpent;
			if (!accounts.length && data.accounts.length) accounts = data.accounts;
			searchDone = true;
		} finally {
			searching = false;
		}
	}

	// ── Category breakdown (tur) ───────────────────────────
	const breakdown = $derived.by(() => {
		const txList = activeTab === 'tur' ? turTransactions : searchResults;
		const map = new Map<string, { label: string; emoji: string; total: number }>();
		for (const tx of txList) {
			if (tx.amount >= 0) continue; // skip income
			const key = tx.category ?? 'annet';
			const entry = map.get(key) ?? { label: tx.label ?? key, emoji: tx.emoji ?? '💸', total: 0 };
			entry.total += Math.abs(tx.amount);
			map.set(key, entry);
		}
		return Array.from(map.values()).sort((a, b) => b.total - a.total);
	});

	// Load tur on mount
	import { onMount } from 'svelte';
	onMount(() => { void loadTur(); });

	// Reload tur when account filter changes
	$effect(() => {
		// eslint-disable-next-line @typescript-eslint/no-unused-expressions
		selectedAccountId; // reactive dependency
		if (turLoaded) void loadTur();
	});
</script>

<div class="tb">
	<div class="tb-header">
		<h3 class="tb-title">💳 Reiseregnskap</h3>

		<!-- Account selector -->
		{#if accounts.length > 1}
			<select class="tb-account-sel" bind:value={selectedAccountId} aria-label="Velg konto">
				<option value="">Alle kontoer</option>
				{#each accounts as acc}
					<option value={acc.id}>{acc.name ?? acc.id}</option>
				{/each}
			</select>
		{/if}
	</div>

	<!-- Tabs -->
	<div class="tb-tabs" role="tablist">
		<button
			role="tab"
			type="button"
			class="tb-tab"
			class:tb-tab-active={activeTab === 'tur'}
			onclick={() => { activeTab = 'tur'; if (!turLoaded) void loadTur(); }}
			aria-selected={activeTab === 'tur'}
		>Turperioden</button>
		<button
			role="tab"
			type="button"
			class="tb-tab"
			class:tb-tab-active={activeTab === 'søk'}
			onclick={() => { activeTab = 'søk'; }}
			aria-selected={activeTab === 'søk'}
		>Søk</button>
	</div>

	<!-- Tur-tab -->
	{#if activeTab === 'tur'}
		{#if turLoading}
			<p class="tb-loading">Laster transaksjoner…</p>
		{:else if turLoaded}
			{#if turTransactions.length === 0}
				<p class="tb-empty">Ingen transaksjoner i turperioden.</p>
			{:else}
				<div class="tb-summary">
					<span class="tb-total-label">Totalt brukt</span>
					<span class="tb-total-amount">{fmtAmount(turTotal)} kr</span>
				</div>

				<!-- Category breakdown -->
				{#if breakdown.length > 0}
					<div class="tb-breakdown">
						{#each breakdown as cat}
							<div class="tb-cat-row">
								<span class="tb-cat-emoji">{cat.emoji}</span>
								<span class="tb-cat-label">{cat.label}</span>
								<span class="tb-cat-amount">{fmtAmount(cat.total)} kr</span>
							</div>
						{/each}
					</div>
				{/if}

				<!-- Transaction list -->
				<ul class="tb-tx-list">
					{#each turTransactions as tx (tx.id)}
						{@const isSpend = tx.amount < 0}
						<li class="tb-tx" class:tb-tx-income={!isSpend}>
							<span class="tb-tx-emoji">{tx.emoji ?? '💸'}</span>
							<span class="tb-tx-info">
								<span class="tb-tx-desc">{tx.description}</span>
								<span class="tb-tx-date">{fmtDate(tx.date)}</span>
							</span>
							<span class="tb-tx-amount" class:tb-tx-pos={!isSpend}>
								{isSpend ? '-' : '+'}{fmtAmount(tx.amount)} kr
							</span>
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	{/if}

	<!-- Søk-tab -->
	{#if activeTab === 'søk'}
		<div class="tb-search-form">
			<input
				class="tb-input tb-input-full"
				type="text"
				placeholder="Søk på beskrivelse (f.eks. fly, hotell…)"
				bind:value={searchText}
				onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && runSearch()}
			/>
			<div class="tb-search-dates">
				<label class="tb-date-field">
					<span class="tb-date-label">Fra</span>
					<input class="tb-input" type="date" bind:value={searchFrom} />
				</label>
				<label class="tb-date-field">
					<span class="tb-date-label">Til</span>
					<input class="tb-input" type="date" bind:value={searchTo} />
				</label>
			</div>
			<button
				class="tb-search-btn"
				type="button"
				onclick={runSearch}
				disabled={searching || (!searchText.trim() && !searchFrom)}
			>
				{searching ? 'Søker…' : 'Søk'}
			</button>
		</div>

		{#if searchDone}
			{#if searchResults.length === 0}
				<p class="tb-empty">Ingen treff.</p>
			{:else}
				<div class="tb-summary">
					<span class="tb-total-label">Totalt brukt ({searchResults.length} transaksjoner)</span>
					<span class="tb-total-amount">{fmtAmount(searchTotal)} kr</span>
				</div>
				<ul class="tb-tx-list">
					{#each searchResults as tx (tx.id)}
						{@const isSpend = tx.amount < 0}
						<li class="tb-tx" class:tb-tx-income={!isSpend}>
							<span class="tb-tx-emoji">{tx.emoji ?? '💸'}</span>
							<span class="tb-tx-info">
								<span class="tb-tx-desc">{tx.description}</span>
								<span class="tb-tx-date">{fmtDate(tx.date)}</span>
							</span>
							<span class="tb-tx-amount" class:tb-tx-pos={!isSpend}>
								{isSpend ? '-' : '+'}{fmtAmount(tx.amount)} kr
							</span>
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	{/if}
</div>

<style>
	.tb {
		display: flex;
		flex-direction: column;
		gap: 0;
	}

	.tb-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 8px;
	}

	.tb-title {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--tp-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		margin: 0;
	}

	.tb-account-sel {
		font-size: 0.75rem;
		background: var(--tp-bg-2);
		border: 1px solid var(--tp-border);
		border-radius: 6px;
		color: var(--tp-text-soft);
		padding: 3px 6px;
		cursor: pointer;
	}

	/* Tabs */
	.tb-tabs {
		display: flex;
		gap: 2px;
		margin-bottom: 10px;
		border-bottom: 1px solid var(--tp-border);
	}

	.tb-tab {
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		padding: 6px 12px;
		margin-bottom: -1px;
		font-size: 0.8rem;
		color: var(--tp-text-muted);
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
	}

	.tb-tab:hover { color: var(--tp-text-soft); }

	.tb-tab-active {
		color: var(--tp-accent);
		border-bottom-color: var(--tp-accent);
		font-weight: 600;
	}

	/* Summary */
	.tb-summary {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		padding: 8px 0 6px;
		border-bottom: 1px solid var(--tp-border);
		margin-bottom: 6px;
	}

	.tb-total-label {
		font-size: 0.75rem;
		color: var(--tp-text-muted);
	}

	.tb-total-amount {
		font-size: 1.1rem;
		font-weight: 700;
		color: var(--tp-text);
	}

	/* Category breakdown */
	.tb-breakdown {
		display: flex;
		flex-direction: column;
		gap: 3px;
		margin-bottom: 10px;
	}

	.tb-cat-row {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.78rem;
	}

	.tb-cat-emoji { font-size: 0.9rem; }

	.tb-cat-label {
		flex: 1;
		color: var(--tp-text-soft);
	}

	.tb-cat-amount {
		color: var(--tp-text-muted);
		font-size: 0.75rem;
		font-weight: 600;
	}

	/* Transaction list */
	.tb-tx-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.tb-tx {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 0;
		border-bottom: 1px solid var(--tp-border);
		font-size: 0.8rem;
	}

	.tb-tx:last-child { border-bottom: none; }

	.tb-tx-emoji { font-size: 1rem; flex-shrink: 0; }

	.tb-tx-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.tb-tx-desc {
		color: var(--tp-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: 0.82rem;
	}

	.tb-tx-date {
		font-size: 0.68rem;
		color: var(--tp-text-muted);
	}

	.tb-tx-amount {
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--tp-text);
		flex-shrink: 0;
	}

	.tb-tx-amount.tb-tx-pos { color: #4caf72; }

	/* Search form */
	.tb-search-form {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-bottom: 12px;
	}

	.tb-search-dates {
		display: flex;
		gap: 8px;
	}

	.tb-date-field {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.tb-date-label {
		font-size: 0.68rem;
		color: var(--tp-text-muted);
	}

	.tb-input {
		background: var(--tp-bg-2);
		border: 1px solid var(--tp-border);
		border-radius: 8px;
		color: var(--tp-text);
		font-size: 0.82rem;
		padding: 7px 10px;
	}

	.tb-input-full { width: 100%; box-sizing: border-box; }

	.tb-input:focus {
		outline: none;
		border-color: var(--tp-accent);
	}

	.tb-search-btn {
		background: var(--tp-accent);
		border: none;
		border-radius: 8px;
		color: #fff;
		font-size: 0.82rem;
		font-weight: 600;
		padding: 8px 16px;
		cursor: pointer;
		align-self: flex-start;
	}

	.tb-search-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.tb-loading,
	.tb-empty {
		font-size: 0.8rem;
		color: var(--tp-text-muted);
		padding: 12px 0;
	}
</style>
