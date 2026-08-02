<!--
  NutritionDayCard — dagens inntak: summer, måloppnåelse og måltidene.

  Viser 0 kcal framfor tom skjerm på en dag uten registreringer. En tom flate
  ser ut som at loggingen ikke virket; «0 kcal» er et svar.
-->
<script lang="ts">
	import SectionLabel from '../../ui/SectionLabel.svelte';
	import { extractApiErrorMessage } from '$lib/client/api-error';
	import { confidenceLabel } from '$lib/domain/nutrition/estimate';
	import { osloTimeLabel, type DaySummary } from '$lib/domain/nutrition/day-summary';

	interface Props {
		day: DaySummary;
		targets: { kcal: number | null; proteinG: number | null };
		/** Snitt per logget dag i vinduet, til linja under summene. */
		average?: { loggedDays: number; perDay: { kcal: number; proteinG: number } } | null;
		onChanged?: () => void;
	}

	let { day, targets, average = null, onChanged }: Props = $props();

	let deleting = $state<string | null>(null);
	let error = $state('');

	function nb(value: number): string {
		return value.toLocaleString('nb-NO');
	}

	/** Andelen som prosent, klemt til 100 for stolpebredden — tallet vises ukuttet. */
	function barWidth(share: number | null): string {
		if (share == null) return '0%';
		return `${Math.min(100, Math.round(share * 100))}%`;
	}

	async function remove(id: string) {
		if (deleting) return;
		deleting = id;
		error = '';
		try {
			const res = await fetch(`/api/helse/ernaering/logg/${id}`, { method: 'DELETE' });
			if (!res.ok) throw new Error(extractApiErrorMessage(res.status, await res.text()));
			onChanged?.();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			deleting = null;
		}
	}
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

	{#if day.entries.length > 0}
		<ul class="entries">
			{#each day.entries as entry (entry.id)}
				<li class="entry">
					{#if entry.imageUrl}
						<img class="entry-thumb" src={entry.imageUrl} alt="" />
					{/if}
					<span class="entry-main">
						<span class="entry-label">{entry.label}</span>
						<span class="entry-meta">
							{osloTimeLabel(entry.timestamp)} · {nb(entry.macros.kcal)} kcal · {nb(entry.macros.proteinG)} g protein
							{#if entry.confidence > 0}
								· {confidenceLabel(entry.confidence)} sikkerhet
							{/if}
						</span>
					</span>
					<button
						type="button"
						class="entry-remove"
						aria-label={`Slett ${entry.label}`}
						onclick={() => void remove(entry.id)}
						disabled={deleting === entry.id}
						data-track="ernaering:slett-maltid"
					>
						{deleting === entry.id ? '…' : '✕'}
					</button>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="empty">Ingenting logget i dag ennå.</p>
	{/if}

	{#if average && average.loggedDays > 1}
		<p class="average">
			Snitt per logget dag: {nb(average.perDay.kcal)} kcal · {nb(average.perDay.proteinG)} g protein
			<span class="average-days">({average.loggedDays} dager siste to uker)</span>
		</p>
	{/if}

	{#if error}
		<p class="error">{error}</p>
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

	.entries {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.entry {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 12px;
		border-radius: 12px;
		background: #141414;
	}

	.entry-thumb {
		width: 36px;
		height: 36px;
		object-fit: cover;
		border-radius: 8px;
		flex-shrink: 0;
	}

	.entry-main {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
		flex: 1;
	}

	.entry-label {
		font-size: 0.85rem;
		color: #eee;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.entry-meta {
		font-size: 0.7rem;
		color: #777;
	}

	.entry-remove {
		background: none;
		border: none;
		color: #666;
		font: inherit;
		font-size: 0.85rem;
		padding: 4px 6px;
		cursor: pointer;
		flex-shrink: 0;
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

	.error {
		margin: 0;
		font-size: 0.78rem;
		color: #e0776b;
		overflow-wrap: anywhere;
	}
</style>
