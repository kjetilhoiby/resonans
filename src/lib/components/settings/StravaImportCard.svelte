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
	import { retryDelayMs, shouldRetryBatch } from '$lib/domain/health/import-retry';

	/**
	 * Aktiviteter per kall.
	 *
	 * Et spor er tungt (opptil 2000 lagrede punkter, og råfila kan være
	 * hundrevis av kB), så batchen er liten med vilje — 20 filer er noen MB, godt
	 * under grensa, og gir en framdriftslinje som beveger seg.
	 */
	const BATCH_SIZE = 20;

	/**
	 * Svaret fra importendepunktet.
	 *
	 * Skrevet ut framfor `any`: løkka har nå en gren der `data` kan være null
	 * (runden ga opp), og da må typesjekken se hva som faktisk leses ut av den.
	 */
	type ImportResponse = {
		written?: number;
		existed?: number;
		skipped?: number;
		blocked?: number;
		failed?: number;
		paceReferenceUsed?: { distanceMeters: number; seconds: number } | null;
		/** Speiler `ImportOutcome` i `strava-import.ts` — en union, ikke ett løst objekt. */
		outcomes?: Array<
			| { status: 'written'; id: string }
			| { status: 'existed'; id: string }
			| { status: 'skipped'; id: string; reason: string; detail?: string }
			| { status: 'blocked'; id: string; findings: Array<{ axis: string; reason: string }> }
			| { status: 'failed'; id: string; error: string }
		>;
	};

	/** Tak på runder, som i reanalyse-kortet: en bug skal ikke gi uendelig kall. */
	const MAX_ROUNDS = 200;

	/**
	 * Forsøk per runde før den gis opp.
	 *
	 * En runde som dør er nesten alltid transport — skjermen slo seg av, wifi
	 * skiftet, telefonen suspenderte fanen. Serveren er idempotent, så et nytt
	 * forsøk på den samme batchen kan i verste fall skrive det som alt er
	 * skrevet, og det svarer den «fantes fra før» på.
	 */
	const BATCH_ATTEMPTS = 3;
	/** Ventetid mellom forsøk. Doblet per runde: 1 s, 2 s. */
	const RETRY_BASE_MS = 1000;

	let file = $state<File | null>(null);
	let running = $state(false);
	let error = $state<string | null>(null);
	let done = $state(false);
	/** Økter serveren alt hadde da kjøringen startet — hoppet over uten å sendes. */
	let resumedFrom = $state(0);
	/** Runder som ga opp etter alle forsøk. Kjøringen fortsetter forbi dem. */
	let deadRounds = $state<Array<{ from: number; to: number; error: string }>>([]);
	/** Skjermlåsen, når nettleseren ga oss en. */
	let wakeLock: { release: () => Promise<void> } | null = null;

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
	 * Hvor mange denne kjøringen faktisk skal gjennom.
	 *
	 * Ikke `total`: etter et resume er de fleste alt inne, og «Jobber… 20 av
	 * 1019» ville stått nesten stille gjennom en kjøring som var ferdig på et
	 * par minutter.
	 */
	let queueSize = $state(0);
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

	/**
	 * Hold skjermen våken mens importen går.
	 *
	 * Dette er ÅRSAKEN til at kjøringen 5. september døde: telefonen låste seg
	 * etter noen minutter, Safari drepte fetchen midt i en runde, og feltet sa
	 * «Load failed» — nettleserens egen tekst for en avbrutt forespørsel, ikke
	 * noe serveren sa. En import over tusen filer tar lengre tid enn en
	 * skjermtidsavbrudd, så låsen er ikke pynt.
	 *
	 * Feiler den, går vi videre uten: en manglende skjermlås skal ikke stoppe
	 * importen, den gjør bare avbrudd mer sannsynlig — og resume dekker det.
	 */
	async function keepAwake() {
		try {
			const nav = navigator as Navigator & {
				wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
			};
			wakeLock = (await nav.wakeLock?.request('screen')) ?? null;
		} catch {
			wakeLock = null;
		}
	}

	async function releaseWake() {
		try {
			await wakeLock?.release();
		} catch {
			// Låsen er alt borte — den slippes av seg selv når fanen skjules.
		}
		wakeLock = null;
	}

	/**
	 * Id-ene serveren alt har. Feiler oppslaget, returneres et tomt sett:
	 * resume er en OPTIMALISERING, og skrivingen er idempotent uansett — så en
	 * import som ikke fikk svar her skal gå videre og gjøre jobben på nytt,
	 * ikke stoppe.
	 */
	async function alreadyImported(ids: string[]): Promise<Set<string>> {
		try {
			const res = await fetch('/api/sensors/strava-import/status', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ ids })
			});
			if (!res.ok) return new Set();
			const data = (await res.json()) as { imported?: string[] };
			return new Set(data.imported ?? []);
		} catch {
			return new Set();
		}
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
		queueSize = 0;
		blockedDetail = [];
		failures = [];
		skippedDetail = [];
		referenceUsed = null;
		resumedFrom = 0;
		deadRounds = [];

		try {
			await keepAwake();
			const { default: JSZip } = await import('jszip');
			const zip = await JSZip.loadAsync(file);

			// **Resume: spør serveren FØR vi sender noe.** Et avbrudd skal koste
			// det som gjenstår, ikke hele arkivet på nytt. Radene som finnes er
			// fasit — ikke en framdriftsmarkør i klienten, som kan gå ut av takt
			// med basen uten at noen ser det.
			const done0 = await alreadyImported(importable.map((r) => r.id));
			const queue = importable.filter((r) => !done0.has(r.id));
			resumedFrom = importable.length - queue.length;
			queueSize = queue.length;
			if (queue.length === 0) {
				done = true;
				return;
			}

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

				// **En død runde river ikke resten.** Før 5. september gjorde et
				// `return` her at ett avbrutt kall avsluttet hele kjøringen — og
				// avbruddet kom av at skjermen slo seg av, altså noe som gjentar
				// seg. Nå: nytt forsøk med voksende pause, og gir den seg, går vi
				// VIDERE til neste runde og sier hvilke som falt ut. Serveren er
				// idempotent, så et nytt forsøk koster ingenting galt.
				let data: ImportResponse | null = null;
				let lastError = '';
				for (let attempt = 1; attempt <= BATCH_ATTEMPTS; attempt += 1) {
					if (attempt > 1) {
						await new Promise((r) => setTimeout(r, retryDelayMs(attempt, RETRY_BASE_MS)));
					}
					let retryable: boolean;
					try {
						const res = await fetch('/api/sensors/strava-import', { method: 'POST', body: form });
						if (res.ok) {
							data = (await res.json()) as ImportResponse;
							break;
						}
						lastError = extractApiErrorMessage(res.status, await res.text());
						retryable = shouldRetryBatch({ kind: 'http', status: res.status });
					} catch (err) {
						lastError = err instanceof Error ? err.message : String(err);
						retryable = shouldRetryBatch({ kind: 'transport' });
					}
					if (!retryable) break;
				}

				if (!data) {
					deadRounds.push({
						from: start + 1,
						to: start + batch.length,
						error: lastError || 'Ukjent feil'
					});
					processed += batch.length;
					continue;
				}

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
			if (deadRounds.length > 0) {
				const økter = deadRounds.reduce((n, r) => n + (r.to - r.from + 1), 0);
				error = `${deadRounds.length} runder (${økter} økter) kom ikke gjennom. Trykk igjen — de som alt er inne hoppes over.`;
			}
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			await releaseWake();
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
					? `Jobber… ${processed} av ${queueSize || total}`
					: dryRun
						? 'Tørrkjør'
						: `Importer ${total} økter`}
			</Button>
		</div>
	{/if}

	{#if error}
		<p class="err">{error}</p>
	{/if}

	{#if resumedFrom > 0}
		<!--
			Resume skal SIES. Et tall som plutselig er lavere enn «1019 økter» på
			knappen ser ut som at noe mangler; setningen gjør det til det den er.
		-->
		<p class="resumed">
			{resumedFrom} økter lå inne fra før og sendes ikke på nytt.
		</p>
	{/if}

	{#if deadRounds.length > 0}
		<details class="dead-rounds">
			<summary>{deadRounds.length} runder kom ikke gjennom</summary>
			<ul>
				{#each deadRounds as round (round.from)}
					<!-- Nummereringen er posisjon i DENNE kjøringens kø, ikke i
					     manifestet — etter et resume er de to ulike. -->
					<li>Nr. {round.from}–{round.to} i denne kjøringen: {round.error}</li>
				{/each}
			</ul>
		</details>
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

	.resumed {
		margin: 0.4rem 0 0;
		font-size: 0.82rem;
		color: var(--text-secondary, #aaa);
	}

	.dead-rounds {
		margin: 0.4rem 0 0;
		font-size: 0.82rem;
		color: var(--error-text, #e0806a);
	}
	.dead-rounds ul {
		margin: 0.3rem 0 0;
		padding-left: 1.1rem;
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
