<script lang="ts">
	import PeriodPills from '$lib/components/ui/PeriodPills.svelte';
	import BalanceChart from '$lib/components/charts/BalanceChart.svelte';

	type BalanceInterval = '2025' | '12m' | '24m' | 'all';

	interface Props {
		accountName: string;
		accountNumber: string | null;
		accountId: string;
		currency: string;
		balanceHistory: { date: string; balance: number; innskudd: number; uttak: number }[];
		loading: boolean;
	}

	let { accountName, accountNumber, accountId, currency, balanceHistory, loading }: Props = $props();

	let balanceInterval = $state<BalanceInterval>('all');

	function getIntervalFromDate(interval: BalanceInterval): string | null {
		if (interval === 'all') return null;
		const now = new Date();
		if (interval === '2025') return '2025-01-01';
		if (interval === '12m') {
			const d = new Date(now);
			d.setMonth(d.getMonth() - 12);
			return d.toISOString().split('T')[0];
		}
		if (interval === '24m') {
			const d = new Date(now);
			d.setMonth(d.getMonth() - 24);
			return d.toISOString().split('T')[0];
		}
		return null;
	}

	const filteredBalanceHistory = $derived(() => {
		const fromDate = getIntervalFromDate(balanceInterval);
		if (!fromDate) return balanceHistory;
		return balanceHistory.filter((d) => d.date >= fromDate);
	});
</script>

<div class="chart-header">
	<div class="chart-title-group">
		<h2>Saldoutvikling – {accountName}</h2>
		{#if accountNumber}
			<p class="account-number">{accountNumber}</p>
		{/if}
	</div>
	<PeriodPills
		options={['2025', '12m', '24m', 'Alt']}
		value={balanceInterval === 'all' ? 'Alt' : balanceInterval}
		onchange={(value) => {
			balanceInterval = value === 'Alt' ? 'all' : (value as BalanceInterval);
		}}
	/>
</div>
{#if loading}
	<div class="loading">Beregner saldohistorikk...</div>
{:else}
	<BalanceChart data={filteredBalanceHistory()} {currency} {accountId} />
{/if}

<style>
	h2 { margin: 0 0 0.25rem; font-size: 1.25rem; }

	.loading {
		padding: 3rem;
		text-align: center;
		color: var(--text-secondary);
	}

	.chart-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 1.5rem;
		gap: 1rem;
	}

	.chart-title-group {
		flex: 1;
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
