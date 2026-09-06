<script lang="ts">
	/**
	 * «Fiks treningshistorikk» — én knapp som kjører alle stegene i riktig
	 * rekkefølge, fra tidens morgen.
	 *
	 * ## Hvorfor kortet finnes
	 *
	 * Å reparere treningshistorikken krevde fram til september 2026 at brukeren
	 * visste tre ting ingen flate sa:
	 *
	 * 1. At det er TO rørledninger med nesten samme navn — «Reberegn
	 *    treningsbelastning» bygger `canonical_workouts`, mens periodetabellen
	 *    leser `sensor_aggregates`, som bare aggregeringen skriver.
	 * 2. At rekkefølgen er bindende: aggregeringen LESER canonical, så en
	 *    aggregering før reparasjonen baker hullet inn i månedsradene.
	 * 3. At spennet per reberegning er 26 uker, og at et eldre hull derfor må
	 *    nås ved å flytte vinduet med et sluttpunkt.
	 *
	 * Konsekvensen var målbar: brukeren kjørte «Reberegn» og «Aggreger alt», og
	 * begge sa at de var ferdige, mens hullet i januar–februar sto igjen. Feilen
	 * er stum i alle ledd. Kortet legger rekkefølgen i koden.
	 *
	 * ## Hvorfor løkka går i klienten
	 *
	 * Samme mønster som `WorkoutReanalyzeCard`: en serverside-løkke over tolv år
	 * ville truffet svartidsgrensa, og en halvferdig jobb uten framdriftstall er
	 * verre enn en som teller. Serveren PLANLEGGER (`GET
	 * /api/helse/trening/fiks-historikk`), klienten kjører.
	 *
	 * Vinduene kjøres NYESTE FØRST. Rekkefølgen betyr ingenting for
	 * korrektheten, men en kjøring som avbrytes skal ha reparert den enden
	 * brukeren faktisk ser på.
	 */
	import { Button } from '$lib/components/ui';
	import { extractApiErrorMessage } from '$lib/client/api-error';

	interface RepairWindow {
		index: number;
		weeks: number;
		until: string | null;
		fromDay: string;
		toDay: string;
	}
	interface Plan {
		windows: RepairWindow[];
		historyStartDay: string;
		truncated: boolean;
		uncoveredBeforeDay: string | null;
	}
	interface PlanResponse {
		hasHistory: boolean;
		message?: string;
		history?: { firstDay: string; lastDay: string | null; events: number };
		canonical?: { firstDay: string | null; lastDay: string | null; rows: number };
		plan?: Plan;
	}

	let plan = $state<PlanResponse | null>(null);
	let loadingPlan = $state(false);
	let running = $state(false);
	let error = $state<string | null>(null);

	/** Hvor langt løkka har kommet, og hva den fant. */
	let doneWindows = $state(0);
	let totalWindows = $state(0);
	let currentLabel = $state<string | null>(null);
	let canonicalWritten = $state(0);
	/**
	 * Uker som gikk fra 0 til noe.
	 *
	 * Det er hullene, tallfestet — den ENE observasjonen som skiller «jobben
	 * kjørte» fra «jobben gjorde noe». Kjent begrensning: en uke der alle øktene
	 * mangler effort-skår leser 0 → 0 og telles ikke, så tallet er et gulv.
	 */
	let filledWeeks = $state<string[]>([]);
	let phase = $state<'idle' | 'canonical' | 'aggregate' | 'done'>('idle');

	async function loadPlan() {
		loadingPlan = true;
		error = null;
		try {
			const res = await fetch('/api/helse/trening/fiks-historikk');
			if (!res.ok) {
				error = extractApiErrorMessage(res.status, await res.text());
				return;
			}
			plan = await res.json();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			loadingPlan = false;
		}
	}

	async function run() {
		const windows = plan?.plan?.windows;
		if (!windows || windows.length === 0) return;

		running = true;
		error = null;
		phase = 'canonical';
		doneWindows = 0;
		totalWindows = windows.length;
		canonicalWritten = 0;
		filledWeeks = [];

		try {
			// Fase 1: canonical_workouts, vindu for vindu.
			for (const window of windows) {
				currentLabel = `${window.fromDay} – ${window.toDay}`;
				const params = new URLSearchParams({ weeks: String(window.weeks) });
				if (window.until) params.set('until', window.until);

				const res = await fetch(`/api/helse/trening/reprojiser?${params}`, { method: 'POST' });
				if (!res.ok) {
					// Meldingen VISES, og framdriften står — en halvferdig reparasjon
					// er ikke skadelig (hvert vindu er idempotent), men den som kjørte
					// den må kunne se hvor langt den kom.
					error = `Stoppet på vinduet ${currentLabel}: ${extractApiErrorMessage(res.status, await res.text())}`;
					return;
				}

				const data = await res.json();
				canonicalWritten += Number(data.canonicalCount ?? 0);
				for (const week of (data.weeks ?? []) as {
					weekStart: string;
					before: number;
					after: number;
				}[]) {
					if (week.before === 0 && week.after > 0) filledWeeks = [...filledWeeks, week.weekStart];
				}
				doneWindows += 1;
			}

			// Fase 2: sensor_aggregates. MÅ komme etter fase 1 — aggregeringen leser
			// canonical, så en aggregering før reparasjonen baker hullet inn i
			// månedsradene og blir stående der.
			phase = 'aggregate';
			currentLabel = 'Aggregerer uker, måneder og år';
			const aggRes = await fetch('/api/sensors/aggregate', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{}'
			});
			if (!aggRes.ok) {
				error = `Canonical er reparert, men aggregeringen feilet: ${extractApiErrorMessage(aggRes.status, await aggRes.text())}. Periodetabellen står da på gamle tall — kjør «Aggreger alt» under Jobber.`;
				return;
			}

			phase = 'done';
			currentLabel = null;
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			running = false;
		}
	}

	/** Differansen mellom rå historikk og canonical er selve funnet. */
	const gapNote = $derived.by(() => {
		const first = plan?.history?.firstDay;
		const canonicalFirst = plan?.canonical?.firstDay;
		if (!first) return null;
		if (!canonicalFirst) {
			return `Historikken begynner ${first}, men det finnes ingen rader i canonical_workouts i det hele tatt. Alt må bygges.`;
		}
		if (canonicalFirst > first) {
			return `Historikken begynner ${first}, men canonical_workouts starter først ${canonicalFirst}. Radene før det mangler.`;
		}
		return `Historikken begynner ${first}, og canonical_workouts dekker fra ${canonicalFirst}. Hull LENGRE INNE i serien ser man ikke her — kjøringen bygger dem opp igjen uansett.`;
	});
</script>

<section class="card">
	<h2>Fiks treningshistorikk</h2>
	<p class="meta">
		Bygger treningshistorikken opp igjen fra den eldste økta du har, i riktig
		rekkefølge: først <code>canonical_workouts</code> (som «Akkumulert løping» og
		formkurven leser), deretter aggregatene (som periodetabellen leser). Rekkefølgen
		er bindende — aggregeringen leser canonical, så motsatt vei baker et hull inn i
		månedsradene.
	</p>
	<p class="meta">
		Trygg å kjøre om igjen. Den skriver ingenting nytt: samme økter inn gir samme
		tall ut. Tar tid — hvert vindu på 26 uker laster pulskurven for hver løpeøkt i
		det.
	</p>

	<div class="controls">
		<Button variant="secondary" disabled={loadingPlan || running} onClick={loadPlan}>
			{loadingPlan ? 'Ser etter…' : 'Se hva som må gjøres'}
		</Button>
		{#if plan?.plan?.windows?.length}
			<Button disabled={running} onClick={run}>
				{running ? 'Jobber…' : 'Fiks treningshistorikk'}
			</Button>
		{/if}
	</div>

	{#if error}
		<p class="err">{error}</p>
	{/if}

	{#if plan && !plan.hasHistory}
		<p class="summary">{plan.message}</p>
	{/if}

	{#if plan?.plan}
		{#if gapNote}
			<p class="summary">{gapNote}</p>
		{/if}
		<p class="meta">
			{plan.plan.windows.length}
			{plan.plan.windows.length === 1 ? 'vindu' : 'vinduer'} à {plan.plan.windows[0]?.weeks} uker,
			nyeste først. {plan.canonical?.rows ?? 0} rader i canonical i dag.
		</p>
		{#if plan.plan.truncated}
			<p class="warn">
				Planen rekker bare tilbake til {plan.plan.uncoveredBeforeDay}. Den eldste økta er
				datert {plan.plan.historyStartDay} — er det et ødelagt tidsstempel, hører det å
				rettes framfor å utvide planen.
			</p>
		{/if}
	{/if}

	{#if running || phase === 'done'}
		<div class="progress">
			<p class="summary">
				{#if phase === 'canonical'}
					Bygger canonical: vindu {doneWindows + 1} av {totalWindows}
				{:else if phase === 'aggregate'}
					Canonical ferdig ({canonicalWritten} økter). Aggregerer perioder…
				{:else}
					Ferdig. {canonicalWritten} økter skrevet til canonical, og aggregatene er bygget
					på nytt.
				{/if}
			</p>
			{#if currentLabel}
				<p class="meta">{currentLabel}</p>
			{/if}
			<div class="bar" role="progressbar" aria-valuenow={doneWindows} aria-valuemax={totalWindows}>
				<div
					class="fill"
					style:width={`${totalWindows === 0 ? 0 : Math.round((doneWindows / totalWindows) * 100)}%`}
				></div>
			</div>
		</div>
	{/if}

	{#if filledWeeks.length > 0}
		<p class="found">
			{filledWeeks.length}
			{filledWeeks.length === 1 ? 'uke' : 'uker'} gikk fra tom til å ha økter — det var hullene.
			Uker: {filledWeeks.join(', ')}
		</p>
	{:else if phase === 'done'}
		<p class="meta">
			Ingen uke gikk fra tom til å ha økter. Historikken var altså hel — eller hullet
			ligger i uker der øktene mangler effort-skår, som ikke kan skilles fra tomme uker
			her.
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

	.found {
		margin: 0;
		font-size: 0.85rem;
		color: #6ee7b7;
		line-height: 1.5;
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

	.progress {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.bar {
		height: 6px;
		border-radius: 3px;
		background: var(--card-border, #242424);
		overflow: hidden;
	}

	.fill {
		height: 100%;
		background: #3987e5;
		transition: width 0.2s ease;
	}
</style>
