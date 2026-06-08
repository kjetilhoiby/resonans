<script lang="ts">
	import { goto } from '$app/navigation';
	import ScreenTitle from '$lib/components/ui/ScreenTitle.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { startNavMetric } from '$lib/client/nav-metrics';

	interface Props {
		monthName: string;
		year: number;
		previousMonthKey: string;
		nextMonthKey: string;
		isCurrentMonth: boolean;
	}

	let { monthName, year, previousMonthKey, nextMonthKey, isCurrentMonth }: Props = $props();

	function monthHref(key: string) {
		return `/maanedsplan?month=${encodeURIComponent(key)}`;
	}
</script>

<header class="mp-header">
	<ScreenTitle
		title={`${monthName.charAt(0).toUpperCase() + monthName.slice(1)} ${year}`}
		ariaLabel="Tilbake til hjem"
		onpress={() => { startNavMetric('maanedsplan', 'home'); void goto('/'); }}
	/>
	<div class="mp-header-actions">
		<a class="mp-nav-btn" href="/ukeplan" aria-label="Til ukeplan">
			<Icon name="calendar" size={15} />
			<span>Uke</span>
		</a>
		<a class="mp-nav-btn" href={monthHref(previousMonthKey)} aria-label="Forrige måned">
			<Icon name="back" size={16} />
		</a>
		<a class="mp-nav-btn" href={monthHref(nextMonthKey)} aria-label="Neste måned">
			<Icon name="forward" size={16} />
		</a>
		{#if !isCurrentMonth}
			<a class="mp-nav-btn mp-nav-btn--today" href="/maanedsplan" aria-label="Gå til denne måneden">
				I dag
			</a>
		{/if}
	</div>
</header>

<style>
	.mp-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}

	.mp-header-actions {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
		padding-top: 2px;
	}

	.mp-nav-btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 32px;
		padding: 0 10px;
		border-radius: 9px;
		border: 1px solid #1e2030;
		background: #0c0e18;
		color: #8a99c4;
		font-size: 0.78rem;
		font-weight: 600;
		text-decoration: none;
		cursor: pointer;
		transition: background 0.12s, color 0.12s, border-color 0.12s;
	}
	.mp-nav-btn:hover { background: #12162a; color: #bac6f9; border-color: #2e3660; }
	.mp-nav-btn--today { color: var(--accent-light); }
</style>
