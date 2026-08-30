<script lang="ts">
	/**
	 * Sparekontoen som buffer.
	 *
	 * Rekkefølgen på flaten følger spørsmålet brukeren stilte: **går den ned** (bunnivået),
	 * **hvor lenge holder den** (dekning), og **når kniper det** (uttaksmønsteret). Se
	 * `docs/changelog/2026-08-11-okonomi-tillitsgjennomgang.md`, fase 5.
	 *
	 * Kortet sier hva som er målt og hva som er utledet: heuristikken bak «bufferkonto» er
	 * synlig, og «uendret» sier hvorfor. Et tall uten forbehold blir trodd mer enn det
	 * fortjener.
	 */
	import SectionCard from '$lib/components/ui/SectionCard.svelte';
	import CompactRecordList from '$lib/components/ui/CompactRecordList.svelte';
	import BufferFloorChart from '$lib/components/charts/BufferFloorChart.svelte';

	type Trend = {
		direction: 'eroderer' | 'stabil' | 'vokser' | 'ukjent';
		perPeriod: number | null;
		total: number | null;
		samples: number;
		reason: string;
	};
	type Trough = {
		periodStart: string;
		periodEnd: string;
		trough: number;
		troughDate: string;
		end: number;
	};
	type Withdrawals = {
		verdict: 'urørt' | 'støtdemper' | 'kassekreditt' | 'blandet' | 'ukjent';
		count: number;
		perPeriod: number;
		medianAmount: number | null;
		largestAmount: number | null;
		lateShare: number;
		reason: string;
	};
	type Account = {
		accountId: string;
		accountName: string | null;
		accountType: string | null;
		balance: number;
		runwayMonths: number | null;
		trend: Trend;
		troughs: Trough[];
		withdrawals: Withdrawals;
		withdrawalEvents: Array<{ date: string; amount: number; toAccountId: string }>;
		deposits: Array<{ date: string; amount: number; fromAccountId: string }>;
		series: Array<{ date: string; balance: number }>;
	};

	interface Props {
		accounts: Account[];
		totalBalance: number;
		totalRunwayMonths: number | null;
		monthlySpend: number | null;
		noSavingsAccountFound: boolean;
		unnamedAccountCount?: number;
		loading: boolean;
	}

	let {
		accounts,
		totalBalance,
		totalRunwayMonths,
		monthlySpend,
		noSavingsAccountFound,
		unnamedAccountCount = 0,
		loading
	}: Props = $props();

	function formatNOK(amount: number): string {
		return new Intl.NumberFormat('nb-NO', {
			style: 'currency',
			currency: 'NOK',
			maximumFractionDigits: 0
		}).format(amount);
	}
	function formatDate(key: string): string {
		return new Intl.DateTimeFormat('nb-NO', { day: '2-digit', month: 'short' }).format(
			new Date(`${key}T12:00:00Z`)
		);
	}
	function formatMonths(months: number): string {
		if (months >= 10) return `${Math.round(months)} mnd`;
		return `${months.toFixed(1).replace('.', ',')} mnd`;
	}

	/** Bare erosjon får varselfarge. En buffer som brukes er ikke et problem. */
	function trendTone(direction: Trend['direction']): 'warn' | 'good' | 'neutral' {
		if (direction === 'eroderer') return 'warn';
		if (direction === 'vokser') return 'good';
		return 'neutral';
	}
	function trendLabel(direction: Trend['direction']): string {
		if (direction === 'eroderer') return 'Bunnivået synker';
		if (direction === 'vokser') return 'Bunnivået stiger';
		if (direction === 'stabil') return 'Bunnivået er stabilt';
		return 'For lite historikk';
	}
	function verdictTone(verdict: Withdrawals['verdict']): 'warn' | 'good' | 'neutral' {
		if (verdict === 'kassekreditt') return 'warn';
		if (verdict === 'støtdemper' || verdict === 'urørt') return 'good';
		return 'neutral';
	}
	function verdictLabel(verdict: Withdrawals['verdict']): string {
		const map: Record<Withdrawals['verdict'], string> = {
			urørt: 'Ikke brukt',
			støtdemper: 'Støtdemper',
			kassekreditt: 'Kassekreditt',
			blandet: 'Blandet',
			ukjent: 'Ukjent'
		};
		return map[verdict];
	}
</script>

{#if loading}
	<div class="st-loading">Leser saldohistorikk…</div>
{:else if noSavingsAccountFound}
	<SectionCard>
		<h3>Ingen bufferkonto funnet</h3>
		<p class="st-note">
			Ingen av kontoene ser ut som en sparekonto ut fra navn og type. Det er ikke det samme
			som at bufferen er tom — vi finner den bare ikke. Kontonavn som inneholder «spar»,
			«buffer», «BSU» eller «reserve» blir regnet med.
		</p>
		{#if unnamedAccountCount > 0}
			<p class="st-note">
				{unnamedAccountCount}
				{unnamedAccountCount === 1 ? 'konto' : 'kontoer'} mangler navn og kunne ikke vurderes i
				det hele tatt. Saldoankre fra importerte kontoutskrifter bærer bare kontonummer, så
				en konto som bare finnes i importert historikk har ingenting å kjenne den igjen på.
			</p>
		{/if}
	</SectionCard>
{:else}
	<div class="st-head">
		<div class="st-total">
			<span class="st-total-label">Buffer</span>
			<strong>{formatNOK(totalBalance)}</strong>
		</div>
		{#if totalRunwayMonths !== null}
			<div class="st-runway">
				<span class="st-runway-value">{formatMonths(totalRunwayMonths)}</span>
				<span class="st-runway-label">dekning</span>
			</div>
		{/if}
	</div>

	{#if monthlySpend !== null}
		<p class="st-note">
			Dekning regnet mot {formatNOK(monthlySpend)}/mnd i forbruk siste tre måneder. Interne
			overføringer mellom egne kontoer er holdt utenfor — de er flytting, ikke forbruk.
		</p>
	{:else}
		<p class="st-note">
			Uten et forbrukstall kan ikke dekningen regnes, så den vises ikke framfor å gjettes.
		</p>
	{/if}

	{#each accounts as account (account.accountId)}
		<SectionCard>
			<div class="st-acc-head">
				<h3>{account.accountName ?? account.accountId}</h3>
				<strong>{formatNOK(account.balance)}</strong>
			</div>

			<div class="st-badges">
				<span class="st-badge {trendTone(account.trend.direction)}">
					{trendLabel(account.trend.direction)}
				</span>
				<span class="st-badge {verdictTone(account.withdrawals.verdict)}">
					{verdictLabel(account.withdrawals.verdict)}
				</span>
			</div>

			<p class="st-reason">{account.trend.reason}</p>

			{#if account.troughs.length > 0}
				<BufferFloorChart series={account.series} troughs={account.troughs} />
				<p class="st-note">
					Linja er saldoen, punktene er laveste saldo i hver lønnsperiode. <strong
						>Det er punktene som betyr noe</strong
					>: lønna kommer inn hver måned, så toppene kan se uendret ut mens gulvet synker.
				</p>
			{/if}

			<p class="st-reason">{account.withdrawals.reason}</p>

			{#if account.withdrawals.count > 0}
				<div class="st-stats">
					<div><span>Uttak per måned</span><strong>{account.withdrawals.perPeriod.toFixed(1).replace('.', ',')}</strong></div>
					{#if account.withdrawals.medianAmount !== null}
						<div><span>Typisk uttak</span><strong>{formatNOK(account.withdrawals.medianAmount)}</strong></div>
					{/if}
					{#if account.withdrawals.largestAmount !== null}
						<div><span>Største</span><strong>{formatNOK(account.withdrawals.largestAmount)}</strong></div>
					{/if}
					<div><span>Sent i måneden</span><strong>{Math.round(account.withdrawals.lateShare * 100)} %</strong></div>
				</div>

				<CompactRecordList
					title="Uttak"
					items={account.withdrawalEvents.slice(0, 8).map((w, i) => ({
						id: `w-${i}`,
						title: formatDate(w.date),
						amount: formatNOK(-w.amount),
						amountTone: 'negative' as const
					}))}
				/>
			{/if}
		</SectionCard>
	{/each}

	<p class="st-note st-foot">
		Kontoer regnes som buffer ut fra navn og type. Stemmer ikke lista, er det heuristikken
		som tar feil — ikke tallene.{#if unnamedAccountCount > 0}
			{' '}{unnamedAccountCount}
			{unnamedAccountCount === 1 ? 'konto' : 'kontoer'} mangler navn og er ikke vurdert.
		{/if}
	</p>
{/if}

<style>
	.st-loading {
		padding: 3rem;
		text-align: center;
		color: var(--text-secondary);
	}

	.st-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 0.35rem;
	}
	.st-total {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	.st-total-label {
		font-size: 0.78rem;
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.st-total strong {
		font-size: 1.6rem;
		font-variant-numeric: tabular-nums;
	}
	.st-runway {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.1rem;
	}
	.st-runway-value {
		font-size: 1.2rem;
		font-variant-numeric: tabular-nums;
	}
	.st-runway-label {
		font-size: 0.78rem;
		color: var(--text-secondary);
	}

	.st-note {
		font-size: 0.8rem;
		line-height: 1.45;
		color: var(--text-secondary);
		margin: 0.4rem 0 0.9rem;
	}
	.st-foot {
		margin-top: 1.25rem;
	}

	.st-acc-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}
	.st-acc-head h3 {
		margin: 0;
		font-size: 1.02rem;
	}
	.st-acc-head strong {
		font-variant-numeric: tabular-nums;
	}

	.st-badges {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin: 0.6rem 0 0.2rem;
	}
	.st-badge {
		font-size: 0.76rem;
		padding: 0.18rem 0.5rem;
		border-radius: 999px;
		border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.12));
		color: var(--text-secondary);
	}
	.st-badge.warn {
		color: #fca5a5;
		border-color: rgba(252, 165, 165, 0.35);
	}
	.st-badge.good {
		color: #86efac;
		border-color: rgba(134, 239, 172, 0.35);
	}

	.st-reason {
		font-size: 0.86rem;
		line-height: 1.5;
		margin: 0.5rem 0 0.9rem;
	}

	.st-stats {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
		gap: 0.6rem;
		margin: 0.6rem 0 1rem;
	}
	.st-stats div {
		display: flex;
		flex-direction: column;
		gap: 0.12rem;
	}
	.st-stats span {
		font-size: 0.74rem;
		color: var(--text-secondary);
	}
	.st-stats strong {
		font-variant-numeric: tabular-nums;
	}

	@media (max-width: 760px) {
		.st-total strong {
			font-size: 1.35rem;
		}
	}
</style>
