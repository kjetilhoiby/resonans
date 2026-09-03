<script lang="ts">
	/**
	 * «Hvilke år er pulsdata til å stole på?»
	 *
	 * Står ved siden av `WorkoutReanalyzeCard` og `EffortReprojectCard`, og finnes
	 * av samme grunn: den som skal svare på spørsmålet sitter på telefonen. Et
	 * endepunkt som bare nås med en curl fra en maskin er i praksis ikke
	 * tilgjengelig i det øyeblikket.
	 *
	 * Rent lesende — kortet har ingen knapp som endrer noe. Det er en diagnose før
	 * en arkivimport, ikke en jobb.
	 *
	 * ## To lag, og de summerer ikke
	 *
	 * Standard leser bare skalarene (snitt- og makspuls fra hele historikken, én
	 * lett spørring). «Sjekk kurvene også» henter et UTVALG spor per år og er
	 * dyrere. Utvalgstallene har sin egen nevner og står derfor for seg, aldri
	 * lagt til antallet mistenkelige økter.
	 */
	import { Button } from '$lib/components/ui';
	import { extractApiErrorMessage } from '$lib/client/api-error';
	import type { HrTrustPeriod } from '$lib/domain/health/hr-trust-periods';

	interface Report {
		baseline: { restHr: number; maxHr: number; maxHrSource: string | null };
		periods: HrTrustPeriod[];
		text: string[];
		curveSample: { perPeriod: number; maxTotal: number; requested: number; loaded: number };
	}

	let report = $state<Report | null>(null);
	let running = $state(false);
	let error = $state<string | null>(null);
	let sampledCurves = $state(false);

	const SEVERITY_LABELS: Record<HrTrustPeriod['severity'], string> = {
		ren: 'ingen funn',
		enkeltavvik: 'enkeltavvik',
		utbredt: 'ikke til å stole på',
		'for-lite-data': 'for lite data'
	};

	async function load(curves: boolean) {
		running = true;
		error = null;
		try {
			const res = await fetch(
				`/api/helse/trening/pulstillit${curves ? '?curves=true' : ''}`
			);
			if (!res.ok) {
				// Meldingen VISES — se CLAUDE.md om serverfeil-synlighet.
				error = extractApiErrorMessage(res.status, await res.text());
				return;
			}
			report = await res.json();
			sampledCurves = curves;
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			running = false;
		}
	}
</script>

<section class="card">
	<h2>Pulsdata per år</h2>
	<p class="meta">
		Et ødelagt pulsbelte gir tall som ser ut som trening: en kurve som låser seg høyt blir
		100 % sone 5 og hele økta som kvalitetsminutter. Før historikk importeres er spørsmålet
		hvilke år pulsen er til å stole på.
	</p>

	<div class="controls">
		<Button variant="secondary" disabled={running} onClick={() => load(false)}>
			{running ? 'Leser…' : 'Sjekk årene'}
		</Button>
		<Button variant="secondary" disabled={running} onClick={() => load(true)}>
			Sjekk kurvene også
		</Button>
	</div>

	{#if error}
		<p class="err">{error}</p>
	{/if}

	{#if report}
		<p class="meta">
			Sonene er regnet mot hvilepuls {report.baseline.restHr} og makspuls
			{report.baseline.maxHr}{report.baseline.maxHrSource
				? ` (${report.baseline.maxHrSource})`
				: ''}.
		</p>

		{#if report.periods.length > 0}
			<ul class="years">
				{#each report.periods as period (period.period)}
					<li class="year">
						<span class="label">{period.period}</span>
						<span class="verdict" data-severity={period.severity}>
							{SEVERITY_LABELS[period.severity]}
						</span>
						<span class="counts">
							{period.suspect} av {period.withHr}
							{#if period.peakHr}· topp {period.peakHr}{/if}
							{#if period.curvesSampled > 0}
								· {period.curvesRejected}/{period.curvesSampled} kurver forkastet
							{/if}
						</span>
					</li>
				{/each}
			</ul>
		{/if}

		<!-- Setningene kommer fra domenelaget, inkludert forbeholdet om blindsonen:
		     flatens ord skal ikke kunne gå fra sannheten om tallet. -->
		{#each report.text as line}
			<p class="note">{line}</p>
		{/each}

		{#if !sampledCurves}
			<p class="note">
				Dette er bare snitt- og makspuls. «Sjekk kurvene også» henter opptil
				{report.curveSample.perPeriod} spor per år og ser etter fastlåste kurver og
				ufysiologiske hopp — tregere, men det er der et belte som låser seg under 220
				avslører seg.
			</p>
		{/if}
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

	.years {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.year {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.5rem;
		font-size: 0.85rem;
	}

	.label {
		font-variant-numeric: tabular-nums;
		font-weight: 700;
		color: var(--text-primary, #eee);
		min-width: 3.2rem;
	}

	/* Bare «ikke til å stole på» får varselfarge. Et enkeltavvik er noe å se på,
	   ikke noe galt — samme regel som at bare akutt/kronisk får rødt. */
	.verdict[data-severity='utbredt'] {
		color: #f87171;
	}

	.verdict[data-severity='enkeltavvik'] {
		color: #fbbf24;
	}

	.verdict[data-severity='ren'],
	.verdict[data-severity='for-lite-data'] {
		color: var(--text-secondary, #aaa);
	}

	.counts {
		font-size: 0.78rem;
		color: var(--text-secondary, #aaa);
		font-variant-numeric: tabular-nums;
	}

	.note {
		margin: 0;
		font-size: 0.8rem;
		color: var(--text-secondary, #aaa);
		line-height: 1.5;
	}

	.err {
		margin: 0;
		font-size: 0.82rem;
		color: #f87171;
		line-height: 1.5;
	}
</style>
