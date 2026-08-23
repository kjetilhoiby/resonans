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

  Fylt = hendelse den dagen. Tallet i cellen er datoen, ikke antallet: antallet står
  som en ekstra ring rundt cellen når det er mer enn én (to løpeturer samme dag), og
  i `title`. I dag har ramme. Framtidige dager er tomme uten å være «glemt» — en dag
  som ikke har vært, kan ikke være brutt.
-->
<script lang="ts">
	import Icon from '../../ui/Icon.svelte';
	import { WEEKDAY_INITIALS, addMonths } from '$lib/domain/month-grid';
	import { buildStreakCalendar, type StreakHistoryDay } from '$lib/domain/streak-history';
	import type { StreakConfig, StreakRule } from '$lib/domain/streaks';

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
	}

	let {
		month = $bindable(),
		days,
		todayKey,
		rule,
		config,
		color = 'var(--warning-text)',
		earliestMonth = null
	}: Props = $props();

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
						<div
							class="sc-day"
							class:is-done={cell.count > 0}
							class:is-multi={cell.count > 1}
							class:is-today={cell.isToday}
							class:is-future={cell.isFuture}
							title={dayTitle(cell.count, cell.date)}
						>
							{Number(cell.date.slice(8))}
						</div>
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

	<p class="sc-summary">
		{calendar.daysWithEvent} av {calendar.daysElapsed}
		{calendar.daysElapsed === 1 ? 'dag' : 'dager'} i {calendar.title.split(' ')[0].toLowerCase()}
		{#if calendar.events > calendar.daysWithEvent}
			· {calendar.events} ganger totalt
		{/if}
	</p>
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

	.sc-day {
		display: flex;
		align-items: center;
		justify-content: center;
		aspect-ratio: 1;
		border-radius: 8px;
		background: #191919;
		font-size: 0.72rem;
		color: #8a8a8a;
	}

	.sc-day-empty {
		background: none;
	}

	/* Fylt celle = hendelse. Fargen er streakens, dempet nok til at datotallet
	   fortsatt kan leses oppå den. */
	.sc-day.is-done {
		background: color-mix(in srgb, var(--c) 26%, #191919);
		color: var(--color-text, #eee);
		font-weight: 600;
	}

	.sc-day.is-multi {
		box-shadow: inset 0 0 0 1.5px var(--c);
	}

	.sc-day.is-today {
		outline: 1.5px solid var(--c);
		outline-offset: -1.5px;
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
</style>
