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

	type Direction = 'out' | 'in' | 'all';
	type SkipReason =
		| 'begge-bokfort'
		| 'ulikt-belop'
		| 'ukjent-status'
		| 'overforing'
		| 'skulle-blitt-fanget';
	type Result = {
		dryRun: boolean;
		direction: Direction;
		selectedPairs: number;
		window: { days: number; fromDate: string };
		rowsConsidered: number;
		reservations: number;
		skippedUnknownStatus: number;
		skippedInternalTransfers: number;
		skippedTransferText: number;
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
			reservationDate: string;
			bookedDate: string;
			reservationMerchantKey: string;
			bookedMerchantKey: string;
		}>;
		residual: {
			pairs: number;
			nok: number;
			byReason: Array<{ reason: SkipReason; pairs: number; nok: number }>;
			byStatusPair: Array<{ statusPair: string; pairs: number; nok: number }>;
			truncated: boolean;
			suspects: Array<{
				amount: number;
				amountDeltaPct: number;
				deltaDays: number;
				prefixDrift: boolean;
				sameDescription: boolean;
				statusPair: string;
				reason: SkipReason;
				a: { id: string; date: string; description: string; status: string };
				b: { id: string; date: string; description: string; status: string };
			}>;
		};
	};

	/**
	 * Årsaken i klartekst, og **hva den betyr for hva som kan gjøres**. En kode alene («ulikt
	 * belop») forteller ikke om det er en feil å rette eller en grense som er riktig satt.
	 */
	const REASON_TEXT: Record<SkipReason, string> = {
		'begge-bokfort':
			'Begge radene står som bokført. Ryddingen krever at én side er reservasjon, så disse dannes det aldri par av.',
		'ulikt-belop':
			'Beløpene er ikke helt like — typisk valutakurs som endret seg mellom reservasjon og bokføring. Ryddingen krever eksakt likhet.',
		'ukjent-status': 'Én av radene mangler status, og deltar derfor ikke.',
		overforing: 'Én av radene er merket intern overføring og holdes bevisst utenfor.',
		'skulle-blitt-fanget':
			'Paret oppfyller kravene. Står det her, har ryddingen ikke kjørt på det ennå — kjør skrivingen.'
	};

	let days = $state('90');
	let direction = $state<Direction>('out');
	let running = $state(false);
	let error = $state<string | null>(null);
	let result = $state<Result | null>(null);

	function nok(value: number): string {
		return `${Math.round(value).toLocaleString('nb-NO')} kr`;
	}

	const totalPairs = $derived(result ? result.pairs.out + result.pairs.in : 0);

	/** Skriveknappen vises bare etter en tørrkjøring som faktisk fant noe å skrive. */
	const canWrite = $derived(result !== null && result.dryRun && result.selectedPairs > 0);

	async function run(dryRun: boolean) {
		running = true;
		error = null;
		try {
			const params = new URLSearchParams({ days, direction, dryRun: String(dryRun) });
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
		ganger.
	</p>
	<p class="meta">
		<!--
			**Ingen forventet verdi her.** Kortet lovet «249 par, 152 982 kr — 27 %», og den
			målingen var oppblåst av to feil tørrkjøringen avslørte: rader med ukjent status ble
			regnet som reservasjoner, og interne overføringer ble paret med hverandre. Et tall i
			innledningen blir lest som en forventning, og en forventning som ikke stemmer får
			brukeren til å stole på planen framfor å lese den.
		-->
		Hvor mange par som finnes vet vi først etter en tørrkjøring — tallet under er det som
		gjelder, ikke et anslag her.
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
		<Select
			bind:value={direction}
			ariaLabel="Hvilken retning"
			dataTrack="rydd-reservasjoner:retning"
		>
			<option value="out">Bare forbruk (anbefalt)</option>
			<option value="in">Bare inntekt</option>
			<option value="all">Begge</option>
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
				<strong>Ingenting er skrevet.</strong> Funnet: {result.pairs.out} forbrukspar
				({nok(result.doubleCounted.spend)}) og {result.pairs.in} inntektspar
				({nok(result.doubleCounted.income)}). Med valgt retning ville
				<strong>{result.selectedPairs}</strong> av dem blitt deaktivert.
			{:else}
				<strong>{result.deactivated} rader deaktivert.</strong>
				{nok(result.doubleCounted.spend)} ut av forbruket og
				{nok(result.doubleCounted.income)} ut av inntekten.
			{/if}
		</p>
		<p class="meta">
			{result.rowsConsidered.toLocaleString('nb-NO')} aktive rader vurdert i vinduet, hvorav
			{result.reservations.toLocaleString('nb-NO')} er reservasjoner (status PENDING).
			{result.unmatched.toLocaleString('nb-NO')} av dem fant ingen ledig motpart og står urørt —
			de er enten ekte ubokførte, eller beløpet endret seg mellom versjonene.
		</p>
		<!--
			Utelatelsene sies med ord. Begge ble oppdaget av tørrkjøringen i prod: rader med ukjent
			status ble regnet som reservasjoner, og overføringer i runde beløp ble paret med
			hverandre.
		-->
		<p class="meta">
			Holdt utenfor: {result.skippedUnknownStatus.toLocaleString('nb-NO')} rader med
			<strong>ukjent status</strong>,
			{result.skippedInternalTransfers.toLocaleString('nb-NO')} rader der
			<strong>begge bein</strong> av en overføring finnes hos oss, og
			{result.skippedTransferText.toLocaleString('nb-NO')} rader der bare
			<strong>teksten</strong> sier overføring.
		</p>
		<p class="meta">
			Det siste tallet fanger de <strong>ettbeinte</strong>: overføringer fra lønnskontoer vi
			ikke synker har bare innskuddet hos oss, så de kan ikke parres med sin motpost. Står det
			0 mens runde beløp som 23 000 fortsatt er i tabellen, er ordlista feil og skal rettes —
			ikke stå og se ut som et vern.
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
							<th class="num">Beløp</th><th>Retning</th><th>Reservasjon</th>
							<th>Bokført</th><th class="num">Dager</th>
						</tr>
					</thead>
					<tbody>
						{#each result.samples as row (row.reservationId)}
							<tr class:dim={row.direction !== result.direction && result.direction !== 'all'}>
								<td class="num">{nok(row.amount)}</td>
								<td>{row.direction === 'out' ? 'ut' : 'inn'}</td>
								<td class="wrap">{row.reservationMerchantKey || '—'}<br /><span class="sub">{row.reservationDate}</span></td>
								<td class="wrap">{row.bookedMerchantKey || '—'}<br /><span class="sub">{row.bookedDate}</span></td>
								<td class="num">{row.deltaDays}</td>
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

		<!--
			**Restposten er bygget fordi brukeren trykket «Deaktiver» og fire duplikater sto igjen.**
			Uten dette avsnittet er svaret på «hvorfor står de der» en gjetning, og gjetninger på
			årsak har tatt feil seks ganger i dette arbeidet. Toleransen er løsere enn ryddingens
			(3 % beløpsavvik) med vilje — en diagnose med samme terskler kan per konstruksjon ikke
			finne noe fixen gikk glipp av.
		-->
		<h3>Duplikater som står igjen</h3>
		{#if result.residual.pairs === 0}
			<p class="meta">
				Ingen. Etter denne kjøringen finner vi ingen par med lik beskrivelse og nesten likt beløp
				innenfor tre dager. Ser du likevel et duplikat i lista, ligger forskjellen et annet sted
				enn beløp og beskrivelse — send det, det er data vi mangler.
			</p>
		{:else}
			<p class="meta">
				{result.residual.pairs} par ser ut som duplikater men blir <strong>ikke</strong> ryddet.
				Her er hvorfor:
			</p>
			<ul class="reasons">
				{#each result.residual.byReason as row (row.reason)}
					<li>
						<strong>{row.pairs} par · {nok(row.nok)}</strong> — {REASON_TEXT[row.reason]}
					</li>
				{/each}
			</ul>
			<div class="table-scroll">
				<table>
					<thead>
						<tr>
							<th class="num">Beløp</th><th>Rad A</th><th>Rad B</th>
							<th class="num">Avvik</th><th>Årsak</th>
						</tr>
					</thead>
					<tbody>
						{#each result.residual.suspects as row (`${row.a.id}-${row.b.id}`)}
							<tr>
								<td class="num">{nok(row.amount)}</td>
								<td class="wrap"
									>{row.a.description || '—'}<br /><span class="sub"
										>{row.a.date} · {row.a.status}</span
									></td
								>
								<td class="wrap"
									>{row.b.description || '—'}<br /><span class="sub"
										>{row.b.date} · {row.b.status}</span
									></td
								>
								<!-- Avviket i prosent er det som avgjør «ulikt belop», så det skal stå synlig. -->
								<td class="num">{row.amountDeltaPct === 0 ? '0' : `${row.amountDeltaPct} %`}</td>
								<td>{row.reason}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="meta">
				Dette er en <strong>diagnose, ikke en plan</strong> — ingenting her blir rørt av knappene
				over. Kravet er at beskrivelsene er like, eller at den ene er den andre med noe foran
				(en valutakode <em>eller</em> et personnavn).
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
	/* Utenfor valgt retning: synlig, men tydelig ikke i spill. */
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
