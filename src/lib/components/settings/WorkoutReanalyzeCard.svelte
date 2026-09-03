<script lang="ts">
	/**
	 * Etterfyller analytics som mangler på lagrede løpeøkter.
	 *
	 * Hører ved siden av `EffortReprojectCard`: begge skriver om historikk framfor
	 * å endre en innstilling, og begge finnes fordi et lagret tall ikke oppdaterer
	 * seg selv når modellen endres.
	 *
	 * ## Hvorfor kortet finnes framfor et curl-kall
	 *
	 * Jobben kjøres når et NYTT felt er lagt til — tidsdelingen rolig/grå/kvalitet,
	 * september 2026 — og det skjer etter at flaten som viser feltet er ute. Den som
	 * ser den tomme grafen sitter på telefonen. Et endepunkt som bare kan nås med en
	 * POST fra en maskin er i praksis ikke tilgjengelig i det øyeblikket.
	 *
	 * ## Løkka går i klienten, med vilje
	 *
	 * Batchene er små fordi trackPoints er tunge (ett spor kan være 2000 punkter), og
	 * ni år med løping i ett kall ville lastet alle sporene samtidig. Kortet kaller
	 * derfor endepunktet om igjen med `nextBefore`-markøren til den er null. En
	 * serverside-løkke ville truffet svartidsgrensa i stedet, og en halvferdig jobb
	 * uten framdriftstall er verre enn en som teller.
	 */
	import { Button } from '$lib/components/ui';
	import { extractApiErrorMessage } from '$lib/client/api-error';

	interface Props {
		/**
		 * Feltet som skal etterfylles. Standard er tidsdelingen, som er den ferskeste
		 * — og den eneste som er tom for hele historikken.
		 */
		field?: 'intensitySplit' | 'hrZoneDistribution' | 'bestEfforts';
	}

	let { field = 'intensitySplit' }: Props = $props();

	const FIELD_LABELS: Record<NonNullable<Props['field']>, string> = {
		intensitySplit: 'tidsdeling (rolig / i midten / kvalitet)',
		hrZoneDistribution: 'sonefordeling',
		bestEfforts: 'distanserekorder'
	};

	/**
	 * Taket på antall runder. En markørløkke terminerer av seg selv, men en bug i
	 * markøren ville ellers gitt uendelig med kall fra en telefon i lomma.
	 */
	const MAX_ROUNDS = 60;

	let outstanding = $state<number | null>(null);
	let running = $state(false);
	let error = $state<string | null>(null);
	let analyzed = $state(0);
	let skipped = $state(0);
	let rounds = $state(0);
	let done = $state(false);
	let maxHrSource = $state<string | null>(null);

	/** Tellingen alene. Deles av knappen og av oppfrisken etter en jobb. */
	async function fetchOutstanding(): Promise<void> {
		const res = await fetch(`/api/sensors/workouts/reanalyze?missing=${field}&dryRun=true`, {
			method: 'POST'
		});
		if (!res.ok) {
			// Meldingen VISES — se CLAUDE.md om serverfeil-synlighet.
			error = extractApiErrorMessage(res.status, await res.text());
			return;
		}
		const data = await res.json();
		outstanding = data.outstanding ?? 0;
	}

	async function check() {
		running = true;
		error = null;
		done = false;
		try {
			await fetchOutstanding();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			running = false;
		}
	}

	async function run() {
		running = true;
		error = null;
		done = false;
		analyzed = 0;
		skipped = 0;
		rounds = 0;
		try {
			let before: string | null = null;
			for (let round = 0; round < MAX_ROUNDS; round += 1) {
				const params = new URLSearchParams({ missing: field });
				if (before) params.set('before', before);
				const res = await fetch(`/api/sensors/workouts/reanalyze?${params}`, {
					method: 'POST'
				});
				if (!res.ok) {
					error = extractApiErrorMessage(res.status, await res.text());
					return;
				}
				const data = await res.json();
				// Tallene oppdateres per runde, ikke til slutt: på en telefon over
				// mobilnett tar dette tid, og en knapp som bare står og spinner ser
				// ut som at den henger.
				analyzed += data.analyzed ?? 0;
				skipped += data.skipped ?? 0;
				rounds = round + 1;
				outstanding = data.outstanding ?? outstanding;
				if (data.baseline?.maxHrSource) maxHrSource = data.baseline.maxHrSource;
				before = data.nextBefore ?? null;
				if (!before) break;
			}
			// Fasit etter jobben: `outstanding` fra siste runde er tellingen FØR den
			// runden skrev, så den ville sagt at det står igjen flere enn det gjør.
			await fetchOutstanding();
			done = true;
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			running = false;
		}
	}
</script>

<section class="card">
	<h2>Etterfyll øktanalyse</h2>
	<p class="meta">
		Analysen av en økt lagres på økta, så et felt vi legger til i ettertid er tomt for all
		historikk — flaten viser ingenting før jobben har gått. Nå gjelder det
		{FIELD_LABELS[field]}.
	</p>
	<p class="meta">
		Trygg å kjøre om igjen: bare økter som mangler feltet røres, og samme spor gir samme
		tall. Økter uten pulskurve kan ikke fylles og blir stående — de telles som «uten data».
	</p>

	<div class="controls">
		<Button variant="secondary" disabled={running} onClick={check}>Se hvor mange</Button>
		<Button disabled={running} onClick={run}>
			{running ? `Jobber… ${analyzed} ferdig` : 'Etterfyll nå'}
		</Button>
	</div>

	{#if error}
		<p class="err">{error}</p>
	{/if}

	{#if outstanding !== null && !running && !done}
		<p class="summary">
			{#if outstanding === 0}
				Ingen økter mangler {FIELD_LABELS[field]}.
			{:else}
				{outstanding} {outstanding === 1 ? 'økt mangler' : 'økter mangler'}
				{FIELD_LABELS[field]}.
			{/if}
		</p>
	{/if}

	{#if done}
		<p class="summary">
			{analyzed} {analyzed === 1 ? 'økt' : 'økter'} analysert over {rounds}
			{rounds === 1 ? 'runde' : 'runder'}.
			{#if skipped > 0}
				{skipped} uten brukbare data.
			{/if}
			{#if outstanding !== null && outstanding > 0}
				<span class="dim"
					>{outstanding} står igjen — de har ingen pulskurve å dele opp, og en ny runde
					endrer det ikke.</span
				>
			{/if}
		</p>
		{#if rounds >= MAX_ROUNDS}
			<p class="warn">
				Stoppet på {MAX_ROUNDS} runder. Trykk igjen for å fortsette der jobben sto.
			</p>
		{/if}
	{/if}

	{#if maxHrSource === 'observed'}
		<!-- Samme feil som `EffortReprojectCard` finnes for: soner er definert av
		     makspulsen, så et anslag fra observerte topper gjør analysen ferdig og
		     feil samtidig. Ti slag feil flytter Z2-båndet ~7 slag. -->
		<p class="warn">
			Makspulsen er utledet fra observerte treningstopper, ikke fra alderen din. Sonene —
			og dermed tidsdelingen — er da et anslag. Sett fødselsår under Profil, eller
			makspuls i metrikk-arket på Helse, og kjør jobben om igjen.
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

	.dim {
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
</style>
