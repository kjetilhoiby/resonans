<script lang="ts">
	import { AppPage, PageHeader } from '$lib/components/ui';
	import { goto } from '$app/navigation';
	import SalaryMonth from '$lib/components/charts/SalaryMonth.svelte';
	import AccountPicker from '$lib/components/economics/AccountPicker.svelte';
	import EconomicsTabs from '$lib/components/economics/EconomicsTabs.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const paydaySourceAccount = $derived(
		data.paydaySourceAccountId && data.paydaySourceAccountId !== data.account.accountId
			? (data.accounts.find((a: { accountId: string }) => a.accountId === data.paydaySourceAccountId) ?? null)
			: null
	);
</script>

<svelte:head>
	<title>Lønnsmåned – {data.account.accountName ?? data.account.accountId} – Resonans</title>
</svelte:head>

<AppPage width="full" theme="dark" className="economics-salary-month-page">
	<PageHeader title="💰 Økonomi" titleHref="/" titleLabel="Tilbake til forsiden" />

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
</AppPage>

<style>
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
