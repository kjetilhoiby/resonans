<script lang="ts">
	import { onMount } from 'svelte';

	interface Props {
		from: string;
		to: string;
		delay?: number;
		charDelay?: number;
		onpress?: () => void;
		ariaLabel?: string;
	}

	let { from, to, delay = 2200, charDelay = 75, onpress, ariaLabel = to }: Props = $props();

	const maxLen = Math.max(from.length, to.length);
	const fromPadded = from.padEnd(maxLen, ' ');
	const toPadded = to.padEnd(maxLen, ' ');

	let displayed = $state(from);

	onMount(() => {
		const start = setTimeout(() => {
			let step = 0;
			const interval = setInterval(() => {
				step++;
				let result = '';
				for (let i = 0; i < maxLen; i++) {
					result += i < step ? toPadded[i] : fromPadded[i];
				}
				displayed = result.trimEnd();
				if (step >= maxLen) clearInterval(interval);
			}, charDelay);
		}, delay);

		return () => clearTimeout(start);
	});
</script>

<button
	class="morph-title"
	type="button"
	onclick={() => onpress?.()}
	aria-label={ariaLabel}
>
	<h1 class="morph-title-text">{displayed}</h1>
</button>

<style>
	.morph-title {
		background: transparent;
		border: 0;
		padding: 0;
		margin: 0;
		cursor: pointer;
		text-align: left;
	}

	.morph-title:focus-visible {
		outline: 2px solid #37457e;
		outline-offset: 4px;
		border-radius: 6px;
	}

	.morph-title-text {
		font-size: 1.4rem;
		font-weight: 700;
		letter-spacing: -0.03em;
		color: #e8e8e8;
		margin: 0;
		line-height: 1.1;
		font-variant-numeric: tabular-nums;
	}
</style>
