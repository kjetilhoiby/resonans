<!--
  StreakBadge — sirkel med nåd og ukedots under.

  Props:
    count     antall dager
    color     aksentfarge (default amber)
    weekDots  7 booleans — true = fullført (default: 5 done, 2 remaining)
    label     tekst under dots (f.eks. "Jogging")
-->
<script lang="ts">
	interface Props {
		count: number;
		color?: string;
		weekDots?: boolean[];
		label?: string;
	}

	let {
		count,
		color = '#f0b429',
		weekDots = [true, true, true, true, true, false, false],
		label,
	}: Props = $props();

	// Siste true-indeks = dagens dot
	const todayIdx = $derived(
		weekDots.reduce((acc, v, i) => (v ? i : acc), -1)
	);
</script>

<div class="streak-wrap">
	<div class="streak-circ" style="--c:{color}">
		<span class="streak-flame">🔥</span>
		<span class="streak-num" style="color:{color}">{count}</span>
		<span class="streak-unit">dager</span>
	</div>
	<div class="streak-dots" role="list" aria-label="Ukedager">
		{#each weekDots as done, i}
			<div
				class="dot"
				class:done
				class:today={done && i === todayIdx}
				style="--c:{color}"
				role="listitem"
			></div>
		{/each}
	</div>
	{#if label}
		<span class="streak-label">{label}</span>
	{/if}
</div>

<style>
	.streak-wrap {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
	}

	.streak-circ {
		width: 80px;
		height: 80px;
		border-radius: 50%;
		border: 2.5px solid var(--c, #f0b429);
		background: radial-gradient(
			ellipse at 40% 30%,
			color-mix(in srgb, var(--c, #f0b429) 12%, #1a1a1a),
			#111
		);
		box-shadow: 0 0 18px color-mix(in srgb, var(--c, #f0b429) 15%, transparent);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0;
	}

	.streak-flame {
		font-size: 0.9rem;
		line-height: 1;
	}

	.streak-num {
		font-size: 1.1rem;
		font-weight: 700;
		line-height: 1;
	}

	.streak-unit {
		font-size: 0.58rem;
		color: #555;
		text-transform: lowercase;
	}

	.streak-dots {
		display: flex;
		gap: 4px;
	}

	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #2a2a2a;
		border: 1px solid #333;
		transition: background 0.15s;
	}

	.dot.done {
		background: var(--c, #f0b429);
		border-color: var(--c, #f0b429);
		opacity: 0.65;
	}

	.dot.done.today {
		opacity: 1;
		box-shadow: 0 0 6px var(--c, #f0b429);
	}

	.streak-label {
		font-size: 0.6rem;
		color: #444;
		text-transform: uppercase;
		letter-spacing: 0.07em;
	}
</style>
