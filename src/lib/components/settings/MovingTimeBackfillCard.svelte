<script lang="ts">
	/**
	 * Fyller bevegelsestid på historiske økter, og reberegner effort etterpå.
	 *
	 * **De to stegene er ett kort med vilje.** `data.movingDuration` er rådata;
	 * `effortScore` er lagret i `canonical_workouts` og ser den ikke før en
	 * reprojeksjon har kjørt. Skrev man bare det første, ville jobben sett
	 * fullført ut mens hvert tall på Trening-flaten sto uendret — en feil som
	 * bare kan oppdages, ikke oppleves. Kortet kjører derfor kjeden.
	 *
	 * Kortet leder med hvorfor, som `EffortReprojectCard`: en knapp som heter
	 * «Fyll inn» uten forklaring blir trykket når noe føles rart.
	 */
	import { Button } from '$lib/components/ui';
	import { extractApiErrorMessage } from '$lib/client/api-error';
	import {
		MAX_REPROJECT_WEEKS,
		MIN_REPROJECT_WEEKS,
		type ReprojectComparison
	} from '$lib/domain/health/reproject-window';

	interface BackfillWorkout {
		eventId: string;
		timestamp: string;
		sportType: string | null;
		elapsedSeconds: number | null;
		movingSeconds: number;
		stoppedShare: number;
		medianSampleSeconds: number | null;
	}

	/**
	 * Avvisningsgrunnene i klartekst. «89 ga ikke noe svar» ser ut som ett
	 * problem; det er fire, og bare ett av dem er verdt å gjøre noe med.
	 */
	const REJECTION_LABELS: Record<string, string> = {
		for_tynt_spor: 'sporet er for tynt — punktene ligger for langt fra hverandre til å skille en pause fra et hull',
		for_daarlig_dekning: 'for store hull i sporet',
		for_faa_punkter: 'for få sporpunkter',
		family_uten_bevegelsestid: 'sport uten bevegelsestid (styrke, yoga, svømming)',
		ingen_varighet: 'sporet har ingen varighet',
		ingen_sporpunkter: 'ingen sporpunkter',
		ukjent: 'ukjent grunn'
	};

	/** Rader per kall. Sporene er store, så historikken hentes i biter. */
	const BATCH = 300;
	/** Vakt mot en evig sløyfe hvis serveren skulle slutte å gjøre framgang. */
	const MAX_ROUNDS = 20;

	let running = $state(false);
	let progress = $state<string | null>(null);
	let error = $state<string | null>(null);
	let summary = $state<string | null>(null);
	let wasDryRun = $state(false);
	let worst = $state<BackfillWorkout[]>([]);
	let weekRows = $state<ReprojectComparison[] | null>(null);
	let rejections = $state<Array<{ reason: string; count: number }>>([]);
	let notCovered = $state<string | null>(null);

	function formatDuration(seconds: number | null): string {
		if (!seconds || seconds <= 0) return '–';
		const m = Math.round(seconds / 60);
		if (m < 60) return `${m} min`;
		const h = Math.floor(m / 60);
		const rem = m % 60;
		return rem === 0 ? `${h} t` : `${h} t ${rem} min`;
	}

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' });
	}

	function reset() {
		error = null;
		summary = null;
		worst = [];
		weekRows = null;
		notCovered = null;
		rejections = [];
	}

	function readRejections(data: { rejections?: Record<string, number> }) {
		return Object.entries(data.rejections ?? {})
			.map(([reason, count]) => ({ reason, count }))
			.sort((a, b) => b.count - a.count);
	}

	async function callBackfill(dryRun: boolean) {
		const params = new URLSearchParams({ limit: String(BATCH) });
		if (dryRun) params.set('dryRun', 'true');
		const res = await fetch(`/api/helse/trening/bevegelsestid?${params}`, { method: 'POST' });
		if (!res.ok) throw new Error(extractApiErrorMessage(res.status, await res.text()));
		return res.json();
	}

	/**
	 * Reprojeksjonsvinduet utledes av den ELDSTE økta backfillen rørte — det er
	 * dit skalaen har flyttet seg. Gulvet på fem uker er ankervinduet pluss
	 * margin, taket er endepunktets egen grense per kjøring.
	 */
	function weeksToCover(oldestIso: string | null): number {
		if (!oldestIso) return MIN_REPROJECT_WEEKS;
		const days = (Date.now() - Date.parse(oldestIso)) / 86_400_000;
		const weeks = Math.ceil(days / 7) + 1;
		return Math.min(MAX_REPROJECT_WEEKS, Math.max(MIN_REPROJECT_WEEKS, weeks));
	}

	async function preview() {
		running = true;
		reset();
		wasDryRun = true;
		try {
			const data = await callBackfill(true);
			worst = data.workouts ?? [];
			rejections = readRejections(data);
			summary =
				data.candidates === 0
					? 'Ingen økter mangler bevegelsestid. Alt som har spor er fylt inn.'
					: `${data.candidates} økter uten bevegelsestid, hvorav ${data.computed} kunne beregnes fra sporet. Ingenting er skrevet.`;
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			running = false;
			progress = null;
		}
	}

	async function run() {
		running = true;
		reset();
		wasDryRun = false;
		try {
			let written = 0;
			let inconclusive = 0;
			let oldest: string | null = null;
			let rounds = 0;

			// Fyller i biter til det ikke er flere kandidater. Uavklarte rader blir
			// stående som kandidater (de får aldri feltet), så sløyfa må stoppe på
			// «ingen framgang», ikke bare på «ingen kandidater».
			while (rounds < MAX_ROUNDS) {
				rounds += 1;
				progress = `Fyller inn bevegelsestid… (bolk ${rounds})`;
				const data = await callBackfill(false);
				written += data.written ?? 0;
				inconclusive = data.inconclusive ?? 0;
				if (data.fromTimestamp && (!oldest || data.fromTimestamp < oldest)) {
					oldest = data.fromTimestamp;
				}
				if (rounds === 1) {
					worst = data.workouts ?? [];
					rejections = readRejections(data);
				}
				if (!data.written || data.candidates < BATCH) break;
			}

			if (written === 0) {
				summary =
					inconclusive > 0
						? `Ingen nye tall. ${inconclusive} økter har spor som ikke kan svare — for få punkter, for dårlig dekning, eller en sport uten bevegelsestid.`
						: 'Ingen økter manglet bevegelsestid. Alt er allerede fylt inn.';
				return;
			}

			const weeks = weeksToCover(oldest);
			if (oldest) {
				const days = (Date.now() - Date.parse(oldest)) / 86_400_000;
				if (days / 7 > MAX_REPROJECT_WEEKS) {
					// Sies med ord framfor å bli oppdaget: reprojeksjonen går bakover
					// fra i dag med et tak per kjøring, så eldre økter fikk nye rådata
					// uten at den lagrede skåren så dem.
					notCovered = `Backfillen rørte økter helt tilbake til ${formatDate(oldest)}, men reberegningen dekker maks ${MAX_REPROJECT_WEEKS} uker per kjøring. Eldre økter har fått bevegelsestid uten at effort-skåren er oppdatert — kjør «Reberegn treningsbelastning» igjen senere om du trenger dem.`;
				}
			}

			progress = `Reberegner effort for ${weeks} uker…`;
			const res = await fetch(`/api/helse/trening/reprojiser?weeks=${weeks}`, { method: 'POST' });
			if (!res.ok) {
				error = extractApiErrorMessage(res.status, await res.text());
				summary = `${written} økter fikk bevegelsestid, men reberegningen feilet. Tallene på Trening-flaten står derfor uendret til den er kjørt.`;
				return;
			}

			const reproj = await res.json();
			weekRows = reproj.weeks ?? [];
			summary = `${written} økter fikk bevegelsestid. ${reproj.canonicalCount} økter reberegnet — samlet effort ${reproj.totalEffortBefore} → ${reproj.totalEffortAfter}.`;
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			running = false;
			progress = null;
		}
	}
</script>

<section class="card">
	<h2>Fyll inn bevegelsestid</h2>
	<p class="meta">
		Varigheten på en økt har vært lengden på <em>opptaket</em>, ikke på innsatsen. Glemmer
		man å avslutte sporingen, teller den døde halen fullt ut — og effort for økter uten
		puls er rent lineær i varighet. En el-sykkeltur på 9 km sto som 2 t 20 min og fikk
		effort 114 der svaret var rundt 20.
	</p>
	<p class="meta">
		Nye økter får bevegelsestid automatisk. Denne regner den ut for de gamle, fra sporet
		som allerede ligger lagret, og reberegner effort etterpå — de to hører sammen, siden
		effort-skåren er lagret og ikke ser nye rådata av seg selv.
	</p>
	<p class="meta">Trygg å kjøre om igjen — den fyller bare hull og sletter ingenting.</p>

	<div class="controls">
		<Button variant="secondary" disabled={running} onClick={preview}>Se hva som skjer</Button>
		<Button disabled={running} onClick={run}>
			{running ? 'Jobber…' : 'Fyll inn og reberegn'}
		</Button>
	</div>

	{#if progress}
		<p class="summary dry">{progress}</p>
	{/if}

	{#if error}
		<p class="err">{error}</p>
	{/if}

	{#if summary}
		<p class="summary" class:dry={wasDryRun}>{summary}</p>
	{/if}

	{#if notCovered}
		<p class="warn">{notCovered}</p>
	{/if}

	{#if rejections.length > 0}
		<ul class="reasons">
			{#each rejections as r (r.reason)}
				<li>{r.count} — {REJECTION_LABELS[r.reason] ?? r.reason}</li>
			{/each}
		</ul>
	{/if}

	{#if worst.length > 0}
		<p class="meta">Størst forskjell mellom opptak og bevegelse:</p>
		<div class="table-scroll">
			<table>
				<thead>
					<tr><th>Dato</th><th>Sport</th><th>Opptak</th><th>I bevegelse</th><th>Punkt&shy;avstand</th></tr>
				</thead>
				<tbody>
					{#each worst.slice(0, 10) as w (w.eventId)}
						<tr>
							<td>{formatDate(w.timestamp)}</td>
							<td>{w.sportType ?? '–'}</td>
							<td class="num">{formatDuration(w.elapsedSeconds)}</td>
							<td class="num" class:down={w.stoppedShare > 0.2}>
								{formatDuration(w.movingSeconds)}
							</td>
							<td class="num">
								{w.medianSampleSeconds === null ? '–' : `${String(w.medianSampleSeconds).replace('.', ',')} s`}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	{#if weekRows && weekRows.length > 0}
		<p class="meta">Effort per uke, før og etter:</p>
		<div class="table-scroll">
			<table>
				<thead>
					<tr><th>Uke</th><th>Før</th><th>Etter</th><th>Endring</th></tr>
				</thead>
				<tbody>
					{#each weekRows as row (row.weekStart)}
						<tr>
							<td>{row.weekStart}</td>
							<td class="num">{row.before}</td>
							<td class="num">{row.after}</td>
							<td class="num" class:down={(row.deltaPct ?? 0) < 0}>
								{row.deltaPct === null
									? '—'
									: `${row.deltaPct > 0 ? '+' : ''}${String(row.deltaPct).replace('.', ',')} %`}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
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

	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}

	.reasons {
		margin: 0;
		padding-left: 1.1rem;
		font-size: 0.8rem;
		color: var(--text-secondary, #aaa);
		line-height: 1.5;
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

	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.down {
		color: #6ee7b7;
	}
</style>
