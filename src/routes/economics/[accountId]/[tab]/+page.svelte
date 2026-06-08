<script lang="ts">
	import { AppPage, Button, PageHeader, SectionCard } from '$lib/components/ui';
	import { goto } from '$app/navigation';
	import AccountPicker from '$lib/components/economics/AccountPicker.svelte';
	import EconomicsTabs from '$lib/components/economics/EconomicsTabs.svelte';
	import GoalRing from '$lib/components/ui/GoalRing.svelte';
	import MoneyFlow from '$lib/components/charts/MoneyFlow.svelte';
	import IrregularSpending from '$lib/components/IrregularSpending.svelte';
	import CumulativeSpending from '$lib/components/charts/CumulativeSpending.svelte';
	import BalanceTab from '$lib/components/domain/economics/BalanceTab.svelte';
	import SpendingTab from '$lib/components/domain/economics/SpendingTab.svelte';
	import InsightTab from '$lib/components/domain/economics/InsightTab.svelte';
	import TransactionsTab from '$lib/components/domain/economics/TransactionsTab.svelte';
	import { createEconomicsData, formatNOK } from '$lib/components/domain/economics/economics-data.svelte';
	import type { PageData } from './$types';

	let { data: pageData }: { data: PageData } = $props();

	const accountId = $derived(pageData.accountId);
	const activeTab = $derived(pageData.tab);

	function navigate(newAccountId: string, newTab: string) {
		goto(`/economics/${encodeURIComponent(newAccountId)}/${newTab}`, {
			replaceState: true,
			noScroll: true,
			keepFocus: true
		});
	}

	const econ = createEconomicsData();

	const selectedAccount = $derived(econ.accounts.find((a) => a.accountId === accountId) ?? null);

	let refreshing = $state(false);

	const summaryWidgets = $derived(() => {
		if (!selectedAccount) return [];
		const balance = selectedAccount.balance ?? 0;
		const available = selectedAccount.availableBalance ?? balance;
		const currency = selectedAccount.currency ?? 'NOK';
		const baseline = Math.max(Math.abs(balance), 1);
		const availabilityPct = Math.round(Math.max(0, Math.min(100, (available / baseline) * 100)));

		return [
			{ label: 'Saldo', value: formatNOK(balance, currency), pct: Math.min(100, Math.max(8, Math.round((Math.abs(balance) / 100000) * 100))), color: '#7c8ef5' },
			{ label: 'Disponibelt', value: formatNOK(available, currency), pct: availabilityPct, color: '#5fa0a0' },
			{ label: 'Likviditet', value: `${availabilityPct}%`, pct: availabilityPct, color: '#f0b429' }
		];
	});

	// Load accounts once on mount
	$effect(() => { econ.fetchAccounts(); });

	// Trigger data loading when accountId / tab change
	$effect(() => { econ.loadTabData(accountId, activeTab); });
</script>

<svelte:head>
	<title>Økonomi – Resonans</title>
</svelte:head>

<AppPage className="economics-tab-page">
	<PageHeader title="💰 Økonomi" titleHref="/" titleLabel="Tilbake til forsiden" />

	{#if econ.loadingAccounts}
		<div class="loading">Laster kontoer…</div>
	{:else if econ.accounts.length === 0}
		<div class="empty-state">
			<p>Ingen bankdata funnet.</p>
			<p>Gå til <a href="/settings">Innstillinger</a> for å koble til SpareBank 1.</p>
		</div>
	{:else}
		{#if selectedAccount}
			<div class="summary-widget-grid">
				{#each summaryWidgets() as widget}
					<div class="summary-widget">
						<GoalRing pct={widget.pct} color={widget.color} trackColor="#1a1a1a" size={82} strokeWidth={6}>
							<span class="summary-value">{widget.value}</span>
						</GoalRing>
						<p class="summary-label">{widget.label}</p>
					</div>
				{/each}
			</div>
		{/if}

		<AccountPicker
			accounts={econ.accounts}
			selectedAccountId={accountId}
			onSelect={(id) => navigate(id, activeTab)}
		/>

		<EconomicsTabs {accountId} activeTab={activeTab} />

		<div class="refresh-bar">
			{#if econ.lastUpdated}
				<span class="refresh-time">Lastet kl. {econ.lastUpdated.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })}</span>
			{:else}
				<span class="refresh-time">Synkroniseres automatisk fra SpareBank 1 daglig kl. 06:00</span>
			{/if}
			<Button
				variant="secondary"
				className="refresh-btn"
				onClick={() => { refreshing = true; econ.forceRefresh(); setTimeout(() => (refreshing = false), 1500); }}
				disabled={refreshing}
				ariaLabel="Oppdater nå"
			>
				<svg class="refresh-icon" class:spinning={refreshing} width="14" height="14" viewBox="0 0 14 14" fill="none">
					<path d="M12.5 2.5A6 6 0 1 1 7 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
					<path d="M7 1l2 2-2 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
				</svg>
				{refreshing ? 'Oppdaterer…' : 'Oppdater nå'}
			</Button>
		</div>

		<div class="analyze-bar">
			<Button variant="primary" className="analyze-btn" onClick={() => econ.runAnalysis(accountId, (tab) => navigate(accountId, tab))} disabled={econ.analyzing}>
				{#if econ.analyzing}
					<span class="spinner"></span> Analyserer transaksjoner…
				{:else}
					🤖 Analyser forbruk
				{/if}
			</Button>
			<span class="analyze-hint">Bruker AI til å lage din personlige kategoritaksonomi</span>
		</div>

		{#if econ.analysisError}
			<div class="analysis-error">⚠️ {econ.analysisError}</div>
		{/if}

		{#if econ.analysisResult}
			<SectionCard tone="subtle" className="analysis-result">
				<div class="analysis-header">
					<strong>✅ Analyse fullført</strong>
					<span class="analysis-stats">
						{econ.analysisResult.totalMerchantsAnalyzed} mottakere •
						{econ.analysisResult.newMappings} nye •
						{econ.analysisResult.updatedMappings} oppdatert •
						{econ.analysisResult.skippedRecent} nylig analysert
					</span>
					<Button variant="ghost" className="close-analysis" onClick={() => (econ.analysisResult = null)} ariaLabel="Lukk">✕</Button>
				</div>
				{#if econ.analysisResult.insights.length > 0}
					<ul class="insights">
						{#each econ.analysisResult.insights as insight}
							<li>{insight}</li>
						{/each}
					</ul>
				{/if}
				{#if econ.analysisResult.topMerchants.length > 0}
					<details class="top-merchants">
						<summary>Topp mottakere etter totalt beløp</summary>
						<table>
							<thead><tr><th>Mottaker</th><th>Kategori</th><th>Totalt</th></tr></thead>
							<tbody>
								{#each econ.analysisResult.topMerchants as m}
									<tr>
										<td>{m.label}</td>
										<td>{m.category}</td>
										<td class="amount">{formatNOK(m.totalAmount)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</details>
				{/if}
			</SectionCard>
		{/if}

		{#if selectedAccount}
			<div class="chart-card">
				{#if activeTab === 'saldo'}
					<BalanceTab
						accountName={selectedAccount.accountName ?? selectedAccount.accountId}
						accountNumber={selectedAccount.accountNumber ?? null}
						{accountId}
						currency={selectedAccount.currency ?? 'NOK'}
						balanceHistory={econ.balanceHistory}
						loading={econ.loadingHistory}
					/>

				{:else if activeTab === 'utgifter'}
					<SpendingTab
						accountName={selectedAccount.accountName ?? selectedAccount.accountId}
						accountNumber={selectedAccount.accountNumber ?? null}
						{accountId}
						data={econ.spendingData}
						loading={econ.loadingSpending}
					/>

				{:else if activeTab === 'pengestrom'}
					{#if econ.loadingTransfers}
						<div class="loading">Laster overføringer…</div>
					{:else}
						<MoneyFlow
							transfers={econ.transfersData}
							balanceHistory={econ.transferBalanceHistory}
							accountName={selectedAccount.accountName ?? selectedAccount.accountId}
						/>
					{/if}

				{:else if activeTab === 'variabelt'}
					<h2>Variabelt forbruk – {selectedAccount.accountName ?? selectedAccount.accountId}</h2>
					<p class="account-number">Transaksjoner over 500 kr – ikke-regelmessige mottakere</p>
					{#if econ.loadingIrregular}
						<div class="loading">Laster transaksjoner…</div>
					{:else}
						<IrregularSpending
							merchants={econ.irregularData}
							totalAmount={econ.irregularTotal}
							monthsInRange={econ.irregularMonths}
						/>
					{/if}

				{:else if activeTab === 'akkumulert'}
					{#if econ.loadingCumulative}
						<div class="loading">Laster akkumulert forbruk…</div>
					{:else}
						<div class="cumulative-grid">
							{#each econ.cumulativeData as catData}
								<CumulativeSpending
									category={catData.category}
									periods={catData.periods}
									detectedPaydayDom={catData.detectedPaydayDom}
								/>
							{/each}
						</div>
					{/if}

				{:else if activeTab === 'transaksjoner'}
					<TransactionsTab
						{accountId}
						accounts={econ.accounts}
						currency={selectedAccount.currency ?? 'NOK'}
					/>

				{:else}
					<InsightTab
						data={econ.merchantAnalysisData}
						loading={econ.loadingInsight}
					/>
				{/if}
			</div>
		{/if}
	{/if}
</AppPage>

<style>
	h2 { margin: 0 0 0.25rem; font-size: 1.25rem; }

	.loading {
		padding: 3rem;
		text-align: center;
		color: var(--text-secondary);
	}

	.empty-state {
		text-align: center;
		padding: 4rem 2rem;
		color: var(--text-secondary);
	}

	.summary-widget-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 10px;
		margin-bottom: 14px;
	}

	.summary-widget {
		background: #121212;
		border: 1px solid #252525;
		border-radius: 14px;
		padding: 12px 10px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
	}

	.summary-value {
		font-size: 0.66rem;
		font-weight: 700;
		color: #ebebeb;
		max-width: 54px;
		text-align: center;
		line-height: 1.2;
	}

	.summary-label {
		margin: 0;
		font-size: 0.82rem;
		color: #9e9e9e;
	}

	.chart-card {
		background: var(--surface-color);
		border: 1px solid var(--border-color);
		border-radius: 16px;
		padding: 1.5rem 2rem 2rem;
	}

	.account-number { font-size: 0.82rem; color: var(--text-secondary); margin: 0 0 1.5rem; }

	.refresh-bar {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1.25rem;
	}

	.refresh-time {
		font-size: 0.78rem;
		color: var(--text-secondary);
	}

	:global(.refresh-btn) {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.3rem 0.7rem;
		font-size: 0.78rem;
		font-weight: 500;
		color: var(--text-secondary);
		background: var(--surface-color);
		border: 1px solid var(--border-color);
		border-radius: 6px;
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
	}
	:global(.refresh-btn:hover:not(:disabled)) { color: var(--text-primary); border-color: #10b981; }
	:global(.refresh-btn:disabled) { opacity: 0.55; cursor: default; }

	@keyframes spin-refresh { to { transform: rotate(360deg); } }
	.refresh-icon { flex-shrink: 0; }
	.refresh-icon.spinning { animation: spin-refresh 0.7s linear infinite; }

	.analyze-bar {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1.25rem;
		flex-wrap: wrap;
	}

	:global(.analyze-btn) {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.55rem 1.1rem;
		background: linear-gradient(135deg, #4f46e5, #7c3aed);
		color: #fff;
		border: none;
		border-radius: 8px;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.15s;
		white-space: nowrap;
	}

	:global(.analyze-btn:disabled) { opacity: 0.6; cursor: not-allowed; }
	.analyze-hint { font-size: 0.8rem; color: var(--text-secondary); }

	@keyframes spin { to { transform: rotate(360deg); } }
	.spinner {
		display: inline-block;
		width: 14px;
		height: 14px;
		border: 2px solid rgba(255,255,255,0.4);
		border-top-color: #fff;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}

	.analysis-error {
		background: #fef2f2;
		border: 1px solid #fca5a5;
		border-radius: 10px;
		padding: 0.9rem 1.1rem;
		color: #b91c1c;
		margin-bottom: 1rem;
		font-size: 0.9rem;
	}

	:global(.analysis-result) {
		background: var(--surface-color);
		border: 1px solid var(--border-color);
		border-radius: 12px;
		padding: 1.25rem;
		margin-bottom: 1.5rem;
	}

	.analysis-header {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 0.75rem;
	}

	.analysis-stats { font-size: 0.82rem; color: var(--text-secondary); flex: 1; }

	:global(.close-analysis) {
		background: none;
		border: none;
		color: var(--text-secondary);
		cursor: pointer;
		font-size: 1rem;
		padding: 0.1rem 0.3rem;
		margin-left: auto;
	}

	.insights {
		list-style: none;
		padding: 0;
		margin: 0 0 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}

	.insights li {
		font-size: 0.92rem;
		line-height: 1.45;
		padding: 0.4rem 0.6rem;
		background: rgba(79, 70, 229, 0.05);
		border-radius: 6px;
	}

	.top-merchants summary {
		cursor: pointer;
		font-size: 0.88rem;
		font-weight: 600;
		color: var(--text-secondary);
		margin-bottom: 0.6rem;
		user-select: none;
	}

	.top-merchants table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.85rem;
	}

	.top-merchants th, .top-merchants td {
		padding: 0.35rem 0.5rem;
		text-align: left;
		border-bottom: 1px solid var(--border-color);
	}

	.top-merchants .amount { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }

	.cumulative-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1.5rem;
	}

	@media (min-width: 1200px) {
		.cumulative-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	@media (max-width: 760px) {
		h2 {
			font-size: 1.06rem;
		}

		.summary-widget-grid {
			grid-template-columns: 1fr;
		}

		.chart-card {
			padding: 1rem;
		}

		.refresh-bar {
			flex-wrap: wrap;
		}
	}
</style>
