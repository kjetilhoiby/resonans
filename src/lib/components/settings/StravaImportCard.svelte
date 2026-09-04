<script lang="ts">
	/**
	 * Importerer en Strava-arkiveksport (zip) — engangsjobben som henter årene
	 * før Withings-kontoen begynte.
	 *
	 * Se `docs/changelog/2026-09-04-strava-arkivimport.md`.
	 *
	 * ## Zipen pakkes ut i NETTLESEREN
	 *
	 * Den er 38 MB og inneholder 1020 spor. `BODY_SIZE_LIMIT` er hevet til 100M,
	 * så serveren kunne tatt hele — men da måtte den enten holde alle sporene i
	 * minnet samtidig, eller få zipen sendt på nytt for hver runde (38 MB × 20).
	 * Klienten leser den én gang og sender filene i porsjoner. Løkka i klienten
	 * er samme grep som `WorkoutReanalyzeCard`, og av samme grunn: en
	 * serverside-løkke ville truffet svartidsgrensa, og en halvferdig jobb uten
	 * framdriftstall er verre enn en som teller.
	 *
	 * ## Tempo-referansen er ikke pynt
	 *
	 * Uten den er `for-rask`-aksen AV, og en sykkeltur merket «Run» går rett inn
	 * i distanserekordene — der den blir stående, siden en rekord er «min over
	 * alle økter». Feltet har derfor ingen default: et hardkodet tempo arver
	 * stille feilen i den kroppen det en gang ble satt for.
	 */
	import { Button } from '$lib/components/ui';
	import { extractApiErrorMessage } from '$lib/client/api-error';
	import {
		parseStravaManifest,
		skipReasonFor,
		type StravaManifestRow
	} from '$lib/domain/health/strava-export';
	import {
		describePaceReference,
		PACE_REFERENCE_DISTANCES,
		paceReferenceSliderRange,
		sliderMidpoint
	} from '$lib/domain/health/import-triage';
	import { formatPace } from '$lib/utils/activity-metrics';

	/**
	 * Aktiviteter per kall.
	 *
	 * Et spor er tungt (opptil 2000 lagrede punkter, og råfila kan være
	 * hundrevis av kB), så batchen er liten med vilje — 20 filer er noen MB, godt
	 * under grensa, og gir en framdriftslinje som beveger seg.
	 */
	const BATCH_SIZE = 20;

	/** Tak på runder, som i reanalyse-kortet: en bug skal ikke gi uendelig kall. */
	const MAX_ROUNDS = 200;

	let file = $state<File | null>(null);
	let running = $state(false);
	let error = $state<string | null>(null);
	let done = $state(false);

	/** Brukerens egen referanse: distanse i meter og tid i sekunder. */
	/** Valgt referansedistanse i meter, eller null. */
	let refDistance = $state<number | null>(null);
	/** Sliderens posisjon i sekunder. Alltid et tall — se `timeSet`. */
	let sliderSeconds = $state(0);
	/**
	 * Har brukeren rørt slideren?
	 *
	 * Slideren MÅ stå et sted visuelt, men den posisjonen er VÅR, ikke
	 * brukerens. Regnet den som satt, ville tempo-kontrollen slått seg på med
	 * et tall vi valgte — nøyaktig samme feil som placeholderne «10000» og
	 * «3120» gjorde, bare vanskeligere å oppdage: da så feltet tomt ut mens
	 * kontrollen var av, nå ville det sett satt ut mens kontrollen var på med
	 * en gjetning.
	 */
	let timeSet = $state(false);
	let dryRun = $state(true);

	/** Manifestet, lest i klienten så vi kan vise hva arkivet inneholder FØR noe sendes. */
	let manifestCsv = $state<string | null>(null);
	let rows = $state<StravaManifestRow[]>([]);
	let filesInZip = $state<Map<string, string>>(new Map());

	let written = $state(0);
	let existed = $state(0);
	let skipped = $state(0);
	let blocked = $state(0);
	let failed = $state(0);
	let processed = $state(0);
	/**
	 * Referansen SERVEREN sier den brukte, ikke den klienten mente å sende.
	 *
	 * Feltene over kan se satt ut uten å være det (de gjorde nettopp det), og
	 * en tempo-kontroll som ikke var på ser identisk ut med en som ikke fant
	 * noe. Utfallet skal melde seg selv.
	 */
	let referenceUsed = $state<{ distanceMeters: number; seconds: number } | null>(null);
	/** Hva triagen holdt ute, med tallene — «8 blokkert» kan ikke handles på. */
	let blockedDetail = $state<
		Array<{
			id: string;
			date: string;
			name: string | null;
			/** Funnet som FAKTISK holdt raden ute. */
			reason: string;
			/** Øvrige funn på samme rad — kontekst, ikke grunnen. */
			also: string[];
		}>
	>([]);
	let failures = $state<Array<{ id: string; error: string }>>([]);
	/**
	 * Økter som ikke ga et spor, navngitt.
	 *
	 * «6 uten spor» kan ikke granskes; datoen og filnavnet kan. Det er dessuten
	 * den ene kategorien der en PARSER-feil ville skjult seg — en fil vi ikke
	 * klarer å lese ser identisk ut med en fil som ikke har noe å lese.
	 */
	let skippedDetail = $state<
		Array<{ id: string; date: string; name: string | null; file: string | null; reason: string }>
	>([]);

	const importable = $derived(rows.filter((r) => !skipReasonFor(r)));
	const total = $derived(importable.length);

	const sliderRange = $derived(
		refDistance != null ? paceReferenceSliderRange(refDistance) : null
	);

	const paceReference = $derived(
		refDistance != null && timeSet ? { distanceMeters: refDistance, seconds: sliderSeconds } : null
	);

	/**
	 * Hvor langt inn i båndet slideren står, i prosent.
	 *
	 * Trengs fordi sporet må tegnes selv: `accent-color` farger tomlen og
	 * fyllet, men lar SPORET stå i nettleserens lyse standard, og
	 * `color-scheme: dark` rører det ikke. Styrer man sporet, forsvinner
	 * fyllet — derfor gradienten, som gir begge.
	 */
	const sliderFill = $derived.by(() => {
		if (!sliderRange || !timeSet) return 0;
		const span = sliderRange.max - sliderRange.min;
		if (span <= 0) return 0;
		return ((sliderSeconds - sliderRange.min) / span) * 100;
	});

	/** Tempoet tiden svarer til. Det er dette tallet som gjør tiden etterprøvbar. */
	const referencePace = $derived(
		paceReference ? formatPace(paceReference.seconds / (paceReference.distanceMeters / 1000)) : ''
	);

	/**
	 * Bytte av distanse NULLER tiden.
	 *
	 * 52:00 er en mil, ikke en halvmaraton. Ble tiden stående, ville et bytte
	 * fra 10 km til halvmaraton gitt en referanse på 2:28/km — altså en kurve
	 * som holder nesten hele arkivet ute.
	 */
	function pickDistance(event: Event) {
		const raw = (event.target as HTMLSelectElement).value;
		refDistance = raw === '' ? null : Number(raw);
		timeSet = false;
		sliderSeconds = refDistance != null ? sliderMidpoint(paceReferenceSliderRange(refDistance)) : 0;
	}

	function formatSeconds(total: number): string {
		const hours = Math.floor(total / 3600);
		const minutes = Math.floor((total % 3600) / 60);
		const rest = total % 60;
		if (hours > 0) {
			return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
		}
		return `${minutes}:${String(rest).padStart(2, '0')}`;
	}

	/**
	 * Leser zipen og bygger manifestet.
	 *
	 * JSZip importeres dynamisk: den er en avhengighet serveren alt har (den
	 * leser docx/xlsx), men 100 kB i hovedbunten for et kort på en
	 * innstillingsside er ikke verdt det.
	 */
	async function readZip(selected: File) {
		error = null;
		done = false;
		rows = [];
		manifestCsv = null;
		filesInZip = new Map();

		const { default: JSZip } = await import('jszip');
		const zip = await JSZip.loadAsync(selected);

		// Manifestet ligger som `activities.csv` i rota. Navnet er Stravas, og
		// mangler det, er det ikke en aktivitetseksport — det skal sies, ikke
		// vises som «0 aktiviteter».
		const manifestEntry =
			zip.file('activities.csv') ??
			zip.file(/(^|\/)activities\.csv$/i)[0] ??
			null;
		if (!manifestEntry) {
			throw new Error(
				'Fant ikke activities.csv i zipen. Er dette en fullstendig Strava-eksport («Last ned eller slett kontoen din» → «Be om arkiv»)?'
			);
		}

		manifestCsv = await manifestEntry.async('string');
		rows = parseStravaManifest(manifestCsv);

		// Filstien i manifestet er relativ til zip-rota, men eksporten har vært
		// observert med et mappeledd foran. Vi indekserer derfor på HALEN av
		// stien, så begge oppsett treffer.
		const byTail = new Map<string, string>();
		for (const path of Object.keys(zip.files)) {
			if (zip.files[path].dir) continue;
			byTail.set(path.toLowerCase(), path);
			const tail = path.split('/').slice(-2).join('/').toLowerCase();
			byTail.set(tail, path);
		}
		filesInZip = byTail;
	}

	async function onPick(event: Event) {
		const input = event.target as HTMLInputElement;
		const selected = input.files?.[0] ?? null;
		file = selected;
		if (!selected) return;
		running = true;
		try {
			await readZip(selected);
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
			rows = [];
		} finally {
			running = false;
		}
	}

	function zipPathFor(row: StravaManifestRow): string | null {
		if (!row.filePath) return null;
		const wanted = row.filePath.toLowerCase();
		return filesInZip.get(wanted) ?? filesInZip.get(wanted.split('/').slice(-2).join('/')) ?? null;
	}

	async function run() {
		if (!file || !manifestCsv) return;
		running = true;
		error = null;
		done = false;
		written = 0;
		existed = 0;
		skipped = 0;
		blocked = 0;
		failed = 0;
		processed = 0;
		blockedDetail = [];
		failures = [];
		skippedDetail = [];
		referenceUsed = null;

		try {
			const { default: JSZip } = await import('jszip');
			const zip = await JSZip.loadAsync(file);
			const queue = importable;

			for (let start = 0, round = 0; start < queue.length; start += BATCH_SIZE, round += 1) {
				if (round >= MAX_ROUNDS) {
					error = `Stoppet etter ${MAX_ROUNDS} runder. ${processed} av ${queue.length} er behandlet — kjør igjen for resten.`;
					return;
				}

				const batch = queue.slice(start, start + BATCH_SIZE);
				const form = new FormData();
				form.set('manifest', manifestCsv);
				form.set('ids', JSON.stringify(batch.map((r) => r.id)));
				if (paceReference) {
					form.set('pr', `${paceReference.distanceMeters}:${paceReference.seconds}`);
				}
				if (dryRun) form.set('dryRun', 'true');

				for (const row of batch) {
					const path = zipPathFor(row);
					if (!path) continue;
					const blob = await zip.files[path].async('blob');
					form.set(`file:${row.id}`, new File([blob], row.filePath ?? path));
				}

				const res = await fetch('/api/sensors/strava-import', { method: 'POST', body: form });
				if (!res.ok) {
					error = extractApiErrorMessage(res.status, await res.text());
					return;
				}
				const data = await res.json();

				// Tallene oppdateres per runde, ikke til slutt: 1019 aktiviteter tar
				// tid, og en knapp som bare spinner ser ut som at den henger.
				written += data.written ?? 0;
				existed += data.existed ?? 0;
				skipped += data.skipped ?? 0;
				blocked += data.blocked ?? 0;
				failed += data.failed ?? 0;
				processed += batch.length;
				referenceUsed = data.paceReferenceUsed ?? null;

				for (const outcome of data.outcomes ?? []) {
					if (outcome.status === 'blocked') {
						const row = batch.find((r) => r.id === outcome.id);
						// **Bare for-rask-funnet er grunnen.** Panelet heter «holdt ute
						// av tempo-kontrollen», og en rad kan ha flere funn — den ene
						// i arkivet hadde også 79 % uten bevegelse. Slått sammen med
						// ' · ' leste det som om begge holdt raden ute, og da kan man
						// ikke se hvilken regel som faktisk slo til.
						const findings: Array<{ axis: string; reason: string }> = outcome.findings ?? [];
						const blocking = findings.filter((f) => f.axis === 'for-rask');
						blockedDetail.push({
							id: outcome.id,
							date: row?.dateText ?? '',
							name: row?.name ?? null,
							reason: blocking.map((f) => f.reason).join(' · '),
							also: findings.filter((f) => f.axis !== 'for-rask').map((f) => `${f.axis}: ${f.reason}`)
						});
					} else if (outcome.status === 'failed') {
						failures.push({ id: outcome.id, error: outcome.error });
					} else if (outcome.status === 'skipped' && outcome.reason !== 'ingen-fil') {
						// «ingen-fil» er de 100 manuelle øktene — forventet, og alt
						// oppsummert over. Resten er de som HADDE en fil vi ikke fikk
						// noe ut av, og bare de er verdt å se på.
						const row = batch.find((r) => r.id === outcome.id);
						skippedDetail.push({
							id: outcome.id,
							date: row?.dateText ?? '',
							name: row?.name ?? null,
							file: row?.filePath ?? null,
							// Detaljen sier hva fila inneholdt. «ingen-spor» alene
							// kunne ikke skille dataene fra parseren.
							reason: outcome.detail ?? outcome.reason
						});
					}
				}
			}
			done = true;
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			running = false;
		}
	}
</script>

<section class="card">
	<h2>Importer Strava-arkiv</h2>
	<p class="meta">
		Engangsjobb som henter årene før Withings-kontoen begynte. Zipen pakkes ut i nettleseren
		og sendes i porsjoner — den lastes aldri opp i sin helhet.
	</p>

	<input
		type="file"
		accept=".zip,application/zip"
		disabled={running}
		onchange={onPick}
		data-track="strava-import:velg-zip"
	/>

	{#if rows.length > 0}
		<p class="summary">
			{rows.length} aktiviteter i manifestet, {total} kan importeres.
			{#if rows.length - total > 0}
				<span class="muted">
					{rows.length - total} hoppes over (manuelle økter uten fil, eller ukjent sport).
				</span>
			{/if}
		</p>

		<div class="pr">
			<p class="meta">
				<strong>Din egen referanse.</strong> En distanse og en tid du faktisk har løpt. Uten den
				er kontrollen mot for raske økter AV, og en sykkeltur merket «Run» går rett inn i
				distanserekordene.
			</p>
			<div class="pr-fields">
				<label class="pr-select">
					Distanse
					<select disabled={running} onchange={pickDistance} data-track="strava-import:pr-distanse">
						<option value="">Velg …</option>
						{#each PACE_REFERENCE_DISTANCES as option (option.meters)}
							<option value={option.meters} selected={refDistance === option.meters}>
								{option.label}
							</option>
						{/each}
					</select>
				</label>
			</div>

			{#if sliderRange}
				<div class="pr-time">
					<div class="pr-readout">
						<!--
							Tiden STOR, tempoet under. Tiden er det brukeren husker;
							tempoet er det som gjør den etterprøvbar — «52:00» kan man
							ta feil av, «5:12/km» kjenner man igjen som sitt eget.
						-->
						<span class="pr-value" class:pr-unset={!timeSet}>
							{timeSet ? formatSeconds(sliderSeconds) : '– – : – –'}
						</span>
						<span class="pr-pace">
							{timeSet ? referencePace : 'Dra for å sette tiden'}
						</span>
					</div>
					<!--
						Endene og steglengden står OVER slideren, ikke under.
						Hånda dekker alt under en slider mens man drar — det er
						nettopp da man trenger å se hva båndet går fra og til.
					-->
					<div class="pr-ends">
						<span>{formatSeconds(sliderRange.min)}</span>
						<span class="muted">{sliderRange.step} s per steg</span>
						<span>{formatSeconds(sliderRange.max)}</span>
					</div>
					<input
						type="range"
						min={sliderRange.min}
						max={sliderRange.max}
						step={sliderRange.step}
						value={sliderSeconds}
						disabled={running}
						style="--fill: {sliderFill}%"
						aria-label="Tid på referansedistansen"
						oninput={(event) => {
							sliderSeconds = Number((event.target as HTMLInputElement).value);
							timeSet = true;
						}}
						data-track="strava-import:pr-tid"
					/>
				</div>
			{/if}

			<!--
				Tilstanden sies med TALLENE, ikke bare med fravær av et varsel.
				Placeholderne var «10000» og «3120» — altså nøyaktig verdiene
				brukeren skal skrive — så tomme felt så utfylte ut, og det orange
				varselet leste som en feil framfor som en beskrivelse. En
				tørrkjøring mot hele arkivet ga «0 holdt ute» av den grunn.
			-->
			{#if paceReference}
				<p class="ok">
					Kontroll aktiv: {describePaceReference(paceReference)} ({referencePace}). Økter
					merkbart raskere enn din egen kurve holdes ute.
				</p>
			{:else}
				<p class="warn">
					{#if refDistance == null}
						Ingen referanse satt — alt importeres uten tempo-kontroll.
					{:else}
						Sett tiden med slideren. Til da importeres alt uten tempo-kontroll.
					{/if}
				</p>
			{/if}
		</div>

		<label class="dry">
			<input
				type="checkbox"
				bind:checked={dryRun}
				disabled={running}
				data-track="strava-import:tørrkjoring"
			/>
			Tørrkjøring — dømmer og rapporterer uten å skrive
		</label>

		<div class="controls">
			<Button disabled={running || total === 0} onClick={run}>
				{running
					? `Jobber… ${processed} av ${total}`
					: dryRun
						? 'Tørrkjør'
						: `Importer ${total} økter`}
			</Button>
		</div>
	{/if}

	{#if error}
		<p class="err">{error}</p>
	{/if}

	{#if done || (running && processed > 0)}
		<p class="summary">
			{#if dryRun}Tørrkjøring:{/if}
			{written}
			{dryRun ? 'ville blitt skrevet' : 'skrevet'} · {existed} fantes fra før · {skipped} uten
			spor · {blocked} holdt ute
			{#if failed > 0}
				· {failed} feilet
			{/if}
		</p>
		<p class="note">
			{#if referenceUsed}
				Tempo-kontroll mot {describePaceReference(referenceUsed)}.
			{:else}
				<strong>Uten tempo-kontroll</strong> — «0 holdt ute» betyr her at ingenting ble
				sjekket, ikke at ingenting var galt.
			{/if}
		</p>
	{/if}

	{#if blockedDetail.length > 0}
		<!-- **Blokkerte økter navngis.** «8 holdt ute» kan ikke handles på; datoen
		     og tallene kan. Dette er øktene som ville blitt distanserekorder. -->
		<details>
			<summary>{blockedDetail.length} holdt ute av tempo-kontrollen</summary>
			<ul class="detail">
				{#each blockedDetail as item (item.id)}
					<li>
						<span class="date">{item.date}</span>
						{item.name ?? ''}
						<span class="muted">{item.reason}</span>
						{#if item.also.length > 0}
							<span class="muted">— også flagget: {item.also.join(' · ')}</span>
						{/if}
					</li>
				{/each}
			</ul>
			<p class="note">
				Disse er antakelig feilmerket sport. Åpne dem i Strava, rett sporten der, og be om et
				nytt arkiv — eller la dem stå ute: de er ikke løpeøkter.
			</p>
		</details>
	{/if}

	{#if skippedDetail.length > 0}
		<details>
			<summary>{skippedDetail.length} med fil, men uten brukbart spor</summary>
			<ul class="detail">
				{#each skippedDetail as item (item.id)}
					<li>
						<span class="date">{item.date}</span>
						{item.name ?? ''}
						<span class="muted">{item.file ?? ''} — {item.reason}</span>
					</li>
				{/each}
			</ul>
			<p class="note">
				Fila fantes, men ga hverken spor eller pulskurve. Vanligvis en økt registrert uten
				GPS. Er det mange, og de har GPS i Strava, er det parseren som svikter — ikke dataene.
			</p>
		</details>
	{/if}

	{#if failures.length > 0}
		<details>
			<summary>{failures.length} feilet</summary>
			<ul class="detail">
				{#each failures as item (item.id)}
					<li><span class="date">{item.id}</span> <span class="muted">{item.error}</span></li>
				{/each}
			</ul>
		</details>
	{/if}

	{#if done && !dryRun && written > 0}
		<p class="note">
			Kjør <strong>Etterfyll øktanalyse</strong> og <strong>Reprojiser effort</strong> etterpå:
			distanserekorder, sonefordeling og effort regnes av jobber som ikke ser de nye radene av
			seg selv.
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

	.meta {
		margin: 0;
		font-size: 0.82rem;
		color: var(--text-secondary, #aaa);
		line-height: 1.5;
	}

	.summary {
		margin: 0;
		font-size: 0.85rem;
		color: var(--text-primary, #eee);
		line-height: 1.5;
	}

	.muted {
		color: var(--text-secondary, #aaa);
	}

	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}

	.pr {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.6rem;
		border: 1px solid var(--card-border, #242424);
		border-radius: 10px;
	}

	.pr-fields {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
	}

	/*
	 * 0,82rem er `/settings/sources` sin egen konvensjon for en feltlabel
	 * (`.field label` der). 0,78rem gjorde den til kortets minste tekst, rett
	 * over kontrollen man må røre først — den målte 7,93:1 mot kortet, altså
	 * godt innenfor kravet, men lest som mindre viktig enn den er.
	 */
	.pr-fields label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.82rem;
		color: var(--text-secondary, #aaa);
	}

	.pr-select select {
		padding: 0.4rem 0.5rem;
		border-radius: 8px;
		border: 1px solid var(--card-border, #242424);
		background: var(--surface, #0e0e0e);
		color: var(--text-primary, #eee);
		font-size: 0.9rem;
	}

	.pr-time {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.pr-readout {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
	}

	/* Tiden er tallet man leser av på en armlengdes avstand mens man drar. */
	.pr-value {
		font-size: 1.6rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--text-primary, #eee);
		line-height: 1.1;
	}

	.pr-unset {
		color: var(--text-secondary, #aaa);
		font-weight: 500;
	}

	.pr-pace {
		font-size: 0.85rem;
		color: var(--text-secondary, #aaa);
		font-variant-numeric: tabular-nums;
	}

	/*
	 * Sporet tegnes selv, og det er ikke smak: nettleserens standardspor er lyst
	 * grått og lyser på en alltid-mørk flate. `accent-color` fikser det ikke —
	 * den farger tomlen og fyllet, ikke sporet — og `color-scheme: dark` rører
	 * det heller ikke (målt i Chromium). Gradienten gir både et mørkt spor og
	 * et synlig fyll, og bruker kortets egne variabler framfor faste farger.
	 */
	.pr-time input[type='range'] {
		width: 100%;
		appearance: none;
		-webkit-appearance: none;
		height: 1.4rem;
		background: transparent;
		cursor: pointer;
	}

	.pr-time input[type='range']:disabled {
		cursor: default;
		opacity: 0.6;
	}

	.pr-time input[type='range']::-webkit-slider-runnable-track {
		height: 6px;
		border-radius: 999px;
		background: linear-gradient(
			to right,
			var(--accent, #5b5bd6) var(--fill, 0%),
			var(--card-border, #242424) var(--fill, 0%)
		);
	}

	.pr-time input[type='range']::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 18px;
		height: 18px;
		margin-top: -6px;
		border-radius: 50%;
		background: var(--accent, #5b5bd6);
		border: 2px solid var(--card-bg-subtle, #141414);
	}

	.pr-time input[type='range']::-moz-range-track {
		height: 6px;
		border-radius: 999px;
		background: var(--card-border, #242424);
	}

	.pr-time input[type='range']::-moz-range-progress {
		height: 6px;
		border-radius: 999px;
		background: var(--accent, #5b5bd6);
	}

	.pr-time input[type='range']::-moz-range-thumb {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: var(--accent, #5b5bd6);
		border: 2px solid var(--card-bg-subtle, #141414);
	}

	.pr-ends {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: 0.72rem;
		color: var(--text-secondary, #aaa);
		font-variant-numeric: tabular-nums;
	}

	.dry {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.82rem;
		color: var(--text-secondary, #aaa);
	}

	details {
		font-size: 0.82rem;
		color: var(--text-secondary, #aaa);
	}

	summary {
		cursor: pointer;
		color: var(--text-primary, #eee);
	}

	.detail {
		list-style: none;
		margin: 0.4rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		max-height: 18rem;
		overflow-y: auto;
	}

	.detail li {
		line-height: 1.4;
	}

	.date {
		font-variant-numeric: tabular-nums;
		color: var(--text-primary, #eee);
	}

	.note {
		margin: 0;
		font-size: 0.78rem;
		color: var(--text-secondary, #aaa);
		line-height: 1.5;
	}

	.err {
		margin: 0;
		font-size: 0.82rem;
		color: var(--danger, #e5484d);
		line-height: 1.5;
	}

	.warn {
		margin: 0;
		font-size: 0.78rem;
		color: var(--warning, #f5a524);
		line-height: 1.5;
	}

	.ok {
		margin: 0;
		font-size: 0.78rem;
		color: var(--success, #46a758);
		line-height: 1.5;
	}
</style>
