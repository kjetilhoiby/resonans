<script lang="ts">
	import { onMount } from 'svelte';
	import CompactRecordList from '../ui/CompactRecordList.svelte';
	import GoalRing from '../ui/GoalRing.svelte';
	import Section from '../ui/Section.svelte';
	import TransactionList from '../ui/TransactionList.svelte';
	import TransactionExplorer from '../ui/TransactionExplorer.svelte';
	import type { GoalTrack } from '$lib/domain/goal-tracks';

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

	interface TxItem {
		date: string;
		description: string;
		amount: number;
		category: string;
		emoji: string;
		label: string;
	}

	interface PaydaySpend {
		paydayDate: string | null;
		daysSincePayday: number;
		totalSpend: number;
		spendPerDay: number;
		grocerySpend: number;
		grocerySpendPerDay: number;
		prevSpendPerDay: number | null;
		prevGrocerySpendPerDay: number | null;
		transactions: TxItem[];
		groceryTransactions: TxItem[];
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
		paydaySpend: PaydaySpend;
		embedded?: boolean;
	}

	let {
		accounts,
		totalBalance,
		currentMonth,
		monthSpending,
		recentTransactions,
		paydaySpend,
		embedded = false
	}: Props = $props();

	// Transaction overlay state
	let txOverlay = $state<null | 'all' | 'grocery'>(null);
	let showExplorer = $state(false);

	let groceryGoalInput = $state('9000');
	let groceryGoalSaving = $state(false);
	let groceryGoalError = $state('');

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

	// Payday ring logic
	// Ring fill = current per-day vs prev month per-day (50% = same, <50% = spending less, >50% = more)
	function paydayRingPct(current: number, prev: number | null): number {
		if (!prev || prev === 0) return 50;
		const ratio = current / prev; // 1.0 = same
		// Map 0.5×..2×  → 0..100 pct, with 1.0 → 50
		return Math.min(100, Math.max(4, Math.round(ratio * 50)));
	}

	function paydayRingColor(current: number, prev: number | null): string {
		if (!prev || prev === 0) return '#7c8ef5';
		const ratio = current / prev;
		if (ratio <= 0.95) return '#82c882'; // spending less — green
		if (ratio <= 1.1) return '#f0b429';  // roughly same — yellow
		return '#e07070';                    // spending more — red
	}

	const totalRingPct = $derived(paydayRingPct(paydaySpend.spendPerDay, paydaySpend.prevSpendPerDay));
	const totalRingColor = $derived(paydayRingColor(paydaySpend.spendPerDay, paydaySpend.prevSpendPerDay));
	const groceryRingPct = $derived(paydayRingPct(paydaySpend.grocerySpendPerDay, paydaySpend.prevGrocerySpendPerDay));
	const groceryRingColor = $derived(paydayRingColor(paydaySpend.grocerySpendPerDay, paydaySpend.prevGrocerySpendPerDay));

	function formatPerDay(kr: number): string {
		return `${new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 0 }).format(kr)} kr/dag`;
	}

	function formatPaydayDate(iso: string | null): string {
		if (!iso) return 'ukjent dato';
		return new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short' }).format(new Date(iso));
	}

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

	const groceryCategory = $derived(
		monthSpending.categories.find((c) => c.category === 'dagligvarer') ?? null
	);
	const grocerySpentSoFar = $derived(groceryCategory?.amount ?? 0);
	const groceryGoalMonthly = $derived(
		Number.isFinite(Number.parseFloat(groceryGoalInput.replace(',', '.')))
			? Number.parseFloat(groceryGoalInput.replace(',', '.'))
			: 0
	);

	const monthProgress = $derived((() => {
		const [yearStr, monthStr] = currentMonth.split('-');
		const year = Number.parseInt(yearStr, 10);
		const month = Number.parseInt(monthStr, 10);
		const now = new Date();
		const isCurrentMonth = now.getFullYear() === year && now.getMonth() + 1 === month;
		const monthDays = new Date(year, month, 0).getDate();
		const elapsedDays = isCurrentMonth ? Math.min(monthDays, now.getDate()) : monthDays;
		const remainingDays = Math.max(0, monthDays - elapsedDays);
		const pacePerDay = elapsedDays > 0 ? grocerySpentSoFar / elapsedDays : 0;
		const projected = pacePerDay * monthDays;
		const remainingBudget = Math.max(0, groceryGoalMonthly - grocerySpentSoFar);
		const allowedPerDay = remainingDays > 0 ? remainingBudget / remainingDays : 0;
		return { monthDays, elapsedDays, remainingDays, pacePerDay, projected, allowedPerDay };
	})());

	const groceryGoalPct = $derived(
		groceryGoalMonthly > 0
			? Math.max(0, Math.min(100, Math.round((grocerySpentSoFar / groceryGoalMonthly) * 100)))
			: 0
	);
	const groceryGoalColor = $derived(
		groceryGoalMonthly <= 0
			? '#7c8ef5'
			: monthProgress.projected <= groceryGoalMonthly
				? '#82c882'
				: monthProgress.projected <= groceryGoalMonthly * 1.1
					? '#f0b429'
					: '#e07070'
	);

	onMount(() => {
		void loadGroceryGoal();
	});

	async function loadGroceryGoal() {
		try {
			const res = await fetch('/api/goal-tracks/grocery_spend');
			if (!res.ok) return;
			const data = (await res.json()) as { tracks?: GoalTrack[] };
			const track = (data.tracks ?? []).find((t) => t.id === 'grocery-month' || t.window === 'month');
			if (track?.targetValue) groceryGoalInput = String(track.targetValue);
		} catch {
			// stille feil
		}
	}

	async function saveGroceryGoal() {
		const parsed = Number.parseFloat(groceryGoalInput.replace(',', '.'));
		if (!Number.isFinite(parsed) || parsed <= 0) {
			groceryGoalError = 'Skriv et gyldig månedsmål over 0 kr.';
			return;
		}
		groceryGoalSaving = true;
		groceryGoalError = '';
		try {
			const tracks: GoalTrack[] = [
				{
					id: 'grocery-month',
					metricId: 'grocery_spend',
					label: 'Dagligvarer per måned',
					kind: 'level',
					window: 'month',
					targetValue: parsed,
					unit: 'kr',
					priority: 100
				}
			];
			const res = await fetch('/api/goal-tracks/grocery_spend', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ tracks })
			});
			if (!res.ok) throw new Error('save_failed');
			groceryGoalInput = parsed.toString();
		} catch {
			groceryGoalError = 'Klarte ikke lagre dagligvaremål akkurat nå.';
		} finally {
			groceryGoalSaving = false;
		}
	}
</script>

<div class:ed-embedded={embedded} class="economics-dashboard">
	{#if !embedded}
		<div class="ed-header">
			<h1 class="ed-title">Økonomi</h1>
			<p class="ed-copy">Saldo, forbruk og kategorier — samlet i ett bilde.</p>
		</div>
	{/if}

	<!-- Payday spend widgets -->
	<div class="ed-grid">
		<!-- Widget 1: Total forbruk per dag siden lønn -->
		<button class="ed-card ed-card-btn" type="button" onclick={() => (txOverlay = 'all')}>
			<div class="ed-card-ring">
				<GoalRing pct={totalRingPct} color={totalRingColor} size={88} strokeWidth={6}>
					{#snippet children()}
						<text x="44" y="38" text-anchor="middle" fill={totalRingColor} font-size="9" font-weight="700">
							{new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 0 }).format(paydaySpend.spendPerDay)}
						</text>
						<text x="44" y="50" text-anchor="middle" fill={totalRingColor} font-size="7.5" opacity="0.8">kr/dag</text>
					{/snippet}
				</GoalRing>
			</div>
			<div class="ed-card-copy">
				<p class="ed-card-label">Forbruk / dag</p>
				<p class="ed-card-sub">siden lønn {formatPaydayDate(paydaySpend.paydayDate)}</p>
				{#if paydaySpend.prevSpendPerDay}
					<p class="ed-card-compare" style:color={totalRingColor}>
						{paydaySpend.spendPerDay <= paydaySpend.prevSpendPerDay ? '↓' : '↑'}
						{formatPerDay(paydaySpend.prevSpendPerDay)} forrige
					</p>
				{/if}
			</div>
		</button>

		<!-- Widget 2: Dagligvare per dag siden lønn -->
		<button class="ed-card ed-card-btn" type="button" onclick={() => (txOverlay = 'grocery')}>
			<div class="ed-card-ring">
				<GoalRing pct={groceryRingPct} color={groceryRingColor} size={88} strokeWidth={6}>
					{#snippet children()}
						<text x="44" y="38" text-anchor="middle" fill={groceryRingColor} font-size="9" font-weight="700">
							{new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 0 }).format(paydaySpend.grocerySpendPerDay)}
						</text>
						<text x="44" y="50" text-anchor="middle" fill={groceryRingColor} font-size="7.5" opacity="0.8">kr/dag</text>
					{/snippet}
				</GoalRing>
			</div>
			<div class="ed-card-copy">
				<p class="ed-card-label">Dagligvare / dag</p>
				<p class="ed-card-sub">siden lønn {formatPaydayDate(paydaySpend.paydayDate)}</p>
				{#if paydaySpend.prevGrocerySpendPerDay}
					<p class="ed-card-compare" style:color={groceryRingColor}>
						{paydaySpend.grocerySpendPerDay <= paydaySpend.prevGrocerySpendPerDay ? '↓' : '↑'}
						{formatPerDay(paydaySpend.prevGrocerySpendPerDay)} forrige
					</p>
				{/if}
			</div>
		</button>
	</div>

	<!-- Spending by category -->
	{#if topCategories.length > 0}
		<Section title="Fordeling {formatMonthLabel(currentMonth)}" meta={`${topCategories.length} kategorier`}>
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
		</Section>
	{/if}

	<Section title="Dagligvarer: mål + pace" meta={formatMonthLabel(currentMonth)}>
		<div class="ed-goal-main">
			<div class="ed-goal-ring">
				<GoalRing pct={groceryGoalPct} color={groceryGoalColor} size={88} strokeWidth={6}>
					{#snippet children()}
						<text x="44" y="42" text-anchor="middle" fill={groceryGoalColor} font-size="12" font-weight="700">{Math.round(groceryGoalPct)}%</text>
					{/snippet}
				</GoalRing>
			</div>
			<div class="ed-goal-copy">
				<p>Mål: {formatNOK(groceryGoalMonthly || 0)} / mnd</p>
				<p>Brukt: {formatNOK(grocerySpentSoFar)}</p>
				<p>Pace: {formatNOK(monthProgress.pacePerDay)} / dag</p>
				<p>Tillatt: {formatNOK(monthProgress.allowedPerDay)} / dag</p>
				<p>Projeksjon: {formatNOK(monthProgress.projected)}</p>
			</div>
		</div>
		<div class="ed-goal-controls">
			<input class="ed-goal-input" type="number" min="1" step="100" bind:value={groceryGoalInput} />
			<button class="ed-goal-save" type="button" onclick={saveGroceryGoal} disabled={groceryGoalSaving}>
				{groceryGoalSaving ? 'Lagrer…' : 'Lagre mål'}
			</button>
		</div>
		{#if groceryGoalError}
			<p class="ed-goal-error">{groceryGoalError}</p>
		{/if}
	</Section>

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

	{#if accounts.length > 0}
		<button class="ed-explore-btn" type="button" onclick={() => (showExplorer = true)}>
			<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<circle cx="11" cy="11" r="8"></circle>
				<line x1="21" y1="21" x2="16.65" y2="16.65"></line>
			</svg>
			Utforsk alle transaksjoner
		</button>
	{/if}

	{#if accounts.length === 0}
		<div class="ed-empty">
			<p>Ingen økonomidata tilgjengelig ennå.</p>
			<p class="ed-empty-sub">Koble til SpareBank1 under Innstillinger for å se saldo og transaksjoner her.</p>
		</div>
	{/if}
</div>

<!-- Transaction explorer overlay -->
{#if showExplorer}
	<TransactionExplorer onclose={() => (showExplorer = false)} />
{/if}

<!-- Transaction list overlay -->
{#if txOverlay === 'all'}
	<TransactionList
		transactions={paydaySpend.transactions}
		title="Forbruk siden lønn"
		onclose={() => (txOverlay = null)}
	/>
{:else if txOverlay === 'grocery'}
	<TransactionList
		transactions={paydaySpend.groceryTransactions}
		title="Dagligvarer siden lønn"
		onclose={() => (txOverlay = null)}
	/>
{/if}

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

	.ed-explore-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		width: 100%;
		padding: 12px 16px;
		background: #141414;
		border: 1px solid #2a2a2a;
		border-radius: 14px;
		color: #888;
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
		transition: border-color 0.15s, color 0.15s, background 0.15s;
	}

	.ed-explore-btn:active {
		background: #1a1a2a;
		border-color: #3a4a85;
		color: #a8b4f8;
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

	.ed-card-btn {
		cursor: pointer;
		appearance: none;
		-webkit-appearance: none;
		transition: border-color 0.15s;
	}

	.ed-card-btn:active {
		border-color: #3a4a85;
		background: #181820;
	}

	.ed-card-compare {
		margin: 0;
		font-size: 0.7rem;
		opacity: 0.85;
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

	.ed-goal-main {
		display: grid;
		grid-template-columns: 88px 1fr;
		gap: 12px;
		align-items: center;
	}

	.ed-goal-copy p {
		margin: 0;
		font-size: 0.78rem;
		color: #aaa;
		line-height: 1.5;
	}

	.ed-goal-controls {
		display: flex;
		gap: 8px;
		align-items: center;
	}

	.ed-goal-input {
		width: 130px;
		background: #101010;
		border: 1px solid #2c2c2c;
		border-radius: 10px;
		padding: 8px 10px;
		color: #ddd;
		font: inherit;
		font-size: 0.84rem;
	}

	.ed-goal-input:focus {
		outline: none;
		border-color: #3c4f9f;
	}

	.ed-goal-save {
		background: #293560;
		color: #d5defe;
		border: 1px solid #3a4a85;
		border-radius: 10px;
		padding: 8px 12px;
		font: inherit;
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
	}

	.ed-goal-save:disabled {
		opacity: 0.55;
		cursor: default;
	}

	.ed-goal-error {
		margin: 0;
		font-size: 0.76rem;
		color: #e07070;
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
