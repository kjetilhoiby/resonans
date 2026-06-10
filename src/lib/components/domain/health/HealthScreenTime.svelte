<script lang="ts">
	import SectionLabel from '../../ui/SectionLabel.svelte';
	import ScreenTimeCard from '../../composed/ScreenTimeCard.svelte';
	import type { PeriodMetrics } from './health-data';

	interface Props {
		thisWeekScreen: PeriodMetrics['screenTime'] | null;
		prevWeekScreen: PeriodMetrics['screenTime'] | null;
	}

	let { thisWeekScreen, prevWeekScreen }: Props = $props();
</script>

{#if thisWeekScreen}
	<a class="hd-screentime-link" href="/skjermtid" aria-label="Åpne skjermtid">
		<div class="hd-screentime-head">
			<SectionLabel tag="span">Skjermtid · siste uke</SectionLabel>
			<span class="hd-screentime-more">Se mer →</span>
		</div>
		<ScreenTimeCard thisWeek={thisWeekScreen} prevWeek={prevWeekScreen} compact />
	</a>
{:else}
	<a class="hd-screentime-empty" href="/skjermtid" aria-label="Kom i gang med skjermtid">
		<span class="hd-screentime-empty-icon">📱</span>
		<span class="hd-screentime-empty-copy">
			<span class="hd-screentime-empty-title">Følg skjermtid og scrolling</span>
			<span class="hd-screentime-empty-text">Last opp et iPhone Skjermtid-skjermbilde for å komme i gang.</span>
		</span>
		<span class="hd-screentime-more">→</span>
	</a>
{/if}

<style>
	.hd-screentime-link {
		display: block;
		text-decoration: none;
		color: inherit;
	}
	.hd-screentime-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		margin-bottom: 6px;
	}
	.hd-screentime-more {
		font-size: 0.8rem;
		color: var(--accent-primary, #4aa8ff);
	}
	.hd-screentime-empty {
		display: flex;
		align-items: center;
		gap: 12px;
		text-decoration: none;
		color: var(--text-primary, #fff);
		background: var(--bg-secondary, #161616);
		border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
		border-radius: 16px;
		padding: 14px 16px;
	}
	.hd-screentime-empty-icon {
		font-size: 1.5rem;
		flex-shrink: 0;
	}
	.hd-screentime-empty-copy {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
		min-width: 0;
	}
	.hd-screentime-empty-title {
		font-size: 0.92rem;
		font-weight: 600;
	}
	.hd-screentime-empty-text {
		font-size: 0.8rem;
		color: var(--text-secondary, rgba(255, 255, 255, 0.6));
	}
</style>
