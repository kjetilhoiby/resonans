<!--
  MonthCalendar — gjenbrukbar månedskalender med markerte dager.

  Viser én måned (man–søn) med ‹/›-navigasjon. Dager i `markedDays` får en
  markørprikk og kan trykkes; øvrige (og fremtidige) dager er deaktivert.
  Brukes til å hoppe til en dag i dagbok-chatten.
-->
<script lang="ts">
	import { WEEKDAY_INITIALS, monthGrid, monthTitle, addMonths, monthKey } from '$lib/client/month-grid';
	import { dayKey } from '$lib/client/chat-day-sections';
	import Icon from './Icon.svelte';

	interface Props {
		/** Måned som vises først, «YYYY-MM». Default: inneværende måned. */
		initialMonth?: string;
		/** Dag-nøkkel → antall (f.eks. meldinger). Markerte dager kan velges. */
		markedDays?: Record<string, number>;
		/** Siste valgbare dag, «YYYY-MM-DD». Default: i dag. */
		maxDay?: string;
		onSelectDay: (day: string) => void;
	}

	let { initialMonth, markedDays = {}, maxDay, onSelectDay }: Props = $props();

	let month = $state(initialMonth ?? monthKey(new Date()));
	const grid = $derived(monthGrid(month));
	const max = $derived(maxDay ?? dayKey(new Date()));

	function selectable(day: string): boolean {
		return day <= max && (markedDays[day] ?? 0) > 0;
	}
</script>

<div class="mc">
	<div class="mc-nav">
		<button class="mc-nav-btn" aria-label="Forrige måned" onclick={() => (month = addMonths(month, -1))}>
			<Icon name="back" size={16} />
		</button>
		<span class="mc-title">{monthTitle(month)}</span>
		<button class="mc-nav-btn" aria-label="Neste måned" onclick={() => (month = addMonths(month, 1))}>
			<Icon name="forward" size={16} />
		</button>
	</div>

	<div class="mc-weekdays" aria-hidden="true">
		{#each WEEKDAY_INITIALS as initial, i (i)}
			<span class="mc-weekday">{initial}</span>
		{/each}
	</div>

	<div class="mc-grid">
		{#each grid as week, wi (wi)}
			{#each week as day, di (di)}
				{#if day}
					{@const count = markedDays[day] ?? 0}
					<button
						class="mc-day"
						class:mc-day-marked={count > 0}
						disabled={!selectable(day)}
						onclick={() => onSelectDay(day)}
						title={count > 0 ? `${count} ${count === 1 ? 'melding' : 'meldinger'}` : undefined}
						aria-label={count > 0 ? `${day}, ${count} meldinger` : day}
					>
						<span class="mc-day-num">{Number(day.slice(8))}</span>
						{#if count > 0}<span class="mc-dot"></span>{/if}
					</button>
				{:else}
					<span class="mc-day mc-day-empty"></span>
				{/if}
			{/each}
		{/each}
	</div>
</div>

<style>
	.mc {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.mc-nav {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.mc-nav-btn {
		background: none;
		border: none;
		color: var(--text-secondary, #aaa);
		cursor: pointer;
		padding: 8px;
		border-radius: var(--radius-sm, 8px);
		display: flex;
	}
	.mc-nav-btn:hover {
		background: var(--bg-elevated, #141414);
		color: var(--text-primary, #eee);
	}

	.mc-title {
		font-size: 0.92rem;
		font-weight: 700;
		color: var(--text-primary, #eee);
	}

	.mc-weekdays,
	.mc-grid {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 2px;
	}

	.mc-weekday {
		text-align: center;
		font-size: 0.68rem;
		font-weight: 600;
		color: var(--text-secondary, #666);
		padding: 2px 0;
	}

	.mc-day {
		position: relative;
		aspect-ratio: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
		background: none;
		border: none;
		border-radius: var(--radius-sm, 8px);
		font: inherit;
		font-size: 0.82rem;
		color: var(--text-secondary, #555);
		padding: 0;
	}

	.mc-day-marked {
		color: var(--text-primary, #eee);
		cursor: pointer;
	}
	.mc-day-marked:not(:disabled):hover {
		background: var(--bg-elevated, #141414);
	}

	.mc-day:disabled {
		cursor: default;
		opacity: 0.55;
	}

	.mc-day-empty {
		pointer-events: none;
	}

	.mc-dot {
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: var(--accent-light, #7c8ef5);
	}
</style>
