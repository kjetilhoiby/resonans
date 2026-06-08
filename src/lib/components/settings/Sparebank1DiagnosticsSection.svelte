<!--
  Sparebank1DiagnosticsSection — Database diagnostics for SpareBank 1 salary detection.
  Shows account summaries and big inflow scoring details.
-->
<script lang="ts">
	import { Button } from '$lib/components/ui';

	type DiagAccountRow = { accountId: string; txCount: number; incomeCount: number; minDate: string; maxDate: string };
	type DiagInflowRow = {
		id: string; accountId: string; date: string; amount: number;
		merchantKey: string | null; descriptionDisplay: string | null;
		paycheckType: string | null; latestBookingStatus: string | null;
		paycheckResult: string | null; score: number | null;
		scoreComponents: {
			fingerprintMatch: boolean; hasKeyword: boolean; inAmountRange: boolean;
			isWorkday: boolean; domOnTime: boolean; domCloseness: number;
			descNorm: string; profileFingerprint: string;
			profileAmountMin: number; profileAmountMax: number; profileTypicalDom: number;
		} | null;
	};
	type DiagData = { accountSummary: DiagAccountRow[]; bigInflows: DiagInflowRow[] };

	let loadingDiag = $state(false);
	let diagData = $state<DiagData | null>(null);

	async function loadDiagnostics() {
		loadingDiag = true;
		diagData = null;
		try {
			const res = await fetch('/api/admin/salary-profile/diagnostics');
			if (res.ok) diagData = await res.json();
		} finally {
			loadingDiag = false;
		}
	}
</script>

<div class="diag-section">
	<div class="row">
		<Button variant="ghost" onClick={loadDiagnostics} disabled={loadingDiag}>
			{loadingDiag ? 'Laster...' : 'Diagnostikk: vis hva som er i databasen'}
		</Button>
	</div>
	{#if diagData}
		<div class="diag-content">
			<p class="field-title">Konto-oversikt (canonical_bank_transactions)</p>
			<table class="debug-table">
				<thead><tr><th>Konto-ID</th><th>Totalt</th><th>Innskudd ≥10k</th><th>Tidligste</th><th>Siste</th></tr></thead>
				<tbody>
					{#each diagData.accountSummary as acc}
						<tr>
							<td class="mono">{acc.accountId}</td>
							<td>{acc.txCount}</td>
							<td>{acc.incomeCount}</td>
							<td>{acc.minDate ?? '–'}</td>
							<td>{acc.maxDate ?? '–'}</td>
						</tr>
					{/each}
				</tbody>
			</table>

			{#if diagData.bigInflows.length > 0}
				<p class="field-title" style="margin-top:0.75rem">Store innbetalinger (≥10k) — siste 36</p>
				<table class="debug-table diag-inflow-table">
					<thead>
						<tr>
							<th>Dato</th>
							<th>Konto</th>
							<th>Beløp</th>
							<th>Beskrivelse</th>
							<th>Nøkkel</th>
							<th>Norm</th>
							<th>FP-treff</th>
							<th>Beløp-treff</th>
							<th>Score</th>
							<th>Resultat</th>
						</tr>
					</thead>
					<tbody>
						{#each diagData.bigInflows as row}
							<tr class:diag-tagged={!!row.paycheckType} class:diag-mismatch={!row.paycheckResult && !row.paycheckType}>
								<td>{row.date}</td>
								<td class="mono" style="font-size:0.72rem">{row.accountId.slice(0,12)}…</td>
								<td>{row.amount.toLocaleString('nb-NO')} kr</td>
								<td>{row.descriptionDisplay ?? '–'}</td>
								<td class="mono">{row.merchantKey ?? '–'}</td>
								<td class="mono">{row.scoreComponents?.descNorm ?? '–'}</td>
								<td>{row.scoreComponents?.fingerprintMatch ? '✓' : '✗'}</td>
								<td>{row.scoreComponents?.inAmountRange ? '✓' : '✗'}</td>
								<td class:diag-score-ok={row.score !== null && row.score >= 80}>{row.score ?? '–'}</td>
								<td>{row.paycheckResult ?? row.paycheckType ?? '–'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{:else}
				<p class="meta">Ingen innbetalinger ≥ 10 000 kr funnet i canonical_bank_transactions.</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	.meta { color: var(--text-tertiary); font-size: 0.82rem; margin: 0.2rem 0 0.6rem; }
	.field-title { margin: 0 0 0.4rem; font-size: 0.84rem; font-weight: 500; color: var(--text-secondary); }
	.row { display: flex; gap: 0.6rem; flex-wrap: wrap; }
	.diag-section {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 0.75rem;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		background: var(--bg-primary);
	}
	.diag-content {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		overflow-x: auto;
	}
	.debug-table { width: 100%; border-collapse: collapse; font-size: 0.79rem; color: var(--text-secondary); }
	.debug-table th, .debug-table td { padding: 0.34rem 0.45rem; text-align: left; border-bottom: 1px solid var(--border-color); white-space: nowrap; }
	.debug-table th { color: var(--text-tertiary); font-weight: 500; }
	.diag-inflow-table { font-size: 0.78rem; min-width: 820px; }
	:global(tr.diag-tagged) td { color: #6ee76e; }
	:global(tr.diag-mismatch) td { color: var(--text-secondary); }
	td.diag-score-ok { color: #6ee76e; font-weight: 600; }
	td.mono { font-family: monospace; font-size: 0.78rem; }
</style>
