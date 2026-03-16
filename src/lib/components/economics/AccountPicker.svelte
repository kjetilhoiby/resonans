<script lang="ts">
	export type Account = {
		accountId: string;
		accountName: string | null;
		accountType: string | null;
		accountNumber: string | null;
		balance: number;
		availableBalance: number | null;
		currency: string | null;
	};

	let {
		accounts,
		selectedAccountId,
		onSelect
	}: {
		accounts: Account[];
		selectedAccountId: string;
		onSelect: (id: string) => void;
	} = $props();

	let open = $state(false);
	const selected = $derived(accounts.find((a) => a.accountId === selectedAccountId) ?? accounts[0] ?? null);

	function pick(id: string) {
		open = false;
		onSelect(id);
	}

	function formatNOK(value: number, currency = 'NOK'): string {
		return new Intl.NumberFormat('nb-NO', {
			style: 'currency',
			currency,
			maximumFractionDigits: 0
		}).format(value);
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
{#if open}
	<div class="backdrop" onclick={() => (open = false)}></div>
{/if}

<div class="picker">
	<button class="toggle" onclick={() => (open = !open)} disabled={!selected}>
		{#if selected}
			<div class="toggle-info">
				<span class="toggle-name">{selected.accountName ?? selected.accountId}</span>
				<span class="toggle-meta">{selected.accountType ?? ''} · {formatNOK(selected.balance, selected.currency ?? 'NOK')}</span>
			</div>
		{:else}
			<span class="toggle-name">Laster kontoer…</span>
		{/if}
		<svg class="chevron" class:open width="16" height="16" viewBox="0 0 16 16" fill="none">
			<path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
		</svg>
	</button>

	{#if open}
		<div class="dropdown">
			{#each accounts as account}
				<button
					class="item"
					class:selected={account.accountId === selectedAccountId}
					onclick={() => pick(account.accountId)}
				>
					<div class="item-name">{account.accountName ?? account.accountId}</div>
					<div class="item-type">{account.accountType ?? ''}</div>
					<div class="item-balance">{formatNOK(account.balance, account.currency ?? 'NOK')}</div>
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.picker {
		position: relative;
		display: inline-block;
		margin-bottom: 1.5rem;
	}

	.toggle {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.6rem 1rem;
		background: var(--surface-color, #fff);
		border: 2px solid #10b981;
		border-radius: 12px;
		cursor: pointer;
		text-align: left;
		min-width: 220px;
		box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.12);
		transition: border-color 0.15s;
	}
	.toggle:hover:not(:disabled) { border-color: #059669; }
	.toggle:disabled { opacity: 0.6; cursor: default; }

	.toggle-info { flex: 1; min-width: 0; }
	.toggle-name {
		display: block;
		font-weight: 600;
		font-size: 0.9rem;
		color: var(--text-primary, #0f172a);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.toggle-meta {
		display: block;
		font-size: 0.75rem;
		color: var(--text-secondary, #64748b);
		margin-top: 0.1rem;
	}

	.chevron { flex-shrink: 0; color: var(--text-secondary, #64748b); transition: transform 0.2s; }
	.chevron.open { transform: rotate(180deg); }

	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 9;
	}

	.dropdown {
		position: absolute;
		top: calc(100% + 6px);
		left: 0;
		z-index: 10;
		background: #fff;
		border: 1px solid #e2e8f0;
		border-radius: 12px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
		min-width: 260px;
		max-height: 400px;
		overflow-y: auto;
		padding: 0.4rem;
	}

	.item {
		display: grid;
		grid-template-columns: 1fr auto;
		grid-template-rows: auto auto;
		column-gap: 0.75rem;
		align-items: center;
		width: 100%;
		padding: 0.5rem 0.75rem;
		border: none;
		border-radius: 8px;
		background: none;
		cursor: pointer;
		text-align: left;
		transition: background 0.1s;
	}
	.item:hover { background: #f8fafc; }
	.item.selected { background: #eff6ff; }

	.item-name  { grid-row: 1; grid-column: 1; font-size: 0.85rem; font-weight: 600; color: #0f172a; }
	.item-type  { grid-row: 2; grid-column: 1; font-size: 0.72rem; color: #94a3b8; }
	.item-balance { grid-row: 1 / 3; grid-column: 2; font-size: 0.88rem; font-weight: 700; color: #1e293b; white-space: nowrap; }
</style>
