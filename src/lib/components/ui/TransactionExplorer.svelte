<script lang="ts">
	import { CATEGORIES, SUBCATEGORIES, type CategoryId } from '$lib/integrations/transaction-categories-client';

	interface Props {
		onclose: () => void;
	}

	let { onclose }: Props = $props();

	// ── Filter state ────────────────────────────────────────────────────────
	type Period = '14d' | '30d' | '90d' | 'custom';
	let period = $state<Period>('30d');
	let fromDate = $state(dateDaysAgo(30));
	let toDate = $state(today());
	let categoryFilter = $state('');
	let subcategoryFilter = $state('');
	let search = $state('');
	let showFilters = $state(false);
	let filtersDirty = $state(false);

	// ── Accounts ─────────────────────────────────────────────────────────────
	type Account = { accountId: string; accountName: string | null; accountType: string | null };
	let accounts = $state<Account[]>([]);
	let selectedAccountIds = $state<string[]>([]);

	// ── Transactions ─────────────────────────────────────────────────────────
	type TxRow = {
		id: string;
		accountId: string;
		date: string;
		description: string;
		typeText: string | null;
		amount: number;
		category: string;
		subcategory: string | null;
		label: string;
		emoji: string;
		isFixed: boolean;
	};
	let transactions = $state<TxRow[]>([]);
	let loading = $state(false);
	let loaded = $state(false);
	let errorMsg = $state('');

	// ── Category re-classification ────────────────────────────────────────────
	let editingTxId = $state<string | null>(null);
	let pendingCategoryId = $state<CategoryId | null>(null);
	let savingOverride = $state(false);

	// ── Derived ───────────────────────────────────────────────────────────────
	const subcategoryOptions = $derived(
		categoryFilter ? (SUBCATEGORIES[categoryFilter as CategoryId] ?? []) : []
	);

	const categoryOptions = Object.values(CATEGORIES)
		.map((c) => ({ id: c.id, label: `${c.emoji} ${c.label}` }))
		.sort((a, b) => a.label.localeCompare(b.label, 'nb-NO'));

	const filtered = $derived(
		search.trim()
			? transactions.filter(
					(t) =>
						t.description.toLowerCase().includes(search.toLowerCase()) ||
						t.label.toLowerCase().includes(search.toLowerCase())
				)
			: transactions
	);

	const total = $derived(
		filtered.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0)
	);

	const activeFilterCount = $derived(
		[
			categoryFilter ? 1 : 0,
			subcategoryFilter ? 1 : 0,
			period === 'custom' ? 1 : 0,
			selectedAccountIds.length > 0 && selectedAccountIds.length < accounts.length ? 1 : 0
		].reduce((a, b) => a + b, 0)
	);

	// ── Load accounts on mount, then auto-fetch ───────────────────────────────
	$effect(() => {
		fetch('/api/economics/accounts')
			.then((r) => r.json())
			.then((data: Account[]) => {
				accounts = data;
				selectedAccountIds = data.map((a) => a.accountId);
				loadTransactions();
			})
			.catch(() => {
				errorMsg = 'Kunne ikke laste kontoer.';
			});
	});

	// ── Actions ───────────────────────────────────────────────────────────────
	function selectPeriod(p: Period) {
		period = p;
		if (p !== 'custom') {
			const days = p === '14d' ? 14 : p === '30d' ? 30 : 90;
			fromDate = dateDaysAgo(days);
			toDate = today();
			loadTransactions();
		}
		filtersDirty = false;
	}

	function markDirty() {
		filtersDirty = true;
	}

	function onCategoryChange() {
		subcategoryFilter = '';
		markDirty();
	}

	function toggleAccount(id: string) {
		if (selectedAccountIds.includes(id)) {
			selectedAccountIds = selectedAccountIds.filter((a) => a !== id);
		} else {
			selectedAccountIds = [...selectedAccountIds, id];
		}
		markDirty();
	}

	function selectAllAccounts() {
		selectedAccountIds = accounts.map((a) => a.accountId);
		markDirty();
	}

	async function loadTransactions() {
		if (loading) return;
		loading = true;
		filtersDirty = false;
		errorMsg = '';
		transactions = [];

		const ids =
			selectedAccountIds.length > 0
				? selectedAccountIds
				: accounts.map((a) => a.accountId);

		const params = new URLSearchParams({
			from: fromDate,
			to: toDate,
			accountIds: ids.join(','),
			limit: '500'
		});
		if (categoryFilter) params.set('category', categoryFilter);
		if (subcategoryFilter) params.set('subcategory', subcategoryFilter);

		try {
			const res = await fetch(`/api/transactions?${params.toString()}`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json();
			transactions = data.transactions || [];
			loaded = true;
		} catch {
			errorMsg = 'Klarte ikke hente transaksjoner. Prøv igjen.';
		} finally {
			loading = false;
		}
	}

	function openPicker(txId: string) {
		editingTxId = txId;
		pendingCategoryId = null;
	}

	function closePicker() {
		editingTxId = null;
		pendingCategoryId = null;
	}

	async function saveOverride(tx: TxRow, newCategoryId: CategoryId, subcategoryKey?: string | null) {
		if (newCategoryId === tx.category && !subcategoryKey) {
			closePicker();
			return;
		}
		savingOverride = true;
		try {
			const res = await fetch('/api/classification-overrides', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					domain: 'transaction',
					description: tx.description,
					typeText: tx.typeText,
					amount: tx.amount,
					correctedCategory: newCategoryId,
					correctedSubcategory: subcategoryKey ?? null
				})
			});
			if (!res.ok) throw new Error('Failed');
			
			// Update local transaction immediately
			const newCat = CATEGORIES[newCategoryId];
			tx.category = newCat.id;
			tx.emoji = newCat.emoji;
			tx.label = newCat.label;
			tx.subcategory = subcategoryKey ?? null;
			closePicker();
			
			// Reload after sync completes (increased from 500ms to 2000ms for reliability)
			setTimeout(() => loadTransactions(), 2000);
		} catch {
			alert('Kunne ikke lagre kategori-endring. Prøv igjen.');
		} finally {
			savingOverride = false;
		}
	}

	// ── Helpers ───────────────────────────────────────────────────────────────
	function dateDaysAgo(days: number): string {
		const d = new Date();
		d.setDate(d.getDate() - days);
		return d.toISOString().split('T')[0];
	}

	function today(): string {
		return new Date().toISOString().split('T')[0];
	}

	function formatNOK(n: number): string {
		return new Intl.NumberFormat('nb-NO', {
			style: 'currency',
			currency: 'NOK',
			maximumFractionDigits: 0
		}).format(n);
	}

	function formatDate(iso: string): string {
		return new Intl.DateTimeFormat('nb-NO', { day: '2-digit', month: '2-digit' }).format(
			new Date(iso)
		);
	}

	function accountTypeLabel(type: string | null): string {
		if (!type) return '';
		const map: Record<string, string> = {
			brukskonto: 'Brukskonto',
			sparekonto: 'Sparekonto',
			bsu: 'BSU',
			kredittkort: 'Kredittkort',
			lønnskonto: 'Lønnskonto'
		};
		return map[type.toLowerCase()] ?? type;
	}
</script>

<div class="te-overlay" role="dialog" aria-modal="true" aria-label="Utforsk transaksjoner">
	<!-- Header -->
	<div class="te-header">
		<button class="te-back" type="button" onclick={onclose} aria-label="Lukk">
			<svg
				width="20"
				height="20"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2.5"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<polyline points="15 18 9 12 15 6"></polyline>
			</svg>
		</button>
		<div class="te-header-copy">
			<h2 class="te-title">Utforsk transaksjoner</h2>
			<p class="te-subtitle">
				{#if loading}
					Laster…
				{:else if loaded}
					{filtered.length} transaksjoner · {formatNOK(total)}
				{:else}
					Henter data…
				{/if}
			</p>
		</div>
		<button
			class="te-filter-btn"
			class:te-filter-btn-active={showFilters}
			type="button"
			onclick={() => (showFilters = !showFilters)}
			aria-label="Filtrer"
			aria-expanded={showFilters}
		>
			<svg
				width="16"
				height="16"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<line x1="4" y1="6" x2="20" y2="6"></line>
				<line x1="8" y1="12" x2="16" y2="12"></line>
				<line x1="11" y1="18" x2="13" y2="18"></line>
			</svg>
			{#if activeFilterCount > 0}
				<span class="te-filter-badge">{activeFilterCount}</span>
			{/if}
		</button>
	</div>

	<!-- Period pills (always visible) -->
	<div class="te-period-row" role="group" aria-label="Velg tidsperiode">
		{#each [['14d', '14 dager'], ['30d', '30 dager'], ['90d', '90 dager'], ['custom', 'Tilpasset']] as [val, label]}
			<button
				class="te-pill"
				class:te-pill-active={period === val}
				type="button"
				onclick={() => selectPeriod(val as Period)}
			>
				{label}
			</button>
		{/each}
	</div>

	<!-- Expanded filters -->
	{#if showFilters}
		<div class="te-filters">
			<!-- Custom date range -->
			{#if period === 'custom'}
				<div class="te-date-row">
					<label class="te-date-label">
						Fra
						<input
							class="te-date-input"
							type="date"
							bind:value={fromDate}
							oninput={markDirty}
						/>
					</label>
					<span class="te-date-sep">–</span>
					<label class="te-date-label">
						Til
						<input
							class="te-date-input"
							type="date"
							bind:value={toDate}
							oninput={markDirty}
						/>
					</label>
				</div>
			{/if}

			<!-- Category -->
			<div class="te-filter-row">
				<label class="te-select-label" for="te-cat">Kategori</label>
				<select
					id="te-cat"
					class="te-select"
					bind:value={categoryFilter}
					onchange={onCategoryChange}
				>
					<option value="">Alle kategorier</option>
					{#each categoryOptions as cat}
						<option value={cat.id}>{cat.label}</option>
					{/each}
				</select>
			</div>

			<!-- Subcategory (dependent) -->
			{#if subcategoryOptions.length > 0}
				<div class="te-filter-row">
					<label class="te-select-label" for="te-subcat">Underkategori</label>
					<select
						id="te-subcat"
						class="te-select"
						bind:value={subcategoryFilter}
						onchange={markDirty}
					>
						<option value="">Alle underkategorier</option>
						{#each subcategoryOptions as sub}
							<option value={sub.key}>{sub.label}</option>
						{/each}
					</select>
				</div>
			{/if}

			<!-- Accounts (only shown if more than one) -->
			{#if accounts.length > 1}
				<div class="te-filter-row">
					<span class="te-select-label">Kontoer</span>
					<div class="te-accounts">
						{#each accounts as acc}
							<label class="te-account-check">
								<input
									type="checkbox"
									checked={selectedAccountIds.includes(acc.accountId)}
									onchange={() => toggleAccount(acc.accountId)}
								/>
								<span class="te-account-name">
									{acc.accountName ?? acc.accountId}
									{#if acc.accountType}
										<span class="te-account-type">{accountTypeLabel(acc.accountType)}</span>
									{/if}
								</span>
							</label>
						{/each}
						{#if selectedAccountIds.length < accounts.length}
							<button
								class="te-select-all"
								type="button"
								onclick={selectAllAccounts}
							>
								Velg alle
							</button>
						{/if}
					</div>
				</div>
			{/if}

			<!-- Apply button (shown when filters are stale) -->
			{#if filtersDirty}
				<button class="te-apply" type="button" onclick={loadTransactions}>
					Oppdater resultater →
				</button>
			{/if}
		</div>
	{/if}

	<!-- Text search -->
	<div class="te-search-wrap">
		<svg
			class="te-search-icon"
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<circle cx="11" cy="11" r="8"></circle>
			<line x1="21" y1="21" x2="16.65" y2="16.65"></line>
		</svg>
		<input
			class="te-search"
			type="search"
			placeholder="Søk i beskrivelse eller kategori…"
			bind:value={search}
			autocomplete="off"
		/>
	</div>

	<!-- Transaction list -->
	<div class="te-list-wrap">
		{#if errorMsg}
			<p class="te-error">{errorMsg}</p>
		{:else if loading}
			<div class="te-loading">
				<div class="te-spinner"></div>
				<p>Henter transaksjoner…</p>
			</div>
		{:else if !loaded}
			<p class="te-empty">Henter data…</p>
		{:else if filtered.length === 0}
			<p class="te-empty">Ingen transaksjoner matcher filtrene.</p>
		{:else}
			<ul class="te-list">
				{#each filtered as tx}
					<li class="te-item">
						{#if editingTxId === tx.id}
							<div class="te-category-picker">
								<div class="te-picker-header">
									{#if pendingCategoryId}
										<button
											class="te-picker-back"
											type="button"
											onclick={() => (pendingCategoryId = null)}
											disabled={savingOverride}
											aria-label="Tilbake"
										>← {CATEGORIES[pendingCategoryId].emoji} {CATEGORIES[pendingCategoryId].label}</button>
									{:else}
										<span class="te-picker-title">Velg kategori</span>
									{/if}
									<button
										class="te-picker-close"
										type="button"
										onclick={closePicker}
										disabled={savingOverride}
										aria-label="Avbryt"
									>
										✕
									</button>
								</div>

								{#if pendingCategoryId && (SUBCATEGORIES[pendingCategoryId]?.length ?? 0) > 0}
									<!-- Step 2: subcategory picker -->
									<div class="te-picker-cats">
										<button
											class="te-picker-cat"
											type="button"
											disabled={savingOverride}
											onclick={() => saveOverride(tx, pendingCategoryId!, null)}
										>
											— Ingen underkategori
										</button>
										{#each SUBCATEGORIES[pendingCategoryId] ?? [] as sub}
											<button
												class="te-picker-cat"
												class:te-picker-cat-active={tx.subcategory === sub.key && tx.category === pendingCategoryId}
												type="button"
												disabled={savingOverride}
												onclick={() => saveOverride(tx, pendingCategoryId!, sub.key)}
											>
												{sub.label}
											</button>
										{/each}
									</div>
								{:else}
									<!-- Step 1: top-level category picker -->
									<div class="te-picker-cats">
										{#each Object.values(CATEGORIES) as cat}
											<button
												class="te-picker-cat"
												class:te-picker-cat-active={cat.id === tx.category && !pendingCategoryId}
												type="button"
												disabled={savingOverride}
												onclick={() => {
													const hasSubs = (SUBCATEGORIES[cat.id as CategoryId]?.length ?? 0) > 0;
													if (hasSubs) {
														pendingCategoryId = cat.id as CategoryId;
													} else {
														saveOverride(tx, cat.id as CategoryId, null);
													}
												}}
											>
												{cat.emoji} {cat.label}{(SUBCATEGORIES[cat.id as CategoryId]?.length ?? 0) > 0 ? ' ›' : ''}
											</button>
										{/each}
									</div>
								{/if}
							</div>
						{:else}
							<button
								class="te-emoji-btn"
								type="button"
								onclick={() => openPicker(tx.id)}
								aria-label="Endre kategori"
								title="Endre kategori"
							>
								{tx.emoji}
							</button>
							<div class="te-item-main">
								<p class="te-desc">
									{tx.description.length > 36
										? `${tx.description.slice(0, 34)}…`
										: tx.description}
								</p>
								<p class="te-meta">
									{tx.label}{tx.subcategory ? ` · ${tx.subcategory}` : ''} · {formatDate(tx.date)}
								</p>
							</div>
							<p class="te-amount" class:te-amount-pos={tx.amount > 0}>
								{formatNOK(Math.abs(tx.amount))}
							</p>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>

<style>
	.te-overlay {
		position: fixed;
		inset: 0;
		z-index: 60;
		background: #0f0f0f;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	/* Header */
	.te-header {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: env(safe-area-inset-top, 12px) 16px 12px;
		border-bottom: 1px solid #1e1e1e;
		flex-shrink: 0;
	}

	.te-back {
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

	.te-header-copy {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.te-title {
		margin: 0;
		font-size: 1rem;
		font-weight: 700;
		color: #e8e8e8;
		letter-spacing: -0.02em;
	}

	.te-subtitle {
		margin: 0;
		font-size: 0.75rem;
		color: #666;
	}

	.te-filter-btn {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 10px;
		color: #888;
		cursor: pointer;
		flex-shrink: 0;
	}

	.te-filter-btn-active {
		background: #1e2550;
		border-color: #3a4a85;
		color: #a8b4f8;
	}

	.te-filter-badge {
		position: absolute;
		top: -4px;
		right: -4px;
		background: #7c8ef5;
		color: #fff;
		border-radius: 99px;
		font-size: 0.6rem;
		font-weight: 700;
		padding: 1px 4px;
		line-height: 1.4;
	}

	/* Period pills */
	.te-period-row {
		display: flex;
		gap: 8px;
		padding: 12px 16px 0;
		flex-shrink: 0;
		overflow-x: auto;
		scrollbar-width: none;
	}

	.te-period-row::-webkit-scrollbar {
		display: none;
	}

	.te-pill {
		white-space: nowrap;
		background: #141414;
		border: 1px solid #2a2a2a;
		border-radius: 20px;
		padding: 6px 14px;
		color: #999;
		font: inherit;
		font-size: 0.8rem;
		cursor: pointer;
		flex-shrink: 0;
		transition: background 0.12s, border-color 0.12s, color 0.12s;
	}

	.te-pill-active {
		background: #1e2550;
		border-color: #3a4a85;
		color: #a8b4f8;
	}

	/* Expanded filters */
	.te-filters {
		padding: 12px 16px;
		border-bottom: 1px solid #1a1a1a;
		display: flex;
		flex-direction: column;
		gap: 10px;
		flex-shrink: 0;
		background: #0c0c0c;
	}

	.te-date-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.te-date-label {
		display: flex;
		flex-direction: column;
		gap: 3px;
		font-size: 0.72rem;
		color: #666;
		flex: 1;
	}

	.te-date-sep {
		color: #444;
		padding-top: 16px;
	}

	.te-date-input {
		background: #141414;
		border: 1px solid #2a2a2a;
		border-radius: 8px;
		padding: 7px 10px;
		color: #ccc;
		font: inherit;
		font-size: 0.82rem;
		width: 100%;
	}

	.te-date-input:focus {
		outline: none;
		border-color: #3c4f9f;
	}

	.te-filter-row {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.te-select-label {
		font-size: 0.72rem;
		color: #666;
	}

	.te-select {
		background: #141414;
		border: 1px solid #2a2a2a;
		border-radius: 8px;
		padding: 8px 10px;
		color: #ccc;
		font: inherit;
		font-size: 0.85rem;
		appearance: none;
		-webkit-appearance: none;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23666' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right 10px center;
		padding-right: 30px;
	}

	.te-select:focus {
		outline: none;
		border-color: #3c4f9f;
	}

	.te-accounts {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.te-account-check {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 0.82rem;
		color: #bbb;
		cursor: pointer;
	}

	.te-account-check input[type='checkbox'] {
		accent-color: #7c8ef5;
		width: 15px;
		height: 15px;
	}

	.te-account-name {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.te-account-type {
		font-size: 0.7rem;
		color: #555;
	}

	.te-select-all {
		background: none;
		border: none;
		color: #7c8ef5;
		font: inherit;
		font-size: 0.78rem;
		cursor: pointer;
		padding: 0;
		text-decoration: underline;
		text-underline-offset: 2px;
		align-self: flex-start;
	}

	.te-apply {
		background: #1e2550;
		border: 1px solid #3a4a85;
		border-radius: 10px;
		color: #a8b4f8;
		font: inherit;
		font-size: 0.85rem;
		font-weight: 600;
		padding: 10px 16px;
		cursor: pointer;
		text-align: center;
		transition: background 0.12s;
	}

	.te-apply:active {
		background: #252d60;
	}

	/* Search */
	.te-search-wrap {
		position: relative;
		padding: 12px 16px 0;
		flex-shrink: 0;
	}

	.te-search-icon {
		position: absolute;
		left: 28px;
		top: 50%;
		transform: translateY(-20%);
		color: #555;
		pointer-events: none;
	}

	.te-search {
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

	.te-search:focus {
		outline: none;
		border-color: #3c4f9f;
	}

	.te-search::-webkit-search-cancel-button {
		filter: invert(1) opacity(0.4);
	}

	/* List */
	.te-list-wrap {
		flex: 1;
		overflow-y: auto;
		padding: 12px 16px 32px;
	}

	.te-loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		padding: 48px 0;
		color: #555;
		font-size: 0.85rem;
	}

	.te-spinner {
		width: 24px;
		height: 24px;
		border: 2px solid #222;
		border-top-color: #7c8ef5;
		border-radius: 50%;
		animation: te-spin 0.7s linear infinite;
	}

	@keyframes te-spin {
		to {
			transform: rotate(360deg);
		}
	}

	.te-empty,
	.te-error {
		text-align: center;
		font-size: 0.85rem;
		padding: 40px 0;
	}

	.te-empty {
		color: #555;
	}

	.te-error {
		color: #e07070;
	}

	.te-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.te-item {
		display: grid;
		grid-template-columns: 2rem 1fr auto;
		align-items: center;
		gap: 10px;
		padding: 10px 0;
		border-bottom: 1px solid #161616;
	}

	.te-item:last-child {
		border-bottom: none;
	}

	.te-emoji-btn {
		font-size: 1.1rem;
		text-align: center;
		background: none;
		border: none;
		cursor: pointer;
		padding: 0;
		line-height: 1;
	}

	.te-item-main {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.te-desc {
		margin: 0;
		font-size: 0.85rem;
		color: #ddd;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.te-meta {
		margin: 0;
		font-size: 0.72rem;
		color: #666;
	}

	.te-amount {
		margin: 0;
		font-size: 0.85rem;
		font-weight: 600;
		color: #ccc;
		white-space: nowrap;
	}

	.te-amount-pos {
		color: #82c882;
	}

	/* Category picker (inline) */
	.te-category-picker {
		grid-column: 1 / -1;
		background: #141414;
		border: 1px solid #2a2a2a;
		border-radius: 12px;
		padding: 12px;
	}

	.te-picker-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 10px;
	}

	.te-picker-title {
		font-size: 0.78rem;
		color: #888;
	}

	.te-picker-back {
		background: none;
		border: none;
		color: #7c8ef5;
		font: inherit;
		font-size: 0.78rem;
		cursor: pointer;
		padding: 0;
	}

	.te-picker-back:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.te-picker-close {
		background: none;
		border: none;
		color: #666;
		cursor: pointer;
		font-size: 0.85rem;
		padding: 2px 6px;
	}

	.te-picker-cats {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.te-picker-cat {
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 8px;
		color: #bbb;
		font: inherit;
		font-size: 0.78rem;
		padding: 5px 10px;
		cursor: pointer;
	}

	.te-picker-cat-active {
		background: #1e2550;
		border-color: #3a4a85;
		color: #a8b4f8;
	}

	.te-picker-cat:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
