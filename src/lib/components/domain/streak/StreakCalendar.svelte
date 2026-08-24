<!--
  StreakCalendar — én måned med dagene streaken faktisk holdt.

  ## Hvorfor den ikke er MonthCalendar

  `ui/MonthCalendar.svelte` finnes, men den er dagbokas datovelger: markerte dager
  er de eneste trykkbare, markøren er en prikk under datotallet, og etikettene sier
  «meldinger». Her er ingenting trykkbart, cellen SELV er markøren (en rekke fylte
  celler er formen på en streak), og radene bærer periodens fasit. Å presse begge
  uttrykkene inn i én komponent ville kostet fire props og en layoutvariant for å
  spare tjue linjer markup.

  Den delte matematikken — mandag-ankrede uker og norske månedsnavn — er felles
  gjennom `$lib/domain/month-grid`, og det er der duplisering faktisk hadde gjort
  vondt.

  ## Hva cellene sier

  Fylt = hendelse den dagen. Tallet i marken er datoen, ikke antallet: antallet står
  som en ekstra ring når det er mer enn én (to løpeturer samme dag), og i lesningen
  under kalenderen. I dag har ramme. Framtidige dager er tomme uten å være «glemt» —
  en dag som ikke har vært, kan ikke være brutt.

  ## To akser, to kanaler

  Har dagen distanse og tempo, bærer fargen dem:

    lyshet = tempo      lyst er fort, mørkt er rolig
    kulør  = distanse   gult er kort, rødt er langt

  Det er poenget med kalenderen — å se forbi «møtte opp». Feltet bor i
  `workout-day-scale.ts`.

  Cellene har FAST størrelse. Første utgave lot distansen slå ut i arealet også, og
  det gjorde tempo-aksen usynlig: to kanaler som beveger seg sammen viser bare
  diagonalen, og en størrelsesforskjell skriker høyere enn en lyshetsforskjell.

  Verdien er aldri bare farge: trykk på en dag skriver tallene under kalenderen. På
  en telefon finnes ingen hover, så en `title` alene ville gjort tallene utilgjengelige.
-->
<script lang="ts">
	import Icon from '../../ui/Icon.svelte';
	import { WEEKDAY_INITIALS, addMonths } from '$lib/domain/month-grid';
	import { buildStreakCalendar, type StreakHistoryDay } from '$lib/domain/streak-history';
	import type { StreakConfig, StreakRule } from '$lib/domain/streaks';
	import {
		dayVisual,
		legendSamples,
		type DayScale,
		type WorkoutDayMetrics
	} from '$lib/domain/health/workout-day-scale';
	import { formatPaceOrSpeed, paceOrSpeedLabel } from '$lib/utils/activity-metrics';

	interface Props {
		/** «YYYY-MM» — måneden som vises. Bindes, så forelderen kan lese den. */
		month: string;
		days: StreakHistoryDay[];
		todayKey: string;
		rule: StreakRule;
		config: StreakConfig;
		/** Aksentfargen streaken har ellers i appen. */
		color?: string;
		/** Eldste måned det er noe å se på. Navigasjonen stopper der. */
		earliestMonth?: string | null;
		/** Distanse og tempo per dag. Uten dette viser kalenderen ren tilstedeværelse. */
		dayMetrics?: WorkoutDayMetrics[] | null;
		/** Spennet dagene fargelegges mot. `usable: false` slår av fargeleggingen. */
		scale?: DayScale | null;
		/** Idretten, så lesningen sier «tempo» eller «fart». */
		sportFamily?: string | null;
	}

	let {
		month = $bindable(),
		days,
		todayKey,
		rule,
		config,
		color = 'var(--warning-text)',
		earliestMonth = null,
		dayMetrics = null,
		scale = null,
		sportFamily = null
	}: Props = $props();

	const metricsByDate = $derived(new Map((dayMetrics ?? []).map((m) => [m.date, m])));
	/** Fargelegges dagene? Krever både tall og en brukbar fordeling å måle mot. */
	const scaled = $derived(scale?.usable === true && (dayMetrics?.length ?? 0) > 0);
	const legend = $derived(legendSamples());

	/** Dagen brukeren har trykket på. Tallene skal finnes uten hover. */
	let selected = $state<string | null>(null);

	const selectedRead = $derived.by(() => {
		if (!selected) return null;
		const metrics = metricsByDate.get(selected);
		const count = metrics?.count ?? 0;
		const parts = [`${count} ${count === 1 ? 'økt' : 'økter'}`];
		if (metrics?.distanceKm) parts.push(`${metrics.distanceKm.toFixed(1).replace('.', ',')} km`);
		if (metrics?.paceSecPerKm) {
			parts.push(formatPaceOrSpeed(sportFamily ?? '', metrics.paceSecPerKm));
		}
		return { date: selected, text: parts.join(' · ') };
	});

	function visualFor(date: string, count: number) {
		if (count <= 0) return null;
		if (!scaled || !scale) return null;
		return dayVisual(metricsByDate.get(date) ?? { date, count, distanceKm: null, paceSecPerKm: null }, scale);
	}

	const calendar = $derived(buildStreakCalendar({ month, days, todayKey, rule, config }));
	const thisMonth = $derived(todayKey.slice(0, 7));
	const canGoBack = $derived(!earliestMonth || month > earliestMonth);
	const canGoForward = $derived(month < thisMonth);

	function dayTitle(count: number, date: string): string {
		if (count === 0) return date;
		return `${date}: ${count} ${count === 1 ? 'gang' : 'ganger'}`;
	}
</script>

<div class="sc" style="--c:{color}">
	<div class="sc-nav">
		<button
			class="sc-nav-btn"
			aria-label="Forrige måned"
			disabled={!canGoBack}
			data-track="streak-historikk:forrige-maaned"
			onclick={() => (month = addMonths(month, -1))}
		>
			<Icon name="back" size={16} />
		</button>
		<span class="sc-title">{calendar.title}</span>
		<button
			class="sc-nav-btn"
			aria-label="Neste måned"
			disabled={!canGoForward}
			data-track="streak-historikk:neste-maaned"
			onclick={() => (month = addMonths(month, 1))}
		>
			<Icon name="forward" size={16} />
		</button>
	</div>

	<div class="sc-weekdays" aria-hidden="true">
		{#each WEEKDAY_INITIALS as initial, i (i)}
			<span class="sc-weekday">{initial}</span>
		{/each}
		<span class="sc-weekday sc-week-col"></span>
	</div>

	<div class="sc-rows">
		{#each calendar.rows as row, ri (ri)}
			<div class="sc-row">
				{#each row.cells as cell, ci (ci)}
					{#if cell}
						{@const visual = visualFor(cell.date, cell.count)}
						<!-- Trykkflaten er hele cella, ikke marken: en mark på 52 % er 21 px,
						     altså under minstemålet for en trykkflate. -->
						<svelte:element
							this={cell.count > 0 ? 'button' : 'div'}
							class="sc-day"
							class:is-done={cell.count > 0}
							class:is-multi={cell.count > 1}
							class:is-today={cell.isToday}
							class:is-future={cell.isFuture}
							class:is-selected={selected === cell.date}
							class:is-plain={cell.count > 0 && !visual}
							role={cell.count > 0 ? 'button' : undefined}
							aria-pressed={cell.count > 0 ? selected === cell.date : undefined}
							title={dayTitle(cell.count, cell.date)}
							onclick={cell.count > 0
								? () => (selected = selected === cell.date ? null : cell.date)
								: undefined}
						>
							<span
								class="sc-mark"
								style={visual ? `--f:${visual.fill}; --ink:${visual.ink}` : undefined}
							>
								{Number(cell.date.slice(8))}
							</span>
						</svelte:element>
					{:else}
						<span class="sc-day sc-day-empty"></span>
					{/if}
				{/each}

				<!-- Periodens fasit står i sin egen kolonne, på raden den gjelder. -->
				<span class="sc-week-col">
					{#if row.window}
						<span
							class="sc-week"
							class:is-met={row.window.met}
							title={`${row.window.count} av ${row.window.target} denne perioden`}
						>
							{row.window.met ? '✓' : `${row.window.count}/${row.window.target}`}
						</span>
					{/if}
				</span>
			</div>
		{/each}
	</div>

	{#if selectedRead}
		<p class="sc-read">
			<strong>{selectedRead.date.slice(8)}. {calendar.title.split(' ')[0].toLowerCase()}</strong>
			· {selectedRead.text}
		</p>
	{/if}

	<p class="sc-summary">
		{calendar.daysWithEvent} av {calendar.daysElapsed}
		{calendar.daysElapsed === 1 ? 'dag' : 'dager'} i {calendar.title.split(' ')[0].toLowerCase()}
		{#if calendar.events > calendar.daysWithEvent}
			· {calendar.events} ganger totalt
		{/if}
	</p>

	{#if scaled}
		<!-- Feltets fire hjørner, i det samme rutenettet aksene har: rader = tempo,
		     kolonner = distanse. Alt mellom hjørnene leses som en retning. -->
		<div class="sc-legend">
			<div class="sc-legend-grid">
				<span class="sc-legend-corner"></span>
				<span class="sc-legend-axis">kort</span>
				<span class="sc-legend-axis">lang</span>
				{#each legend as row, ri (ri)}
					<span class="sc-legend-axis sc-legend-axis-row">
						{ri === 0 ? 'rask' : 'rolig'}
					</span>
					{#each row as sample, ci (ci)}
						<span class="sc-swatch" style={`--f:${sample.fill}`}></span>
					{/each}
				{/each}
			</div>
			<p class="sc-legend-note">
				{paceOrSpeedLabel(sportFamily ?? '')} er lysheten, lengden er kuløren. Skalaen er dine
				egne dager (10.–90. persentil av {scale?.measuredDays} målte) — trykk på en dag for
				tallene.
			</p>
		</div>
	{/if}
</div>

<style>
	.sc {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.sc-nav {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.sc-nav-btn {
		background: none;
		border: none;
		color: var(--color-text-secondary, #999);
		cursor: pointer;
		padding: 6px 10px;
		border-radius: 8px;
	}

	.sc-nav-btn:disabled {
		opacity: 0.3;
		cursor: default;
	}

	.sc-title {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--color-text, #eee);
	}

	.sc-weekdays,
	.sc-row {
		display: grid;
		/* Sju dager pluss periodekolonnen. Kolonnen står også når den er tom, så
		   radene ikke hopper i bredden mellom regler. */
		grid-template-columns: repeat(7, 1fr) 34px;
		gap: 4px;
	}

	.sc-rows {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.sc-weekday {
		text-align: center;
		font-size: 0.66rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-muted, #777);
	}

	/* Cella er rutenettets rute OG trykkflaten. Marken tegnes inni. */
	.sc-day {
		display: flex;
		align-items: center;
		justify-content: center;
		aspect-ratio: 1;
		border-radius: 8px;
		background: #191919;
		border: none;
		padding: 0;
		font: inherit;
		font-size: 0.72rem;
		color: #8a8a8a;
	}

	button.sc-day {
		cursor: pointer;
	}

	.sc-day-empty {
		background: none;
	}

	/* Marken er dagen. Uten tall dekker den hele cella (ren tilstedeværelse); med
	   tall er sidekanten satt av distansen og fargen av tempoet. */
	/* Marken er dagen, og den dekker cella. Fast størrelse med vilje: se
	   komponentkommentaren om hvorfor arealet ikke bærer distansen. */
	.sc-mark {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
		border-radius: 7px;
		background: var(--f, transparent);
		color: var(--ink, inherit);
	}

	.sc-day.is-done .sc-mark {
		font-weight: 600;
	}

	/* Uten metrikk-skala: streakens egen aksentfarge, dempet nok til at datotallet
	   kan leses oppå den. */
	.sc-day.is-plain .sc-mark {
		background: color-mix(in srgb, var(--c) 26%, #191919);
		color: var(--color-text, #eee);
	}

	.sc-day.is-multi .sc-mark {
		box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--ink, var(--c)) 55%, transparent);
	}

	.sc-day.is-today {
		outline: 1.5px solid var(--c);
		outline-offset: -1.5px;
	}

	.sc-day.is-selected {
		outline: 2px solid var(--color-text, #eee);
		outline-offset: -2px;
	}

	/* Framtida er tom, ikke glemt. */
	.sc-day.is-future {
		background: #131313;
		color: #4a4a4a;
	}

	.sc-week-col {
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.sc-week {
		font-size: 0.62rem;
		font-weight: 600;
		color: var(--text-muted, #777);
		white-space: nowrap;
	}

	.sc-week.is-met {
		color: var(--c);
	}

	.sc-summary {
		margin: 2px 0 0;
		font-size: 0.72rem;
		color: var(--text-muted, #777);
	}

	.sc-read {
		margin: 4px 0 0;
		font-size: 0.76rem;
		color: var(--color-text, #eee);
	}

	.sc-legend {
		display: flex;
		flex-direction: column;
		gap: 5px;
		margin-top: 2px;
	}

	/* Fast bredde på etikettkolonnen: med `auto` ble «rask»/«rolig» klippet på
	   venstre kant, fordi kolonnen ble målt på den tomme hjørnecella. */
	.sc-legend-grid {
		display: grid;
		grid-template-columns: 38px 20px 20px;
		gap: 4px 6px;
		align-items: center;
		justify-items: center;
		width: fit-content;
	}

	.sc-legend-axis {
		font-size: 0.62rem;
		color: var(--text-muted, #777);
		white-space: nowrap;
	}

	.sc-legend-axis-row {
		justify-self: end;
	}

	.sc-legend-corner {
		width: 0;
	}

	/* Samme form som marken i kalenderen, i miniatyr: prøvene skal kunne kjennes
	   igjen som det samme merket. */
	.sc-swatch {
		display: inline-block;
		width: 20px;
		height: 20px;
		border-radius: 6px;
		background: var(--f);
	}

	.sc-legend-note {
		margin: 0;
		font-size: 0.66rem;
		line-height: 1.45;
		color: var(--text-muted, #777);
	}
</style>
