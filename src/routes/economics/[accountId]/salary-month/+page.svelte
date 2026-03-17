<script lang="ts">
	import { goto } from '$app/navigation';
	import SalaryMonth from '$lib/components/charts/SalaryMonth.svelte';
	import AccountPicker from '$lib/components/economics/AccountPicker.svelte';
	import EconomicsTabs from '$lib/components/economics/EconomicsTabs.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const paydaySourceAccount = $derived(
		data.paydaySourceAccountId && data.paydaySourceAccountId !== data.account.accountId
			? (data.accounts.find((a) => a.accountId === data.paydaySourceAccountId) ?? null)
			: null
	);
</script>

<svelte:head>
	<title>Lønnsmåned – {data.account.accountName ?? data.account.accountId} – Resonans</title>
</svelte:head>

<div class="container">
	<div class="header-top">
		<a href="/" class="back-button" aria-label="Tilbake">
			<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
				<path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
			</svg>
		</a>
		<h1>💰 Økonomi</h1>
	</div>

	<AccountPicker
		accounts={data.accounts}
		selectedAccountId={data.account.accountId}
		onSelect={(id) => goto(`/economics/${encodeURIComponent(id)}/salary-month`)}
	/>

	<EconomicsTabs accountId={data.account.accountId} activeTab="salary-month" />

	{#if paydaySourceAccount}
		<p class="payday-source">
			📅 Lønnsdato oppdaget fra <a href="/economics/{encodeURIComponent(paydaySourceAccount.accountId)}/salary-month">{paydaySourceAccount.accountName ?? paydaySourceAccount.accountId}</a> — periodeinndelingen gjelder for alle kontoer.
		</p>
	{/if}

	<div class="chart-card">
		<SalaryMonth
			periods={data.periods}
			medianCurve={data.medianCurve}
			detectedPaydayDom={data.detectedPaydayDom}
			accountName={data.account.accountName ?? data.account.accountId}
		/>
	</div>
</div>

<style>
	.container {
		max-width: 1100px;
		margin: 0 auto;
		padding: 2rem;
	}

	.header-top {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	.back-button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: 50%;
		background: var(--surface-color, #f1f5f9);
		border: 1px solid var(--border-color, #e2e8f0);
		color: var(--text-primary, #0f172a);
		text-decoration: none;
		flex-shrink: 0;
		transition: opacity 0.15s;
	}
	.back-button:hover { opacity: 0.75; }

	h1 { margin: 0; font-size: 2rem; }

	.chart-card {
		background: var(--surface-color, #fff);
		border-radius: 16px;
		border: 1px solid var(--border-color, #e2e8f0);
		padding: 1.5rem;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
	}

	.payday-source {
		font-size: 0.8rem;
		color: var(--text-secondary, #64748b);
		margin: -0.75rem 0 1rem;
	}
	.payday-source a {
		color: #2563eb;
		text-decoration: none;
		font-weight: 500;
	}
	.payday-source a:hover { text-decoration: underline; }
</style>
