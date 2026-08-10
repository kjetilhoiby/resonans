<script lang="ts">
	/**
	 * Reberegner lagrede effort-skår fra gjeldende modell.
	 *
	 * Hører på kilde-sida fordi den er i slekt med backfill-kontrollene: en handling
	 * som skriver om historikk framfor å endre en innstilling.
	 *
	 * Kortet leder med **hvorfor** framfor med knappen. En knapp som heter «Reberegn»
	 * uten forklaring blir trykket når noe føles rart, og det er ikke det den er til.
	 */
	import { Button, Select } from '$lib/components/ui';
	import { extractApiErrorMessage } from '$lib/client/api-error';

	interface WeekRow {
		weekStart: string;
		before: number;
		after: number;
		deltaPct: number | null;
	}
	interface Baseline {
		restHr: number;
		maxHr: number;
		restHrSource: string | null;
		maxHrSource: string | null;
		derived: boolean;
	}

	let weeks = $state('8');
	let running = $state(false);
	let error = $state<string | null>(null);
	let baseline = $state<Baseline | null>(null);
	let rows = $state<WeekRow[] | null>(null);
	let summary = $state<string | null>(null);
	let wasDryRun = $state(false);

	/**
	 * Makspulsen er hele poenget med å kjøre jobben, så kilden må vises.
	 *
	 * `observed` betyr at fødselsåret mangler i kroppsprofilen — da bruker modellen
	 * observerte topper, som er et gulv og ikke et tak, og reberegningen blir en
	 * no-op som ser fullført ut. Det er den ene feilen dette kortet finnes for å
	 * gjøre synlig.
	 */
	const maxHrWarning = $derived.by(() => {
		const source = baseline?.maxHrSource;
		if (!source || source === 'manual' || source === 'age') return null;
		if (source === 'observed') {
			return 'Makspulsen kommer fra observerte treningstopper, ikke fra alderen din. Da mangler fødselsåret i kroppsprofilen — sett det under Profil, eller oppgi makspulsen din direkte i metrikk-arket på Helse. Uten det endrer reberegningen lite.';
		}
		return `Makspulsen kommer fra «${source}», altså en nødløsning. Oppgi den i metrikk-arket på Helse for et tall som stemmer.`;
	});

	const maxHrSourceLabel = $derived.by(() => {
		switch (baseline?.maxHrSource) {
			case 'manual':
				return 'din egen verdi';
			case 'age':
				return 'alderen din';
			case 'observed':
				return 'observerte topper';
			case 'avg_proxy':
				return 'snittpuls (svakt anslag)';
			default:
				return 'standardverdi';
		}
	});

	async function run(dryRun: boolean) {
		running = true;
		error = null;
		try {
			const params = new URLSearchParams({ weeks });
			if (dryRun) params.set('dryRun', 'true');
			const res = await fetch(`/api/helse/trening/reprojiser?${params}`, { method: 'POST' });

			if (!res.ok) {
				// Meldingen VISES. Et generisk «noe gikk galt» her ville gjort en
				// prod-feil uløselig — se CLAUDE.md om serverfeil-synlighet.
				error = extractApiErrorMessage(res.status, await res.text());
				return;
			}

			const data = await res.json();
			baseline = data.baseline ?? null;
			wasDryRun = dryRun === true;

			if (dryRun) {
				rows = null;
				const økter = data.workoutsInRange ?? 0;
				summary = `${økter} økter i vinduet. Ingenting er skrevet ennå.`;
			} else {
				rows = data.weeks ?? [];
				summary = `${data.canonicalCount} økter reberegnet. Samlet effort ${data.totalEffortBefore} → ${data.totalEffortAfter}.`;
			}
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			running = false;
		}
	}
</script>

<section class="card">
	<h2>Reberegn treningsbelastning</h2>
	<p class="meta">
		Effort-skåren lagres per økt, så en endring i modellen — makspuls, kalibrering — gjelder
		bare nye økter. Ukesbåndet ankres på snittet av de siste fire ukene fra de lagrede
		tallene, så gammel og ny skala kan bli sammenlignet uten at noe sier fra. Denne
		reberegner vinduet med dagens modell.
	</p>
	<p class="meta">Trygg å kjøre om igjen — samme modell gir samme tall.</p>

	<div class="controls">
		<Select bind:value={weeks} ariaLabel="Hvor langt tilbake" dataTrack="reberegn-effort:vindu">
			<option value="8">8 uker (anbefalt)</option>
			<option value="12">12 uker</option>
			<option value="26">26 uker</option>
		</Select>
		<!-- Knappene har beskrivende tekst, så teksten blir label i brukslogginga. -->
		<Button variant="secondary" disabled={running} onClick={() => run(true)}>Se hva som skjer</Button>
		<Button disabled={running} onClick={() => run(false)}>
			{running ? 'Jobber…' : 'Reberegn'}
		</Button>
	</div>

	{#if error}
		<p class="err">{error}</p>
	{/if}

	{#if baseline}
		<p class="baseline">
			Makspuls <strong>{baseline.maxHr}</strong> fra {maxHrSourceLabel} · hvilepuls
			<strong>{baseline.restHr}</strong>
		</p>
		{#if maxHrWarning}
			<p class="warn">{maxHrWarning}</p>
		{/if}
	{/if}

	{#if summary}
		<p class="summary" class:dry={wasDryRun}>{summary}</p>
	{/if}

	{#if rows && rows.length > 0}
		<div class="table-scroll">
			<table>
				<thead>
					<tr><th>Uke</th><th>Før</th><th>Etter</th><th>Endring</th></tr>
				</thead>
				<tbody>
					{#each rows as row (row.weekStart)}
						<tr>
							<td>{row.weekStart}</td>
							<td class="num">{row.before}</td>
							<td class="num">{row.after}</td>
							<td class="num" class:down={(row.deltaPct ?? 0) < 0}>
								{row.deltaPct === null ? '—' : `${row.deltaPct > 0 ? '+' : ''}${String(row.deltaPct).replace('.', ',')} %`}
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

	.baseline {
		margin: 0;
		font-size: 0.85rem;
		color: var(--text-primary, #eee);
	}

	.summary {
		margin: 0;
		font-size: 0.85rem;
		color: var(--text-primary, #eee);
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
