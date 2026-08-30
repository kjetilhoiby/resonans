<script lang="ts">
	/**
	 * Rydd samme kjøp bokført to ganger.
	 *
	 * **Eget kort, ikke en fane på reservasjonsryddingen.** De to motorene har ulike vakter — den
	 * andre tåler ±3 dagers datodrift, denne krever samme dag — og et felles kort ville invitert til
	 * en felles terskel. Da blir to Ruter-billetter ett kjøp.
	 *
	 * Rekkefølgen er tvunget: tørrkjør først, og skriveknappen finnes ikke før planen er lest.
	 */
	import { Button, Select } from '$lib/components/ui';
	import { extractApiErrorMessage } from '$lib/client/api-error';

	type Confidence = 'high' | 'all';
	type Result = {
		dryRun: boolean;
		confidence: Confidence;
		window: { days: number; fromDate: string };
		rowsConsidered: number;
		pairsFound: number;
		selectedPairs: number;
		selectedNok: number;
		byPrefix: Array<{
			prefixKind: string;
			confidence: string;
			pairs: number;
			nok: number;
		}>;
		currencyConfirmed: number;
		deactivated: number;
		samples: Array<{
			amount: number;
			date: string;
			prefix: string;
			prefixKind: string;
			confidence: string;
			currencyConfirms: boolean;
			removes: string;
			keeps: string;
		}>;
	};

	const PREFIX_TEXT: Record<string, string> = {
		currency: 'Valutakode foran («USD OPENAI» mot «OPENAI»). Mekanisk — banken formaterer samme hendelse på to måter.',
		date: 'Kjøpsdato foran («02.07 SPORT 1 …»). Også mekanisk.',
		other: 'Noe annet foran, typisk et personnavn. Samme signatur, men ikke samme sikkerhet — «Marie Helene Nygaard is» mot «is» kan være to betalinger.'
	};

	let days = $state('90');
	let confidence = $state<Confidence>('high');
	let running = $state(false);
	let error = $state<string | null>(null);
	let result = $state<Result | null>(null);

	function nok(value: number): string {
		return `${Math.round(value).toLocaleString('nb-NO')} kr`;
	}

	const canWrite = $derived(result !== null && result.dryRun && result.selectedPairs > 0);

	async function run(dryRun: boolean) {
		running = true;
		error = null;
		try {
			const params = new URLSearchParams({ days, confidence, dryRun: String(dryRun) });
			const res = await fetch(
				`/api/admin/economics/deaktiver-bokforte-duplikater?${params}`,
				{ method: 'POST' }
			);
			if (!res.ok) {
				error = extractApiErrorMessage(res.status, await res.text());
				return;
			}
			result = (await res.json()) as Result;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Kunne ikke kjøre jobben';
		} finally {
			running = false;
		}
	}
</script>

<section class="card">
	<h2>Rydd dobbelt bokførte kjøp</h2>
	<p class="meta">
		Noen kjøp bokfører SB1 <strong>to ganger</strong> — én gang med et prefiks foran beskrivelsen
		(«USD OPENAI») og én gang uten («OPENAI»). Samme dag, samme øre, samme konto. Det er ikke to
		kjøp, men beløpet telles to ganger.
	</p>
	<p class="meta">
		Dette er en <strong>annen mekanisme</strong> enn reservasjon → bokføring, som kortet over
		rydder. Etter at den kjørte sto 54 duplikatpar igjen, og 52 av dem var av denne typen.
	</p>
	<p class="meta">
		<!--
			Kravene er strengere enn den andre motorens, og det er hele vernet mot å slette et
			ekte kjøp. Reglene står på flaten fordi en bruker som ikke kan se dem, ikke kan
			godkjenne planen.
		-->
		Kravene er strenge med vilje: <strong>samme dag</strong>, <strong>eksakt samme beløp</strong>,
		begge bokført, og beskrivelsene må være ULIKE. To rader med helt identisk beskrivelse røres
		aldri — to Ruter-billetter eller to butikkturer ser nøyaktig slik ut.
	</p>

	<div class="controls">
		<Select bind:value={days} ariaLabel="Hvor langt tilbake" dataTrack="rydd-bokforte:vindu">
			<option value="90">90 dager (målt)</option>
			<option value="180">180 dager</option>
			<option value="365">365 dager</option>
		</Select>
		<Select
			bind:value={confidence}
			ariaLabel="Hvor sikkert"
			dataTrack="rydd-bokforte:tillit"
		>
			<option value="high">Bare valuta og dato (anbefalt)</option>
			<option value="all">Ta med personnavn</option>
		</Select>
		<Button variant="secondary" disabled={running} onClick={() => run(true)}>
			{running ? 'Jobber…' : 'Se hva som skjer'}
		</Button>
		{#if canWrite}
			<Button variant="warning" disabled={running} onClick={() => run(false)}>
				Deaktiver {result?.selectedPairs} rader
			</Button>
		{/if}
	</div>

	{#if error}
		<p class="err" role="alert">{error}</p>
	{/if}

	{#if result}
		<p class="summary" class:dry={result.dryRun}>
			{#if result.dryRun}
				<strong>Ingenting er skrevet.</strong> {result.pairsFound} par funnet, og med valgt
				sikkerhet ville <strong>{result.selectedPairs}</strong> blitt deaktivert —
				{nok(result.selectedNok)} ut av forbruket.
			{:else}
				<strong>{result.deactivated} rader deaktivert.</strong>
				{nok(result.selectedNok)} ut av forbruket.
			{/if}
		</p>
		<p class="meta">
			{result.rowsConsidered.toLocaleString('nb-NO')} aktive rader vurdert.
			<!--
				Den uavhengige bekreftelsen. Står den på 0 mens valutaprefikser er funnet, er
				currency-kolonnen ikke fylt — og da hviler graderingen på ordlista alene.
			-->
			{result.currencyConfirmed} av parene har en <strong>utenlandsk valuta</strong> på selve
			raden, altså en bekreftelse fra et annet felt enn beskrivelsen.
		</p>

		{#if result.byPrefix.length > 0}
			<ul class="reasons">
				{#each result.byPrefix as row (`${row.prefixKind}-${row.confidence}`)}
					<li>
						<strong>{row.pairs} par · {nok(row.nok)}</strong> — {PREFIX_TEXT[row.prefixKind] ??
							row.prefixKind}
					</li>
				{/each}
			</ul>
		{/if}

		{#if result.samples.length > 0}
			<h3>Parene</h3>
			<div class="table-scroll">
				<table>
					<thead>
						<tr>
							<th class="num">Beløp</th><th>Dato</th><th>Fjernes</th><th>Beholdes</th>
							<th>Prefiks</th>
						</tr>
					</thead>
					<tbody>
						{#each result.samples as row, i (`${row.date}-${row.amount}-${row.prefix}-${i}`)}
							<tr class:dim={result.confidence === 'high' && row.confidence !== 'high'}>
								<td class="num">{nok(row.amount)}</td>
								<td>{row.date}</td>
								<td class="wrap">{row.removes || '—'}</td>
								<td class="wrap">{row.keeps || '—'}</td>
								<td
									>{row.prefix}<br /><span class="sub"
										>{row.prefixKind}{row.currencyConfirms ? ' ✓valuta' : ''}</span
									></td
								>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="meta">
				Raden <strong>med</strong> prefikset fjernes. Ikke arbitrært: «USD OPENAI» kategoriserer
				dårligere enn «OPENAI», fordi koden ikke er en del av butikknavnet. Nedtonede rader er
				utenfor valgt sikkerhet og blir ikke rørt.
			</p>
		{/if}

		<p class="meta footer">
			Vindu: {result.window.days} dager fra {result.window.fromDate}. Radene settes
			<strong>inaktive, aldri slettet</strong>.
		</p>
	{/if}
</section>

<style>
	.card {
		background: var(--card-bg-subtle, #141414);
		border: 1px solid var(--card-border, #242424);
		border-radius: var(--card-radius, 16px);
		padding: var(--card-padding, 16px);
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	h2 {
		font-size: 1.05rem;
		font-weight: 700;
		color: var(--text-primary, #eee);
		margin: 0;
	}
	h3 {
		margin: 0.5rem 0 0;
		font-size: 0.78rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-tertiary, #777);
	}
	.meta {
		margin: 0;
		font-size: 0.82rem;
		color: var(--text-secondary, #aaa);
		line-height: 1.5;
	}
	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}
	.summary {
		margin: 0;
		font-size: 0.85rem;
		color: var(--text-primary, #eee);
		line-height: 1.5;
	}
	.summary.dry {
		color: var(--text-secondary, #aaa);
	}
	.err {
		margin: 0;
		font-size: 0.82rem;
		color: #f87171;
		line-height: 1.5;
	}
	.reasons {
		margin: 0;
		padding-left: 1.1rem;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.82rem;
		color: var(--text-secondary, #aaa);
		line-height: 1.5;
	}
	.table-scroll {
		overflow-x: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8rem;
	}
	th {
		text-align: left;
		font-weight: 600;
		color: var(--text-tertiary, #777);
		padding: 0.3rem 0.5rem 0.3rem 0;
		white-space: nowrap;
	}
	td {
		padding: 0.3rem 0.5rem 0.3rem 0;
		color: var(--text-secondary, #aaa);
		border-top: 1px solid var(--card-border, #242424);
		white-space: nowrap;
	}
	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	/* Beskrivelsene skal kunne brytes — de er lange og skal leses, ikke skannes. */
	.wrap {
		white-space: normal;
		min-width: 8rem;
	}
	.sub {
		font-size: 0.72rem;
		opacity: 0.7;
	}
	.dim td,
	tr.dim td {
		opacity: 0.45;
	}
	.footer {
		margin-top: 0.4rem;
		font-size: 0.76rem;
		opacity: 0.8;
	}
</style>
