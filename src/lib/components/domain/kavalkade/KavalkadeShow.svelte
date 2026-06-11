<!--
  KavalkadeShow — fullskjerm-spiller for kavalkade-showet, story-stil:
  segmentert progresjonsbar øverst, tap-soner (venstre = forrige, høyre =
  neste), piltaster og Escape. Auto-fremdrift følger hver slides durationMs
  og stopper på siste slide.

  `animate={false}` fryser slide-innhold og progresjon (for /design-demo).
-->
<script lang="ts">
	import { fade } from 'svelte/transition';
	import ShowSlide from './ShowSlide.svelte';
	import type { ShowSlideDef } from './show-slides';

	interface Props {
		slides: ShowSlideDef[];
		onclose?: () => void;
		animate?: boolean;
		autoAdvance?: boolean;
	}

	let { slides, onclose, animate = true, autoAdvance = true }: Props = $props();

	let index = $state(0);

	const current = $derived(slides[index]);
	const isLast = $derived(index >= slides.length - 1);

	function next() {
		if (isLast) return;
		index += 1;
	}

	function prev() {
		if (index === 0) return;
		index -= 1;
	}

	// Auto-fremdrift: re-armes for hver slide, stopper på siste
	$effect(() => {
		index; // re-kjør ved slide-bytte
		if (!animate || !autoAdvance || isLast) return;
		const timer = setTimeout(next, current?.durationMs ?? 6000);
		return () => clearTimeout(timer);
	});

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowRight' || e.key === ' ') {
			e.preventDefault();
			next();
		} else if (e.key === 'ArrowLeft') {
			e.preventDefault();
			prev();
		} else if (e.key === 'Escape') {
			onclose?.();
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div class="show" class:animate role="region" aria-label="Årskavalkade-show">
	{#key index}
		<div class="frame" in:fade={{ duration: animate ? 350 : 0 }}>
			{#if current}
				<ShowSlide slide={current} {animate} />
			{/if}
		</div>
	{/key}

	<div class="progress" aria-hidden="true">
		{#each slides as slide, i (i)}
			<span class="seg" class:done={i < index} class:active={i === index}>
				{#if i === index}
					<span class="fill" style={`--dur: ${slide.durationMs}ms;`}></span>
				{/if}
			</span>
		{/each}
	</div>

	<button class="zone zone-prev" aria-label="Forrige lysbilde" onclick={prev}></button>
	<button class="zone zone-next" aria-label="Neste lysbilde" onclick={next}></button>

	<button class="close" aria-label="Lukk kavalkaden" data-track="kavalkade-show:lukk" onclick={() => onclose?.()}>✕</button>
</div>

<style>
	.show {
		position: fixed;
		inset: 0;
		z-index: 1000;
		background: #07070a;
		overflow: hidden;
	}

	.frame {
		position: absolute;
		inset: 0;
	}

	.progress {
		position: absolute;
		top: calc(10px + env(safe-area-inset-top, 0px));
		left: 14px;
		right: 14px;
		display: flex;
		gap: 5px;
		z-index: 3;
	}

	.seg {
		flex: 1;
		height: 3px;
		border-radius: 2px;
		background: rgb(255 255 255 / 0.22);
		overflow: hidden;
	}

	.seg.done {
		background: rgb(255 255 255 / 0.85);
	}

	.fill {
		display: block;
		height: 100%;
		width: 100%;
		background: rgb(255 255 255 / 0.85);
		transform-origin: left;
		transform: scaleX(1);
	}

	.animate .fill {
		animation: fill var(--dur, 6000ms) linear both;
	}

	@keyframes fill {
		from { transform: scaleX(0); }
		to { transform: scaleX(1); }
	}

	.zone {
		position: absolute;
		top: 0;
		bottom: 0;
		z-index: 2;
		background: transparent;
		border: none;
		padding: 0;
		cursor: pointer;
	}

	.zone-prev {
		left: 0;
		width: 32%;
	}

	.zone-next {
		left: 32%;
		right: 0;
	}

	.close {
		position: absolute;
		top: calc(22px + env(safe-area-inset-top, 0px));
		right: 14px;
		z-index: 3;
		width: 34px;
		height: 34px;
		border-radius: 50%;
		border: none;
		background: rgb(255 255 255 / 0.14);
		color: #f4f4f6;
		font-size: 0.95rem;
		cursor: pointer;
		display: grid;
		place-items: center;
	}

	@media (prefers-reduced-motion: reduce) {
		.animate .fill {
			animation: none;
		}
	}
</style>
