<script lang="ts">
	import CompactRecordList from './CompactRecordList.svelte';
	import GoalRing from './GoalRing.svelte';

	interface EconomicsAccount {
		accountId: string;
		accountName: string | null;
		accountType: string | null;
		balance: number;
		currency: string | null;
	}

	interface CategoryRow {
		category: string;
		label: string;
		emoji: string;
		amount: number;
		count: number;
		isFixed: boolean;
	}

	interface RecentTx {
		date: string;
		description: string;
		amount: number;
		emoji: string;
		label: string;
	}

	interface Props {
		accounts: EconomicsAccount[];
		totalBalance: number;
		currentMonth: string;
		monthSpending: {
			totalSpending: number;
			totalFixed: number;
			totalVariable: number;
			totalIncome: number;
			categories: CategoryRow[];
		};
		recentTransactions: RecentTx[];
		embedded?: boolean;
	}

	let {
		accounts,
		totalBalance,
		currentMonth,
		monthSpending,
		recentTransactions,
		embedded = false
	}: Props = $props();

	function formatNOK(amount: number): string {
		return new Intl.NumberFormat('nb-NO', {
			style: 'currency',
			currency: 'NOK',
			maximumFractionDigits: 0
		}).format(amount);
	}

	function formatDate(iso: string): string {
		return new Intl.DateTimeFormat('nb-NO', {
			day: '2-digit',
			month: '2-digit'
		}).format(new Date(iso));
	}

	function formatMonthLabel(ym: string): string {
		const [year, month] = ym.split('-');
		const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Des'];
		return `${monthNames[parseInt(month) - 1] ?? month} ${year}`;
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

	const totalSpending = $derived(monthSpending.totalSpending);
	const totalFixed = $derived(monthSpending.totalFixed);
	const totalVariable = $derived(monthSpending.totalVariable);

	// Ring pct: spending as fraction of income (capped to 100)
	const spendPct = $derived(
		monthSpending.totalIncome > 0
			? Math.min(100, Math.round((totalSpending / monthSpending.totalIncome) * 100))
			: Math.min(100, Math.round((totalSpending / Math.max(totalSpending, 1)) * 100))
	);
	const fixedPct = $derived(
		totalSpending > 0 ? Math.round((totalFixed / totalSpending) * 100) : 0
	);
	const variablePct = $derived(100 - fixedPct);

	const summaryCards = $derived([
		{
			label: 'Total saldo',
			value: formatNOK(totalBalance),
			subvalue: `${accounts.length} konto${accounts.length === 1 ? '' : 'er'}`,
			color: '#7c8ef5',
			pct: Math.min(100, Math.max(8, Math.round((Math.abs(totalBalance) / 500000) * 100)))
		},
		{
			label: formatMonthLabel(currentMonth),
			value: formatNOK(totalSpending),
			subvalue: 'brukt denne måneden',
			color: '#f0b429',
			pct: spendPct
		},
		{
			label: 'Fast',
			value: formatNOK(totalFixed),
			subvalue: `${fixedPct}% av forbruk`,
			color: '#e07070',
			pct: fixedPct
		},
		{
			label: 'Variabelt',
			value: formatNOK(totalVariable),
			subvalue: `${variablePct}% av forbruk`,
			color: '#5fa0a0',
			pct: variablePct
		}
	]);

	const accountItems = $derived(
		accounts.map((a) => ({
			id: a.accountId,
			title: a.accountName ?? a.accountId,
			subtitle: accountTypeLabel(a.accountType),
			amount: formatNOK(a.balance),
			amountTone: (a.balance >= 0 ? 'positive' : 'negative') as 'positive' | 'negative'
		}))
	);

	const txItems = $derived(
		recentTransactions.map((tx, i) => ({
			id: `tx-${i}`,
			title: tx.description.length > 32 ? `${tx.description.slice(0, 30)}…` : tx.description,
			subtitle: `${tx.emoji} ${tx.label}`,
			meta: formatDate(tx.date),
			amount: formatNOK(tx.amount),
			amountTone: (tx.amount < 0 ? 'negative' : 'positive') as 'positive' | 'negative'
		}))
	);

	// Top categories — max 6
	const topCategories = $derived(monthSpending.categories.slice(0, 6));
	const maxCategoryAmount = $derived(
		topCategories.length ? Math.max(...topCategories.map((c) => c.amount)) : 1
	);
</script>

<div class:ed-embedded={embedded} class="economics-dashboard">
	{#if !embedded}
		<div class="ed-header">
			<h1 class="ed-title">Økonomi</h1>
			<p class="ed-copy">Saldo, forbruk og kategorier — samlet i ett bilde.</p>
		</div>
	{/if}

	<!-- Summary cards -->
	<div class="ed-grid">
		{#each summaryCards as card}
			<div class="ed-card">
				<div class="ed-card-ring">
					<GoalRing pct={card.pct} color={card.color} size={88} strokeWidth={6}>
						{#snippet children()}
							<text x="44" y="40" text-anchor="middle" fill={card.color} font-size="10" font-weight="700">{card.value.replace(/\s*kr/i, '')}</text>
							<text x="44" y="52" text-anchor="middle" fill={card.color} font-size="8" opacity="0.7">kr</text>
						{/snippet}
					</GoalRing>
				</div>
				<div class="ed-card-copy">
					<p class="ed-card-label">{card.label}</p>
					<p class="ed-card-sub">{card.subvalue}</p>
				</div>
			</div>
		{/each}
	</div>

	<!-- Spending by category -->
	{#if topCategories.length > 0}
		<div class="ed-category-card">
			<header class="ed-section-head">
				<h3 class="ed-section-title">Fordeling {formatMonthLabel(currentMonth)}</h3>
				<span class="ed-section-meta">{topCategories.length} kategorier</span>
			</header>
			<ul class="ed-cat-list">
				{#each topCategories as cat}
					{@const barPct = Math.max(4, Math.round((cat.amount / maxCategoryAmount) * 100))}
					<li class="ed-cat-row">
						<span class="ed-cat-emoji">{cat.emoji}</span>
						<span class="ed-cat-label">{cat.label}</span>
						<div class="ed-cat-bar-wrap">
							<div class="ed-cat-bar" style:width="{barPct}%" class:is-fixed={cat.isFixed}></div>
						</div>
						<span class="ed-cat-amount">{formatNOK(cat.amount)}</span>
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	<!-- Accounts + recent transactions -->
	<div class="ed-list-grid">
		<CompactRecordList
			title="Kontoer"
			items={accountItems}
			emptyText="Ingen kontoer funnet. Koble til SpareBank1 for å se saldo."
		/>
		<CompactRecordList
			title="Siste transaksjoner"
			items={txItems}
			emptyText="Ingen transaksjoner denne måneden ennå."
		/>
	</div>

	{#if accounts.length === 0}
		<div class="ed-empty">
			<p>Ingen økonomidata tilgjengelig ennå.</p>
			<p class="ed-empty-sub">Koble til SpareBank1 under Innstillinger for å se saldo og transaksjoner her.</p>
		</div>
	{/if}
</div>

<style>
	.economics-dashboard {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}

	.ed-embedded {
		padding-top: 4px;
	}

	.ed-header {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.ed-title {
		margin: 0;
		font-size: 1.5rem;
		font-weight: 700;
		letter-spacing: -0.03em;
		color: #eee;
	}

	.ed-copy,
	.ed-empty-sub {
		margin: 0;
		font-size: 0.82rem;
		line-height: 1.5;
		color: #777;
	}

	.ed-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(155px, 1fr));
		gap: 12px;
	}

	.ed-card {
		background: #141414;
		border: 1px solid #232323;
		border-radius: 18px;
		padding: 14px 12px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		text-align: center;
	}

	.ed-card-ring {
		flex-shrink: 0;
	}

	.ed-card-copy {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.ed-card-label {
		margin: 0;
		font-size: 0.78rem;
		font-weight: 600;
		color: #bbb;
		letter-spacing: 0.02em;
		text-transform: uppercase;
	}

	.ed-card-sub {
		margin: 0;
		font-size: 0.75rem;
		color: #666;
	}

	/* Category card */
	.ed-category-card {
		background: #141414;
		border: 1px solid #232323;
		border-radius: 18px;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.ed-section-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.ed-section-title {
		margin: 0;
		font-size: 0.88rem;
		font-weight: 600;
		color: #ccc;
	}

	.ed-section-meta {
		font-size: 0.75rem;
		color: #555;
	}

	.ed-cat-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.ed-cat-row {
		display: grid;
		grid-template-columns: 1.4rem 1fr 2fr auto;
		align-items: center;
		gap: 8px;
	}

	.ed-cat-emoji {
		font-size: 1rem;
		text-align: center;
	}

	.ed-cat-label {
		font-size: 0.8rem;
		color: #ccc;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.ed-cat-bar-wrap {
		height: 6px;
		background: #222;
		border-radius: 3px;
		overflow: hidden;
	}

	.ed-cat-bar {
		height: 100%;
		background: #f0b429;
		border-radius: 3px;
		transition: width 0.4s ease;
	}

	.ed-cat-bar.is-fixed {
		background: #e07070;
	}

	.ed-cat-amount {
		font-size: 0.78rem;
		color: #999;
		text-align: right;
		white-space: nowrap;
	}

	/* List grid */
	.ed-list-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}

	@media (max-width: 560px) {
		.ed-list-grid {
			grid-template-columns: 1fr;
		}
	}

	.ed-empty {
		background: #141414;
		border: 1px solid #232323;
		border-radius: 18px;
		padding: 28px 20px;
		text-align: center;
		color: #aaa;
	}
</style>
