<!--
  GoalRing — fremgangsmåler som SVG-ring.

  Props:
    pct           0–100, primær fremgang
    color         strekfarge (primær ring)
    trackColor    sporets bakgrunnsfarge
    r             ytre radius, default 26
    strokeWidth   default 5
    pct2          0–100, sekundær (indre) ring — dobbelring
    color2        strekfarge for indre ring
    trackColor2
    r2            indre radius, default 18
    strokeWidth2  default 4
    pacePct       0–100 — tegner en tempomarkering på ringen
    paceColor     farge på tempotikk
    size          wrapper-størrelse i px, default 80

  Midten rendres via children (snippet):
    <GoalRing pct={40} color="#f0b429">
      <span>2/5</span>
    </GoalRing>
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		pct: number;
		color?: string;
		trackColor?: string;
		r?: number;
		strokeWidth?: number;
		pct2?: number;
		color2?: string;
		trackColor2?: string;
		r2?: number;
		strokeWidth2?: number;
		pacePct?: number;
		paceColor?: string;
		size?: number;
		children?: Snippet;
	}

	let {
		pct,
		color = '#7c8ef5',
		trackColor = '#1e1e2a',
		r = 26,
		strokeWidth = 5,
		pct2,
		color2 = '#5fa0a0',
		trackColor2 = '#1a1a1a',
		r2 = 18,
		strokeWidth2 = 4,
		pacePct,
		paceColor = '#555',
		size = 80,
		children,
	}: Props = $props();

	const circ = $derived(2 * Math.PI * r);
	const dash = $derived((Math.min(Math.max(pct, 0), 100) / 100) * circ);
	const circ2 = $derived(2 * Math.PI * r2);
	const dash2 = $derived(pct2 != null ? (Math.min(Math.max(pct2, 0), 100) / 100) * circ2 : 0);
	const paceDeg = $derived(pacePct != null ? (pacePct / 100) * 360 : 0);
</script>

<div class="goal-ring" style="width:{size}px;height:{size}px">
	<svg viewBox="0 0 64 64" aria-hidden="true" style="position:absolute;inset:0;width:100%;height:100%">
		<!-- ytre spor -->
		<circle cx="32" cy="32" r={r} fill="none" stroke={trackColor} stroke-width={strokeWidth} />
		<!-- ytre fremgang -->
		<circle
			cx="32" cy="32" r={r}
			fill="none"
			stroke={color}
			stroke-width={strokeWidth}
			stroke-dasharray="{dash.toFixed(1)} {circ.toFixed(1)}"
			stroke-linecap="round"
			transform="rotate(-90 32 32)"
		/>
		<!-- tempomarkering (valgfri) -->
		{#if pacePct != null}
			<line
				x1="32" y1="6" x2="32" y2="12"
				stroke={paceColor} stroke-width="1.5" stroke-linecap="round"
				transform="rotate({paceDeg} 32 32)"
			/>
		{/if}
		<!-- indre ring ved dobbelring (valgfri) -->
		{#if pct2 != null}
			<circle cx="32" cy="32" r={r2} fill="none" stroke={trackColor2} stroke-width={strokeWidth2} />
			<circle
				cx="32" cy="32" r={r2}
				fill="none"
				stroke={color2}
				stroke-width={strokeWidth2}
				stroke-dasharray="{dash2.toFixed(1)} {circ2.toFixed(1)}"
				stroke-linecap="round"
				transform="rotate(-90 32 32)"
			/>
		{/if}
	</svg>
	{#if children}
		<div class="goal-ring-center">
			{@render children()}
		</div>
	{/if}
</div>

<style>
	.goal-ring {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.goal-ring-center {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1px;
		pointer-events: none;
	}
</style>
