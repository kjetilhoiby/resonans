<script lang="ts">
	/**
	 * Økonomidiagnosen: er lagrene enige, og hva koster avvikene?
	 *
	 * Kortet leder med **hvorfor**, ikke med knappen — som `EffortReprojectCard`. Dette er en
	 * ren lesing, så det er trygt å trykke; men et tall uten tolkning er verdiløst her, så
	 * kortet sier hva et FRISKT svar ser ut som ved siden av hva som faktisk kom.
	 *
	 * Bakgrunn i `docs/changelog/2026-08-11-okonomi-tillitsgjennomgang.md`. Kort fortalt: tre
	 * parallelle lagre ga 6,0 mill. / 1,58 mill. / 1,48 mill. kr «forbruk» over samme år, og
	 * 68 % av canonicals forbruk var penger flyttet mellom egne kontoer. Etter fase 1 og 2
	 * skal radene under være enige, og månedsforbruket lande rundt 42 000 kr.
	 *
	 * Endepunktet er admin-gated, så kortet vises bare for admin — «403» uten tekst ville
	 * sett ut som en feil i diagnosen framfor manglende tilgang.
	 */
	import { Button, Select } from '$lib/components/ui';
	import { extractApiErrorMessage } from '$lib/client/api-error';

	type StatusRow = {
		bookingStatus: string | null;
		statusRank: number;
		unmapped: boolean;
		versions: number;
		distinctIds: number;
		firstDate: string;
		lastDate: string;
	};
	type MultiplicityRow = {
		multiplicity: number;
		buckets: number;
		observations: number;
		avgFetches: number;
		avgStatuses: number;
		underreportedNok: number;
	};
	type StoreRow = { store: string; rows: number; spendNok: number };
	type Lifecycle = {
		seenCountHistogram: Array<{ seenCount: number; rows: number }>;
		fingerprintStableAcrossFetches: boolean;
		multiSeenRows: number;
		singleSeenRows: number;
		disappeared: Array<{ bookingStatus: string | null; rows: number; nok: number }>;
		disappearedWithoutMatch: number;
		superseded: Array<{
			deltaDays: number | null;
			merchantKeyChanged: boolean;
			pairs: number;
			nok: number;
		}>;
	};
	type Result = {
		window: { days: number; fromDate: string };
		statuses: StatusRow[];
		multiplicity: MultiplicityRow[];
		drift: {
			windowDays: number;
			stalledWithCandidate: number;
			deltaDaysHistogram: Array<{ value: number; count: number }>;
			deltaPctHistogram: Array<{ value: number; count: number }>;
			orphans: number;
			orphanNok: number;
		};
		stores: StoreRow[];
		internalTransfers: { pairs: number; nok: number };
		lifecycle?: Lifecycle;
	};

	let days = $state('365');
	let running = $state(false);
	let error = $state<string | null>(null);
	let result = $state<Result | null>(null);

	function nok(value: number): string {
		return `${Math.round(value).toLocaleString('nb-NO')} kr`;
	}

	/**
	 * Er lagrene enige? Dette er selve regresjonstesten for fase 1.
	 *
	 * `categorized_events` får slingringsmonn: den betjener bare prosjektkoblinger nå og
	 * bygges fortsatt fra rå `sensor_events`, så et avvik der er kjent og dokumentert. Den rå
	 * strømmen skal fortsatt være mangedoblet — vi sletter aldri duplikater der. Det som
	 * betyr noe er at ingen FLATE leser der lenger.
	 */
	const storesVerdict = $derived.by(() => {
		if (!result) return null;
		const raw = result.stores.find((s) => s.store === 'sensor_events');
		const canonical = result.stores.find((s) => s.store === 'canonical_bank_transactions');
		if (!raw || !canonical || canonical.spendNok === 0) return null;

		const ratio = raw.spendNok / canonical.spendNok;
		return `sensor_events er ${ratio.toFixed(1)}× canonical. Det er forventet — den rå strømmen beholder hver versjon av hver transaksjon. Avviket er bare et problem hvis en flate leser der.`;
	});

	/** Månedsforbruk fra canonical. Skal lande rundt 42 000, ikke 132 000. */
	const monthlySpend = $derived.by(() => {
		if (!result) return null;
		const canonical = result.stores.find((s) => s.store === 'canonical_bank_transactions');
		if (!canonical) return null;
		const months = result.window.days / 30.4;
		return {
			gross: canonical.spendNok / months,
			net: (canonical.spendNok - result.internalTransfers.nok) / months
		};
	});

	const unmappedStatuses = $derived(result?.statuses.filter((s) => s.unmapped) ?? []);

	/**
	 * Multiplisitet kan bare måles på data synket ETTER at rå-strømmen ble gjort rå
	 * (2026-08-11). Før det ble rå-tabellen skrevet POST batch-kollaps, så den kunne per
	 * konstruksjon aldri vise mer enn 1 — og et svar på 1,0 der er en tautologi, ikke et funn.
	 */
	const multiplicityMeasurable = $derived(
		result?.multiplicity.some((row) => row.multiplicity > 1) ?? false
	);

	/**
	 * Kan forsvinning måles i det hele tatt?
	 *
	 * Dette er PORTEN for hele livsløpsseksjonen, og den må stå først. `raw_fingerprint`
	 * inneholder `externalTransactionId`; minter SB1 en ny id per henting, får hver henting
	 * en ny rad, `seen_count` blir alltid 1, og «forsvunnet» betyr da ingenting — bare at
	 * ID-en skiftet. Uten dette skillet ville tallene under blitt lest som et funn.
	 */
	const lifecycleGate = $derived.by(() => {
		const cycle = result?.lifecycle;
		if (!cycle) return null;
		if (!cycle.fingerprintStableAcrossFetches) {
			return {
				ok: false,
				text: `Ingen rad er sett mer enn én gang (${cycle.singleSeenRows.toLocaleString('nb-NO')} rader, alle med seen_count 1). Da minter SB1 en ny transaksjons-ID ved hver henting, og siden ID-en er del av raw_fingerprint lager hver synk en ny rad. «Forsvunnet» kan ikke skilles fra «fikk ny ID», så tallene under betyr ingenting. Veien videre er å nøkle rå-strømmen på attributter uten ID-en — ikke å tolke disse tallene.`
			};
		}
		return {
			ok: true,
			text: `${cycle.multiSeenRows.toLocaleString('nb-NO')} rader er sett flere ganger og ${cycle.singleSeenRows.toLocaleString('nb-NO')} bare én gang. Fingerprinten er altså stabil på tvers av synker, og en rad som slutter å bli sett har faktisk forsvunnet fra bankens svar.`
		};
	});

	/** Kroner som ville forsvunnet fra forbruket om erstatningene ble deaktivert. */
	const supersededTotal = $derived.by(() => {
		const rows = result?.lifecycle?.superseded ?? [];
		return {
			pairs: rows.reduce((sum, r) => sum + r.pairs, 0),
			nok: rows.reduce((sum, r) => sum + r.nok, 0),
			mkChangedPairs: rows.filter((r) => r.merchantKeyChanged).reduce((s, r) => s + r.pairs, 0)
		};
	});

	async function run() {
		running = true;
		error = null;
		try {
			const res = await fetch(`/api/admin/debug-sparebank1/dedup?days=${days}`);
			if (!res.ok) {
				// Meldingen VISES. Et generisk «noe gikk galt» her ville gjort en prod-feil
				// uløselig — se CLAUDE.md om serverfeil-synlighet.
				error = extractApiErrorMessage(res.status, await res.text());
				return;
			}
			result = (await res.json()) as Result;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Kunne ikke kjøre diagnosen';
		} finally {
			running = false;
		}
	}
</script>

<section class="card">
	<h2>Bankdiagnose</h2>
	<p class="meta">
		Svarer på om transaksjonslagrene er enige, hvor mye av «forbruket» som er penger flyttet
		mellom egne kontoer, og om dedupliseringen mister eller dobler noe.
	</p>
	<p class="meta">
		<strong>Kun lesing</strong> — ingen bankkall, ingen skriving. Trygg å kjøre om igjen.
	</p>

	<div class="controls">
		<Select bind:value={days} ariaLabel="Hvor langt tilbake" dataTrack="bankdiagnose:vindu">
			<option value="90">90 dager</option>
			<option value="365">365 dager (anbefalt)</option>
			<option value="730">2 år</option>
		</Select>
		<!-- Knappen har beskrivende tekst, så teksten blir label i brukslogginga. -->
		<Button disabled={running} onClick={run}>
			{running ? 'Kjører…' : 'Kjør diagnose'}
		</Button>
	</div>

	{#if error}
		<p class="err" role="alert">{error}</p>
	{/if}

	{#if result}
		<!-- Lagrene: regresjonstesten for fase 1 -->
		<h3>Lagrene</h3>
		<div class="table-scroll">
			<table>
				<thead>
					<tr><th>Lager</th><th class="num">Rader</th><th class="num">Forbruk</th></tr>
				</thead>
				<tbody>
					{#each result.stores as row (row.store)}
						<tr>
							<td><code>{row.store}</code></td>
							<td class="num">{row.rows.toLocaleString('nb-NO')}</td>
							<td class="num">{nok(row.spendNok)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		{#if storesVerdict}
			<p class="meta">{storesVerdict}</p>
		{/if}

		<!-- Interne overføringer: fase 2 -->
		<h3>Interne overføringer</h3>
		<p class="meta">
			{result.internalTransfers.pairs} par, {nok(result.internalTransfers.nok)} flyttet mellom
			egne kontoer. Det er ikke forbruk — men det er sparebevegelse, så de merkes framfor å
			slettes.
		</p>
		{#if monthlySpend}
			<p class="summary">
				Månedsforbruk fra canonical: <strong>{nok(monthlySpend.net)}</strong> uten overføringer,
				{nok(monthlySpend.gross)} med.
			</p>
			<p class="meta">
				Det andre tallet er det flaten viste før fase 2. Lander det du ser på
				økonomi-flaten der, er overføringene fortsatt med et sted.
			</p>
		{/if}

		<!-- Statuser -->
		<h3>Statuser</h3>
		<div class="table-scroll">
			<table>
				<thead>
					<tr>
						<th>Status</th><th class="num">Rank</th><th class="num">Versjoner</th><th>Periode</th>
					</tr>
				</thead>
				<tbody>
					{#each result.statuses as row (row.bookingStatus)}
						<tr class:warn-row={row.unmapped}>
							<td><code>{row.bookingStatus ?? '(tom)'}</code></td>
							<td class="num">{row.statusRank}</td>
							<td class="num">{row.versions.toLocaleString('nb-NO')}</td>
							<td>{row.firstDate} → {row.lastDate}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		{#if unmappedStatuses.length > 0}
			<p class="warn">
				{unmappedStatuses.length} status{unmappedStatuses.length === 1 ? '' : 'er'} har rank 0. Da
				deltar de ikke i GREATEST-løftet fra reservert til bokført, og batch-kollapsens
				sammenligning mot BOOKED treffer dem ikke. Det er et hull i
				<code>bookingStatusRank</code>.
			</p>
		{:else}
			<p class="meta">Ingen status faller utenfor rank-mappingen.</p>
		{/if}

		<!-- Multiplisitet: fase 3 -->
		<h3>Multiplisitet</h3>
		{#if multiplicityMeasurable}
			<div class="table-scroll">
				<table>
					<thead>
						<tr>
							<th class="num">Per bøtte</th><th class="num">Bøtter</th>
							<th class="num">Underrapportert</th>
						</tr>
					</thead>
					<tbody>
						{#each result.multiplicity as row (row.multiplicity)}
							<tr class:warn-row={row.multiplicity > 1}>
								<td class="num">{row.multiplicity}</td>
								<td class="num">{row.buckets.toLocaleString('nb-NO')}</td>
								<td class="num">{row.underreportedNok > 0 ? nok(row.underreportedNok) : '—'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="warn">
				Bøtter med multiplisitet over 1 er ekte gjentatte kjøp — sju øl samme sted samme kveld —
				som telles som ett. Dette er grunnlaget fase 3 venter på.
			</p>
		{:else}
			<p class="meta">
				Alt viser 1. <strong>Det er ikke nødvendigvis et funn.</strong> Rå-strømmen ble skrevet
				etter batch-kollapsen fram til 11. august 2026, så den kunne per konstruksjon aldri vise
				mer enn 1. Bare data synket etter den datoen kan måles — sammenlign
				<code>Periode</code> på statusene over.
			</p>
		{/if}

		<!-- Livsløp: brukerens hypotese om at forrige status forsvinner -->
		{#if result.lifecycle}
			<h3>Livsløp</h3>
			{#if lifecycleGate}
				<p class:warn={!lifecycleGate.ok} class:meta={lifecycleGate.ok}>
					{lifecycleGate.text}
				</p>
			{/if}

			{#if lifecycleGate?.ok}
				{#if result.lifecycle.disappeared.length > 0}
					<div class="table-scroll">
						<table>
							<thead>
								<tr><th>Forsvant, status</th><th class="num">Rader</th><th class="num">Beløp</th></tr>
							</thead>
							<tbody>
								{#each result.lifecycle.disappeared as row (row.bookingStatus)}
									<tr>
										<td><code>{row.bookingStatus ?? '(tom)'}</code></td>
										<td class="num">{row.rows.toLocaleString('nb-NO')}</td>
										<td class="num">{nok(row.nok)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
					<p class="meta">
						Rader som sluttet å bli sett mens andre rader på samme konto og dato fortsatt ble
						hentet. Sammenligningen er mot samme dato, ikke mot nå — en transaksjon slutter å
						bli hentet når den faller ut av synkvinduet, og det er en godartet grunn.
					</p>
				{:else}
					<p class="meta">
						Ingen rader har sluttet å bli sett. Da erstatter ikke banken forrige status, og
						dobbelttellingen har en annen årsak.
					</p>
				{/if}

				{#if supersededTotal.pairs > 0}
					<p class="summary">
						<strong>{supersededTotal.pairs}</strong> erstatningspar funnet,
						{nok(supersededTotal.nok)} som telles to ganger i dag.
					</p>
					<div class="table-scroll">
						<table>
							<thead>
								<tr>
									<th class="num">Datoforskjell</th><th>Beskrivelse</th>
									<th class="num">Par</th><th class="num">Beløp</th>
								</tr>
							</thead>
							<tbody>
								{#each result.lifecycle.superseded as row (`${row.deltaDays}-${row.merchantKeyChanged}`)}
									<tr>
										<td class="num">{row.deltaDays === null ? '—' : `${row.deltaDays} d`}</td>
										<td>{row.merchantKeyChanged ? 'endret' : 'uendret'}</td>
										<td class="num">{row.pairs.toLocaleString('nb-NO')}</td>
										<td class="num">{nok(row.nok)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
					<p class="meta">
						Matchet på <strong>beløp alene</strong> — uten dato, uten beskrivelse. Det er trygt
						her fordi forsvinningen alt har fastslått at raden ble erstattet; samme matching
						uten det kravet ville slått sammen to ekte kjøp på samme beløp.
						{#if supersededTotal.mkChangedPairs > 0}
							{supersededTotal.mkChangedPairs} av parene endret beskrivelse
							(«SEK ICA NARA HAGA» → «ICA NARA HAGA»), og de er per konstruksjon usynlige for
							statusdriften under, som krever samme merchant_key.
						{/if}
					</p>
				{:else}
					<p class="meta">Ingen erstatningspar med samme beløp funnet etter en forsvinning.</p>
				{/if}

				{#if result.lifecycle.disappearedWithoutMatch > 0}
					<p class="meta">
						{result.lifecycle.disappearedWithoutMatch.toLocaleString('nb-NO')} forsvunne rader
						fant <strong>ingen</strong> beløpslik etterfølger. To grunner, med motsatt
						handling: beløpet endret seg mellom versjonene (valutakurs på et utenlandskjøp,
						eller tips), eller raden var en kansellert reservasjon som aldri ble noe. Er
						tallet stort, dekker ikke beløpsmatching alene fenomenet.
					</p>
				{/if}
			{/if}
		{/if}

		<!-- Drift -->
		<h3>Statusdrift</h3>
		<p class="meta">
			{result.drift.stalledWithCandidate} par funnet innenfor ±{result.drift.windowDays} dager.
			{#if result.drift.deltaPctHistogram.length > 0}
				Beløpsavvik: {result.drift.deltaPctHistogram
					.slice(0, 6)
					.map((b) => `${b.value} % (${b.count})`)
					.join(', ')}. En tett klynge på <strong>0 %</strong> betyr at beløpet er identisk og
				bare datoen flytter seg — det er den målingen som ga regelen «eksakt beløp, ±3 dager».
			{/if}
		</p>
		<p class="meta">
			{result.drift.orphans} reservasjoner ble aldri bokført ({nok(result.drift.orphanNok)}). Øvre
			anslag: noen er ekte ubokførte, andre er flere kjøp hos samme sted samme dag.
		</p>

		<p class="meta footer">Vindu: {result.window.days} dager fra {result.window.fromDate}.</p>
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

	/* Tabellen skal rulle i sin egen boks, aldri dra sida vannrett. */
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

	code {
		font-size: 0.76rem;
	}

	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.warn-row td {
		color: #fbbf24;
	}

	.footer {
		margin-top: 0.4rem;
		font-size: 0.76rem;
		opacity: 0.8;
	}
</style>
