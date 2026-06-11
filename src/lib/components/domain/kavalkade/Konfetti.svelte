<!--
  Konfetti — CSS-konfettiregn med deterministisk «tilfeldighet» (golden
  ratio-spredning, ingen Math.random — /design er i visuell regresjon).

  Negative animation-delays gjør at feltet er fullt fra første frame.
  `animate={false}` (og prefers-reduced-motion) fryser bitene spredt
  utover som et stille drys.
-->
<script lang="ts">
	interface Props {
		count?: number;
		animate?: boolean;
	}

	let { count = 70, animate = true }: Props = $props();

	const fract = (n: number) => n - Math.floor(n);

	const pieces = Array.from({ length: count }, (_, i) => ({
		x: fract(i * 0.618034) * 100,
		hue: Math.round(fract(i * 0.754877) * 360),
		delay: fract(i * 0.381966) * 4.5,
		dur: 3.2 + fract(i * 0.554549) * 2.6,
		size: 6 + fract(i * 0.224) * 6,
		drift: (fract(i * 0.91) - 0.5) * 28,
		spin: 360 + Math.round(fract(i * 0.137) * 540),
		frozenY: fract(i * 0.467) * 100,
		shape: i % 3
	}));
</script>

<div class="konfetti" class:animate aria-hidden="true">
	{#each pieces as p, i (i)}
		<span
			class={`piece shape-${p.shape}`}
			style={`left: ${p.x}%; --khue: ${p.hue}; --delay: ${p.delay}s; --dur: ${p.dur}s; --drift: ${p.drift}vh; --size: ${p.size}px; --spin: ${p.spin}deg; --fy: ${p.frozenY}%;`}
		></span>
	{/each}
</div>

<style>
	.konfetti {
		position: absolute;
		inset: 0;
		overflow: hidden;
		pointer-events: none;
	}

	.piece {
		position: absolute;
		top: -6%;
		width: var(--size);
		height: calc(var(--size) * 0.62);
		background: hsl(var(--khue) 92% 66%);
		opacity: 0.92;
	}

	.shape-1 {
		border-radius: 50%;
		height: var(--size);
	}

	.shape-2 {
		width: calc(var(--size) * 0.42);
		height: calc(var(--size) * 1.5);
		border-radius: 2px;
	}

	/* Frosset: spredt drys i deterministiske posisjoner */
	.konfetti:not(.animate) .piece {
		top: var(--fy);
		transform: rotate(calc(var(--khue) * 1deg));
	}

	.animate .piece {
		animation: konfetti-fall var(--dur) linear calc(var(--delay) * -1) infinite;
	}

	@keyframes konfetti-fall {
		0% {
			transform: translate3d(0, 0, 0) rotateZ(0) rotateX(0);
		}
		100% {
			transform: translate3d(var(--drift), 115vh, 0) rotateZ(var(--spin)) rotateX(720deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.animate .piece {
			animation: none;
			top: var(--fy);
			transform: rotate(calc(var(--khue) * 1deg));
		}
	}
</style>
