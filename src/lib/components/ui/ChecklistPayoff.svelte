<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { elasticOut } from 'svelte/easing';
	import { RING_RADIUS, RING_CIRCUMFERENCE } from './checklist-sheet-helpers';

	interface Props {
		emoji: string;
		displayTitle: string;
		ondismiss: () => void;
	}

	let { emoji, displayTitle, ondismiss }: Props = $props();

	const R = RING_RADIUS;
	const C = RING_CIRCUMFERENCE;
</script>

<div
	class="cs-payoff"
	transition:fade={{ duration: 300 }}
	onclick={ondismiss}
	role="presentation"
>
	<div class="cs-payoff-content" transition:scale={{ duration: 500, easing: elasticOut, start: 0.7 }}>
		<!-- Animated ring -->
		<div class="cs-payoff-ring-wrap">
			<svg class="cs-payoff-ring" viewBox="0 0 100 100">
				<circle cx="50" cy="50" r={R} fill="none" stroke="#1a2a1a" stroke-width="8"/>
				<circle
					cx="50" cy="50" r={R}
					fill="none"
					stroke="#5fa080"
					stroke-width="8"
					stroke-dasharray="{C} {C}"
					stroke-linecap="round"
					transform="rotate(-90 50 50)"
					class="cs-payoff-ring-anim"
				/>
			</svg>
			<div class="cs-payoff-ring-inner">
				{#if emoji}
					<span class="cs-payoff-emoji">{emoji}</span>
				{/if}
			</div>
		</div>

		<h3 class="cs-payoff-title">Alt er klart!</h3>
		<p class="cs-payoff-sub">{displayTitle}</p>
		<p class="cs-payoff-cta">Trykk hvor som helst for å lukke</p>
	</div>
</div>

<style>
	.cs-payoff {
		position: fixed;
		inset: 0;
		background: rgba(0, 10, 0, 0.85);
		z-index: 300;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
	}

	.cs-payoff-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
		text-align: center;
		padding: 40px 32px;
	}

	.cs-payoff-ring-wrap {
		position: relative;
		width: 120px;
		height: 120px;
	}

	.cs-payoff-ring {
		width: 100%;
		height: 100%;
		display: block;
	}

	.cs-payoff-ring-anim {
		stroke-dashoffset: 0;
		animation: payoffDraw 0.8s cubic-bezier(0.22, 1, 0.36, 1) forwards;
	}

	@keyframes payoffDraw {
		from { stroke-dasharray: 0 251.33; }
		to { stroke-dasharray: 251.33 0; }
	}

	.cs-payoff-ring-inner {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.cs-payoff-emoji {
		font-size: 2.5rem;
		animation: payoffBounce 0.6s 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both;
	}

	@keyframes payoffBounce {
		from { transform: scale(0.4); opacity: 0; }
		to { transform: scale(1); opacity: 1; }
	}

	.cs-payoff-title {
		font-size: 1.5rem;
		font-weight: 700;
		color: #eee;
		letter-spacing: -0.02em;
		margin: 0;
		animation: payoffFadeUp 0.5s 0.3s cubic-bezier(0.22, 1, 0.36, 1) both;
	}

	.cs-payoff-sub {
		font-size: 0.85rem;
		color: #888;
		margin: 0;
		animation: payoffFadeUp 0.5s 0.45s cubic-bezier(0.22, 1, 0.36, 1) both;
	}

	.cs-payoff-cta {
		font-size: 0.7rem;
		color: #444;
		margin: 8px 0 0;
		animation: payoffFadeUp 0.5s 0.6s cubic-bezier(0.22, 1, 0.36, 1) both;
	}

	@keyframes payoffFadeUp {
		from { opacity: 0; transform: translateY(12px); }
		to { opacity: 1; transform: translateY(0); }
	}
</style>
