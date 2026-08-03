<!--
  NutritionDayCard — dagens inntak: summer, måloppnåelse og måltidene.

  Viser 0 kcal framfor tom skjerm på en dag uten registreringer. En tom flate
  ser ut som at loggingen ikke virket; «0 kcal» er et svar.
-->
<script lang="ts">
	import SectionLabel from '../../ui/SectionLabel.svelte';
	import NutritionEntryRow from './NutritionEntryRow.svelte';
	import { groupBySlot, type DaySummary } from '$lib/domain/nutrition/day-summary';
	import { mealSlotMeta } from '$lib/domain/nutrition/meal-slots';

	interface Props {
		day: DaySummary;
		targets: { kcal: number | null; proteinG: number | null };
		/** Snitt per logget dag i vinduet, til linja under summene. */
		average?: { loggedDays: number; perDay: { kcal: number; proteinG: number } } | null;
		onChanged?: () => void;
	}

	let { day, targets, average = null, onChanged }: Props = $props();

	function nb(value: number): string {
		return value.toLocaleString('nb-NO');
	}

	/** Andelen som prosent, klemt til 100 for stolpebredden — tallet vises ukuttet. */
	function barWidth(share: number | null): string {
		if (share == null) return '0%';
		return `${Math.min(100, Math.round(share * 100))}%`;
	}

	const slotGroups = $derived(groupBySlot(day.entries));
</script>

<section class="day">
	<SectionLabel tag="h2">I dag</SectionLabel>

	<div class="totals">
		<div class="total total--primary">
			<span class="total-value">{nb(day.totals.kcal)}</span>
			<span class="total-unit">kcal</span>
			{#if targets.kcal}
				<span class="total-target">av {nb(targets.kcal)}</span>
			{/if}
		</div>
		<div class="total">
			<span class="total-value">{nb(day.totals.proteinG)}</span>
			<span class="total-unit">g protein</span>
			{#if targets.proteinG}
				<span class="total-target">av {nb(targets.proteinG)}</span>
			{/if}
		</div>
		<div class="total total--muted">
			<span class="total-value">{nb(day.totals.carbsG)}</span>
			<span class="total-unit">g karbo</span>
		</div>
		<div class="total total--muted">
			<span class="total-value">{nb(day.totals.fatG)}</span>
			<span class="total-unit">g fett</span>
		</div>
	</div>

	{#if day.kcalShare != null || day.proteinShare != null}
		<div class="bars">
			{#if day.kcalShare != null}
				<div class="bar-row">
					<span class="bar-label">kcal</span>
					<div class="bar"><div class="bar-fill" style="width: {barWidth(day.kcalShare)}"></div></div>
					<span class="bar-pct" class:over={day.kcalShare > 1}>{Math.round(day.kcalShare * 100)} %</span>
				</div>
			{/if}
			{#if day.proteinShare != null}
				<div class="bar-row">
					<span class="bar-label">protein</span>
					<div class="bar">
						<div class="bar-fill bar-fill--protein" style="width: {barWidth(day.proteinShare)}"></div>
					</div>
					<span class="bar-pct" class:over={day.proteinShare > 1}>
						{Math.round(day.proteinShare * 100)} %
					</span>
				</div>
			{/if}
		</div>
	{/if}

	{#if slotGroups.length > 0}
		{#each slotGroups as group (group.slot ?? 'uten')}
			<div class="slot-group">
				<div class="slot-head">
					<span class="slot-name">
						{#if group.slot}
							<span aria-hidden="true">{mealSlotMeta(group.slot).emoji}</span>
							{mealSlotMeta(group.slot).label}
						{:else}
							Uten måltid
						{/if}
					</span>
					<span class="slot-total">{nb(group.totals.kcal)} kcal</span>
				</div>
				<ul class="entries">
					{#each group.entries as entry (entry.id)}
						<NutritionEntryRow {entry} {onChanged} />
					{/each}
				</ul>
			</div>
		{/each}
	{:else}
		<p class="empty">Ingenting logget i dag ennå.</p>
	{/if}

	{#if average && average.loggedDays > 1}
		<p class="average">
			Snitt per logget dag: {nb(average.perDay.kcal)} kcal · {nb(average.perDay.proteinG)} g protein
			<span class="average-days">({average.loggedDays} dager siste to uker)</span>
		</p>
	{/if}

</section>

<style>
	.day {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.totals {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 8px;
		padding: 14px;
		border-radius: 16px;
		background: #141414;
	}

	@media (min-width: 520px) {
		.totals {
			grid-template-columns: repeat(4, 1fr);
		}
	}

	.total {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}

	.total-value {
		font-size: 1.35rem;
		font-weight: 700;
		letter-spacing: -0.02em;
		color: #eee;
	}

	.total--primary .total-value {
		color: #7c8ef5;
	}

	.total--muted .total-value {
		font-size: 1.05rem;
		color: #aaa;
	}

	.total-unit,
	.total-target {
		font-size: 0.7rem;
		color: #777;
	}

	.bars {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}

	.bar-row {
		display: grid;
		grid-template-columns: 54px 1fr 44px;
		align-items: center;
		gap: 8px;
	}

	.bar-label {
		font-size: 0.7rem;
		color: #777;
	}

	.bar {
		height: 6px;
		border-radius: 3px;
		background: #1f1f1f;
		overflow: hidden;
	}

	.bar-fill {
		height: 100%;
		border-radius: 3px;
		background: #7c8ef5;
	}

	.bar-fill--protein {
		background: #82c882;
	}

	.bar-pct {
		font-size: 0.7rem;
		text-align: right;
		color: #777;
	}

	.bar-pct.over {
		color: #f0b429;
	}

	.slot-group {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}

	.slot-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
		padding: 0 2px;
	}

	.slot-name {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #888;
	}

	.slot-total {
		font-size: 0.72rem;
		color: #666;
	}

	.entries {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.empty,
	.average {
		margin: 0;
		font-size: 0.78rem;
		line-height: 1.5;
		color: #777;
	}

	.average-days {
		color: #666;
	}
</style>
