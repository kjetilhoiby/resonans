<script lang="ts">
	import SpendingChart from '$lib/components/charts/SpendingChart.svelte';

	type MonthData = {
		month: string;
		categories: { category: string; label: string; emoji: string; amount: number; count: number; isFixed: boolean }[];
		totalSpending: number;
		totalFixed: number;
		totalVariable: number;
		totalIncome: number;
	};

	interface Props {
		accountName: string;
		accountNumber: string | null;
		accountId: string;
		data: MonthData[];
		loading: boolean;
	}

	let { accountName, accountNumber, accountId, data, loading }: Props = $props();
</script>

<h2>Utgiftsanalyse – {accountName}</h2>
{#if accountNumber}
	<p class="account-number">{accountNumber}</p>
{/if}
{#if loading}
	<div class="loading">Analyserer transaksjoner...</div>
{:else}
	<SpendingChart {data} {accountId} />
{/if}

<style>
	h2 { margin: 0 0 0.25rem; font-size: 1.25rem; }

	.loading {
		padding: 3rem;
		text-align: center;
		color: var(--text-secondary);
	}

	.account-number {
		font-size: 0.82rem;
		color: var(--text-secondary);
		margin: 0 0 1.5rem;
	}

	@media (max-width: 760px) {
		h2 {
			font-size: 1.06rem;
		}
	}
</style>
