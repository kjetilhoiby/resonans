<script lang="ts">
	/**
	 * Deaktiver reservasjoner som er erstattet av en bokført rad — fase 3.
	 *
	 * **Eget kort, ikke en knapp i bankdiagnosen.** Diagnosen er ren lesing og trygg å trykke;
	 * denne SKRIVER. Å blande dem ville gjort «kjør diagnose» til noe man må tenke over, og en
	 * knapp man må tenke over blir ikke trykket.
	 *
	 * Rekkefølgen er tvunget: **tørrkjør først**, og skriveknappen finnes ikke før du har sett
	 * planen. Se `docs/changelog/2026-08-12-livslop-forsvinning.md`.
	 */
	import { Button, Select } from '$lib/components/ui';
	import { extractApiErrorMessage } from '$lib/client/api-error';

	type Result = {
		dryRun: boolean;
		window: { days: number; fromDate: string };
		rowsConsidered: number;
		reservations: number;
		pairs: { out: number; in: number };
		doubleCounted: { spend: number; income: number };
		unmatched: number;
		deactivated: number;
		samples: Array<{
			reservationId: string;
			bookedId: string;
			amount: number;
			direction: 'out' | 'in';
			deltaDays: number;
			merchantKeyChanged: boolean;
		}>;
	};

	let days = $state('90');
	let running = $state(false);
	let error = $state<string | null>(null);
	let result = $state<Result | null>(null);

	function nok(value: number): string {
		return `${Math.round(value).toLocaleString('nb-NO')} kr`;
	}

	const totalPairs = $derived(result ? result.pairs.out + result.pairs.in : 0);

	/** Skriveknappen vises bare etter en tørrkjøring som faktisk fant noe. */
	const canWrite = $derived(result !== null && result.dryRun && totalPairs > 0);

	async function run(dryRun: boolean) {
		running = true;
		error = null;
		try {
			const params = new URLSearchParams({ days, dryRun: String(dryRun) });
			const res = await fetch(`/api/admin/economics/deaktiver-reservasjoner?${params}`, {
				method: 'POST'
			});
			if (!res.ok) {
				// Meldingen VISES. Her er den vanligste feilen konkret — et vindu utenfor det
				// som er målt — og en generisk tekst ville skjult den.
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
	<h2>Rydd dobbelttalte reservasjoner</h2>
	<p class="meta">
		SB1 leverer samme kjøp først som reservasjon og så som bokført, og både datoen og
		beskrivelsen kan endre seg mellom versjonene. Da havner de i to rader og beløpet telles to
		ganger. Målt over 90 dager i august 2026: <strong>249 par, 152 982 kr</strong> — 27 % av
		nettoforbruket.
	</p>
	<p class="meta">
		Reservasjonen settes <strong>inaktiv, aldri slettet</strong>, så en feil kan reverseres.
		Bare aktive rader vurderes, så jobben kan kjøres om igjen uten å finne de samme parene.
	</p>

	<div class="controls">
		<Select bind:value={days} ariaLabel="Hvor langt tilbake" dataTrack="rydd-reservasjoner:vindu">
			<option value="90">90 dager (målt)</option>
			<option value="180">180 dager</option>
			<option value="365">365 dager</option>
		</Select>
		<Button variant="secondary" disabled={running} onClick={() => run(true)}>
			{running ? 'Jobber…' : 'Se hva som skjer'}
		</Button>
		{#if canWrite}
			<Button variant="warning" disabled={running} onClick={() => run(false)}>
				Deaktiver {totalPairs} rader
			</Button>
		{/if}
	</div>

	{#if error}
		<p class="err" role="alert">{error}</p>
	{/if}

	{#if result}
		<p class="summary" class:dry={result.dryRun}>
			{#if result.dryRun}
				<strong>Ingenting er skrevet.</strong> {result.pairs.out} forbrukspar
				({nok(result.doubleCounted.spend)}) og {result.pairs.in} inntektspar
				({nok(result.doubleCounted.income)}) ville blitt deaktivert.
			{:else}
				<strong>{result.deactivated} rader deaktivert.</strong>
				{nok(result.doubleCounted.spend)} ut av forbruket og
				{nok(result.doubleCounted.income)} ut av inntekten.
			{/if}
		</p>
		<p class="meta">
			{result.rowsConsidered.toLocaleString('nb-NO')} aktive rader vurdert i vinduet, hvorav
			{result.reservations.toLocaleString('nb-NO')} uten toppstatus.
			{result.unmatched.toLocaleString('nb-NO')} reservasjoner fant ingen ledig motpart og står
			urørt — de er enten ekte ubokførte, eller beløpet endret seg mellom versjonene.
		</p>

		{#if !result.dryRun && result.deactivated < totalPairs}
			<p class="warn">
				Færre rader ble deaktivert enn det var par ({result.deactivated} av
				{totalPairs}). Noen rader var alt inaktive da oppdateringen
				kjørte — typisk fordi jobben kjørte to ganger samtidig. Ikke et tap, men kjør
				tørrkjøringen igjen for å se hva som står.
			</p>
		{/if}

		{#if result.samples.length > 0}
			<h3>Største par</h3>
			<div class="table-scroll">
				<table>
					<thead>
						<tr>
							<th class="num">Beløp</th><th>Retning</th><th class="num">Dager</th>
							<th>Beskrivelse</th>
						</tr>
					</thead>
					<tbody>
						{#each result.samples as row (row.reservationId)}
							<tr>
								<td class="num">{nok(row.amount)}</td>
								<td>{row.direction === 'out' ? 'ut' : 'inn'}</td>
								<td class="num">{row.deltaDays}</td>
								<td>{row.merchantKeyChanged ? 'endret' : 'uendret'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="meta">
				De største først — det er dem en feilaktig parring ville kostet mest. Ser noe galt ut,
				ikke skriv: hvert par er matchet på eksakt beløp og konto innenfor ±3 dager, og en
				bokført rad kan bare absorbere én reservasjon.
			</p>
		{/if}

		<p class="meta footer">
			Vindu: {result.window.days} dager fra {result.window.fromDate}.
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
	.warn {
		margin: 0;
		font-size: 0.8rem;
		color: #fbbf24;
		line-height: 1.5;
	}
	.err {
		margin: 0;
		font-size: 0.82rem;
		color: #f87171;
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
	.footer {
		margin-top: 0.4rem;
		font-size: 0.76rem;
		opacity: 0.8;
	}
</style>
