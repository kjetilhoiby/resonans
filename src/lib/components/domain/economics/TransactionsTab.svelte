<script lang="ts">
	import { Button, Checkbox, Input, SectionCard, Select } from '$lib/components/ui';
	import CompactRecordList from '$lib/components/ui/CompactRecordList.svelte';
	import PeriodPills from '$lib/components/ui/PeriodPills.svelte';
	import { CATEGORIES, SUBCATEGORIES, type CategoryId } from '$lib/integrations/transaction-categories-client';

	type TransactionWindow = '14d' | '30d' | '90d';

	type Account = {
		accountId: string;
		accountName: string | null;
		accountType: string | null;
		accountNumber: string | null;
		balance: number;
		availableBalance: number | null;
		currency: string | null;
	};

	type TransactionRow = {
		transactionId: string;
		accountId: string;
		date: string;
		description: string;
		amount: number;
		category: string;
		subcategory: string | null;
		label: string;
		emoji: string;
		isFixed: boolean;
	};

	interface Props {
		accountId: string;
		accounts: Account[];
		currency: string;
	}

	let { accountId, accounts, currency }: Props = $props();

	let transactionWindow = $state<TransactionWindow>('30d');
	let transactions = $state<TransactionRow[]>([]);
	let loadingTransactions = $state(false);
	let loadedTransactionsKey = $state<string | null>(null);
	let transactionFromDate = $state(dateDaysAgo(30));
	let transactionToDate = $state(new Date().toISOString().split('T')[0]);
	let transactionCategoryFilter = $state<string>('');
	let transactionSubcategoryFilter = $state<string>('');
	let selectedTransactionAccountIds = $state<string[]>([]);

	const transactionCategoryOptions = Object.values(CATEGORIES)
		.map((cat) => ({ id: cat.id, label: `${cat.emoji} ${cat.label}` }))
		.sort((a, b) => a.label.localeCompare(b.label, 'nb-NO'));

	const transactionSubcategoryOptions = $derived(() => {
		if (!transactionCategoryFilter) return [];
		const key = transactionCategoryFilter as CategoryId;
		return SUBCATEGORIES[key] ?? [];
	});

	function dateDaysAgo(days: number): string {
		const date = new Date();
		date.setDate(date.getDate() - days);
		return date.toISOString().split('T')[0];
	}

	function formatNOK(value: number, cur = 'NOK'): string {
		return new Intl.NumberFormat('nb-NO', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(value);
	}

	// Initialize selected accounts
	$effect(() => {
		if (accounts.length > 0 && selectedTransactionAccountIds.length === 0) {
			selectedTransactionAccountIds = [accountId];
		}
	});

	// Load transactions when accountId or window changes
	$effect(() => {
		const id = accountId;
		const txWindow = transactionWindow;
		if (!id) return;

		if (loadedTransactionsKey !== `${id}:${txWindow}`) {
			const days = txWindow === '14d' ? 14 : txWindow === '30d' ? 30 : 90;
			transactionFromDate = dateDaysAgo(days);
			transactionToDate = new Date().toISOString().split('T')[0];
			loadTransactions();
		}
	});

	function toggleTransactionAccount(accountIdToToggle: string) {
		if (selectedTransactionAccountIds.includes(accountIdToToggle)) {
			selectedTransactionAccountIds = selectedTransactionAccountIds.filter((id) => id !== accountIdToToggle);
		} else {
			selectedTransactionAccountIds = [...selectedTransactionAccountIds, accountIdToToggle];
		}
		loadedTransactionsKey = null;
	}

	function selectAllTransactionAccounts() {
		selectedTransactionAccountIds = accounts.map((a) => a.accountId);
		loadedTransactionsKey = null;
	}

	function resetTransactionFilters() {
		selectedTransactionAccountIds = [accountId];
		const days = transactionWindow === '14d' ? 14 : transactionWindow === '30d' ? 30 : 90;
		transactionFromDate = dateDaysAgo(days);
		transactionToDate = new Date().toISOString().split('T')[0];
		transactionCategoryFilter = '';
		transactionSubcategoryFilter = '';
		loadedTransactionsKey = null;
		loadTransactions();
	}

	async function loadTransactions() {
		if (loadingTransactions) return;
		loadingTransactions = true;
		transactions = [];

		const accountIds = selectedTransactionAccountIds.length > 0
			? selectedTransactionAccountIds
			: accounts.map((a) => a.accountId);

		const params = new URLSearchParams({
			fromDate: transactionFromDate,
			toDate: transactionToDate,
			accountIds: accountIds.join(',')
		});

		if (transactionCategoryFilter) {
			params.set('category', transactionCategoryFilter);
		}
		if (transactionSubcategoryFilter) {
			params.set('subcategory', transactionSubcategoryFilter);
		}

		const res = await fetch(
			`/api/economics/transactions?${params.toString()}`
		);
		transactions = await res.json();
		loadedTransactionsKey = `${accountId}:${transactionWindow}`;
		loadingTransactions = false;
	}

	const transactionItems = $derived(
		transactions.map((tx) => ({
			id: tx.transactionId,
			title: `${tx.emoji} ${tx.label}${tx.subcategory ? ` · ${tx.subcategory}` : ''}`,
			subtitle: `${tx.description}${tx.accountId ? ` · konto ${tx.accountId}` : ''}`,
			meta: tx.date,
			amount: formatNOK(tx.amount, currency),
			amountTone: tx.amount > 0 ? ('positive' as const) : ('negative' as const)
		}))
	);
</script>

<div class="transactions-head">
	<h2>Transaksjonsutforsker</h2>
	<PeriodPills
		options={['14d', '30d', '90d']}
		value={transactionWindow}
		onchange={(value) => {
			transactionWindow = value as TransactionWindow;
			loadedTransactionsKey = null;
			const days = value === '14d' ? 14 : value === '30d' ? 30 : 90;
			transactionFromDate = dateDaysAgo(days);
			transactionToDate = new Date().toISOString().split('T')[0];
			loadTransactions();
		}}
	/>
</div>
<SectionCard tone="subtle" className="tx-explorer-filters">
	<div class="tx-filter-row">
		<label>
			Fra dato
			<Input type="date" bind:value={transactionFromDate} />
		</label>
		<label>
			Til dato
			<Input type="date" bind:value={transactionToDate} />
		</label>
		<label>
			Kategori
			<Select
				bind:value={transactionCategoryFilter}
				onChange={() => {
					transactionSubcategoryFilter = '';
					loadedTransactionsKey = null;
				}}
			>
				<option value="">Alle kategorier</option>
				{#each transactionCategoryOptions as option}
					<option value={option.id}>{option.label}</option>
				{/each}
			</Select>
		</label>
		<label>
			Subkategori
			<Select bind:value={transactionSubcategoryFilter} disabled={!transactionCategoryFilter}>
				<option value="">Alle subkategorier</option>
				{#each transactionSubcategoryOptions() as option}
					<option value={option.key}>{option.label}</option>
				{/each}
			</Select>
		</label>
	</div>
	<div class="tx-filter-row tx-accounts-row">
		<span class="tx-filter-label">Kontoer</span>
		<Button variant="ghost" className="tx-mini-btn" onClick={selectAllTransactionAccounts}>Velg alle</Button>
		<Button variant="ghost" className="tx-mini-btn" onClick={resetTransactionFilters}>Nullstill</Button>
	</div>
	<div class="tx-account-list">
		{#each accounts as account}
			<label class="tx-account-chip">
				<Checkbox
					checked={selectedTransactionAccountIds.includes(account.accountId)}
					onChange={() => toggleTransactionAccount(account.accountId)}
				/>
				<span>{account.accountName ?? account.accountId}</span>
			</label>
		{/each}
	</div>
	<div class="tx-filter-actions">
		<Button
			variant="secondary"
			className="refresh-button"
			onClick={() => { loadedTransactionsKey = null; loadTransactions(); }}
		>
			Oppdater treff
		</Button>
		<span class="tx-match-count">{transactions.length} treff</span>
	</div>
</SectionCard>
{#if loadingTransactions}
	<div class="loading">Laster transaksjoner...</div>
{:else}
	<CompactRecordList
		title="Alle treff"
		items={transactionItems}
		emptyText="Ingen transaksjoner i valgt periode."
	/>
{/if}

<style>
	h2 { margin: 0 0 0.25rem; font-size: 1.25rem; }

	.loading {
		padding: 3rem;
		text-align: center;
		color: var(--text-secondary);
	}

	.transactions-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		margin-bottom: 10px;
	}

	:global(.tx-explorer-filters) {
		background: var(--surface-color);
		border: 1px solid var(--border-color);
		border-radius: 12px;
		padding: 1rem;
		margin-bottom: 1rem;
		display: grid;
		gap: 0.75rem;
	}

	.tx-filter-row {
		display: flex;
		align-items: flex-end;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.tx-filter-row label {
		display: grid;
		gap: 0.35rem;
		font-size: 0.82rem;
		color: var(--text-secondary);
	}

	.tx-filter-row :global(input),
	.tx-filter-row :global(.ds-select) {
		border: 1px solid var(--border-color);
		border-radius: 8px;
		padding: 0.5rem 0.6rem;
		font-size: 0.88rem;
		background: var(--bg-color);
		color: var(--text-primary);
	}

	.tx-accounts-row {
		align-items: center;
	}

	.tx-filter-label {
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--text-secondary);
	}

	.tx-account-list {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.tx-account-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		background: var(--bg-color);
		border: 1px solid var(--border-color);
		border-radius: 999px;
		padding: 0.35rem 0.7rem;
		font-size: 0.8rem;
		color: var(--text-secondary);
	}

	:global(.tx-mini-btn) {
		border: 1px solid var(--border-color);
		background: var(--bg-color);
		color: var(--text-secondary);
		border-radius: 8px;
		padding: 0.35rem 0.6rem;
		font-size: 0.8rem;
		cursor: pointer;
	}

	.tx-filter-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.tx-match-count {
		font-size: 0.82rem;
		color: var(--text-secondary);
	}

	@media (max-width: 760px) {
		h2 {
			font-size: 1.06rem;
		}

		.tx-filter-row {
			flex-direction: column;
			align-items: stretch;
		}

		.tx-filter-actions {
			flex-direction: column;
			align-items: flex-start;
		}
	}
</style>
