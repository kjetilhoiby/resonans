<script lang="ts">
	import type { TripProgress } from '$lib/domain/live-share';

	/**
	 * «16:49 ●━━━━○┄┄┄┄◯ 17:42» — startet, hvor langt på vei, framme. Samme prikk
	 * og samme mål-ring som på kartet, så øyet kjenner dem igjen. Stripa er en
	 * TIDSakse; se `tripProgress` for hvorfor prikken plasseres i tid.
	 */
	let { progress }: { progress: TripProgress } = $props();

	const pct = $derived(Math.round(progress.fraction * 1000) / 10);
	const arrived = $derived(!progress.endIsEstimate);
	const label = $derived(
		arrived
			? `Startet ${progress.startClock}, framme ${progress.endClock}`
			: `Startet ${progress.startClock}, framme ca. ${progress.endClock}, omtrent ${Math.round(pct)} prosent på vei`
	);
</script>

<div class="strip" role="img" aria-label={label}>
	<div class="row clocks">
		<span>{progress.startClock}</span>
		<span>{progress.endIsEstimate ? `ca. ${progress.endClock}` : progress.endClock}</span>
	</div>
	<div class="track">
		<span class="rest"></span>
		<span class="done" style:width="{pct}%"></span>
		<span class="start"></span>
		<span class="end" class:reached={arrived}></span>
		{#if !arrived}<span class="dot" style:left="{pct}%"></span>{/if}
	</div>
	<div class="row labels">
		<span>Startet</span>
		<span>Framme</span>
	</div>
</div>

<style>
	.strip {
		margin-top: 1.1rem;
	}
	.row {
		display: flex;
		justify-content: space-between;
	}
	.clocks {
		font-size: 0.95rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: var(--ink, #1b1a17);
	}
	.labels {
		font-size: 0.75rem;
		color: var(--muted, #786c5e);
	}
	.track {
		position: relative;
		height: 26px;
		margin: 0 8px;
	}
	.rest,
	.done {
		position: absolute;
		top: 50%;
		left: 0;
		height: 5px;
		margin-top: -2.5px;
		border-radius: 3px;
		background: var(--accent, #ec5a2e);
	}
	.rest {
		right: 0;
		opacity: 0.25;
	}
	.done {
		transition: width 1s ease;
	}
	.start,
	.end {
		position: absolute;
		top: 50%;
		width: 12px;
		height: 12px;
		margin: -6px 0 0 -6px;
		border-radius: 50%;
		box-sizing: border-box;
	}
	.start {
		left: 0;
		background: var(--accent, #ec5a2e);
		border: 2px solid #fff;
	}
	.end {
		left: 100%;
		width: 16px;
		height: 16px;
		margin: -8px 0 0 -8px;
		background: #fff;
		border: 4px solid var(--pine, #23443d);
		box-shadow: 0 1px 3px rgba(74, 58, 40, 0.3);
	}
	.end.reached {
		background: var(--accent, #ec5a2e);
	}
	/* Samme prikk som på kartet (createPositionDot). */
	.dot {
		position: absolute;
		top: 50%;
		width: 18px;
		height: 18px;
		margin: -9px 0 0 -9px;
		box-sizing: border-box;
		border-radius: 50%;
		background: var(--accent, #ec5a2e);
		border: 3px solid #fff;
		box-shadow:
			0 0 0 6px rgba(236, 90, 46, 0.18),
			0 1px 4px rgba(74, 58, 40, 0.35);
		transition: left 1s ease;
	}
</style>
