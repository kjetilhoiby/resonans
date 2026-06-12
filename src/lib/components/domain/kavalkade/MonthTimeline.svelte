<!--
  MonthTimeline — måned-for-måned-tidslinje for bursdagsåret: toppsport,
  økter, skritt, bøker og månedens overskrift. Tomme måneder vises dempet.
-->
<script lang="ts">
	import { SectionLabel } from '$lib/components/ui';
	import type { MonthEntry } from './types';

	interface Props {
		months: MonthEntry[];
	}

	let { months }: Props = $props();

	const nf = new Intl.NumberFormat('nb-NO');
	const nfCompact = new Intl.NumberFormat('nb-NO', { notation: 'compact', maximumFractionDigits: 1 });

	function monthFacts(m: MonthEntry): string {
		const parts: string[] = [];
		if (m.topSport) {
			parts.push(
				m.topSport.distanceKm >= 1
					? `${m.topSport.label} ${nf.format(m.topSport.distanceKm)} km`
					: `${m.topSport.label} ${m.topSport.count} økter`
			);
		}
		if (m.workoutCount > 0) parts.push(`${m.workoutCount} økter`);
		if (m.stepsTotal !== null) parts.push(`${nfCompact.format(m.stepsTotal)} skritt`);
		if (m.books.length > 0) parts.push(`leste ${m.books.join(', ')}`);
		return parts.join(' · ');
	}
</script>

<ol class="kv-timeline">
	{#each months as month (month.key)}
		{@const facts = monthFacts(month)}
		<li class="kv-month" class:is-empty={!facts && !month.headline}>
			<SectionLabel tag="h4">{month.label}</SectionLabel>
			{#if month.headline}
				<p class="kv-month-headline">«{month.headline}»</p>
			{/if}
			{#if facts}
				<p class="kv-month-facts">{facts}</p>
			{:else if !month.headline}
				<p class="kv-month-facts kv-muted">stille måned</p>
			{/if}
		</li>
	{/each}
</ol>

<style>
	.kv-timeline {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.kv-month {
		border-left: 2px solid var(--card-border, #222);
		padding-left: 12px;
	}

	.kv-month.is-empty {
		opacity: 0.55;
	}

	.kv-month-headline {
		margin: 4px 0 0;
		font-size: var(--font-size-body);
		font-style: italic;
		color: var(--text-primary);
	}

	.kv-month-facts {
		margin: 2px 0 0;
		font-size: var(--font-size-caption);
		color: var(--text-secondary);
	}

	.kv-muted {
		color: var(--text-tertiary, var(--text-secondary));
	}
</style>
