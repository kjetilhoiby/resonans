<script lang="ts">
	import { scale } from 'svelte/transition';
	import { elasticOut } from 'svelte/easing';

	interface Props {
		checked: boolean;
		skipped?: boolean;
		shape?: 'circle' | 'square';
		size?: 'sm' | 'md';
		animated?: boolean;
		onclick?: () => void;
	}

	let {
		checked,
		skipped = false,
		shape = 'circle',
		size = 'md',
		animated = true,
		onclick,
	}: Props = $props();
</script>

<button
	type="button"
	class="cl-checkbox"
	class:cl-checked={checked && !skipped}
	class:cl-skipped={skipped}
	class:cl-square={shape === 'square'}
	class:cl-sm={size === 'sm'}
	onclick={onclick}
	aria-label={checked ? 'Marker som ikke gjort' : 'Marker som gjort'}
>
	{#if skipped}
		{#if animated}
			<span class="cl-tick cl-tick-skipped" transition:scale={{ duration: 200, easing: elasticOut }}>✕</span>
		{:else}
			<span class="cl-tick cl-tick-skipped">✕</span>
		{/if}
	{:else if checked}
		{#if animated}
			<span class="cl-tick" transition:scale={{ duration: 200, easing: elasticOut }}>✓</span>
		{:else}
			<span class="cl-tick">✓</span>
		{/if}
	{/if}
</button>

<style>
	.cl-checkbox {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		border: 2px solid #333;
		background: transparent;
		color: #7c8ef5;
		font-size: 0.8rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		transition: border-color 0.15s, background 0.15s;
		touch-action: manipulation;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
		padding: 0;
	}

	.cl-checkbox:hover {
		border-color: #555;
	}

	.cl-checked {
		border-color: #5fa080;
		background: #5fa080;
		color: #fff;
	}

	.cl-skipped {
		border-color: #774444;
		background: #2a1818;
	}

	.cl-square {
		border-radius: 5px;
	}

	.cl-sm {
		width: 18px;
		height: 18px;
		border-width: 1.5px;
		font-size: 0.65rem;
	}

	.cl-tick {
		color: white;
		font-size: 0.7rem;
		font-weight: 700;
		line-height: 1;
	}

	.cl-sm .cl-tick {
		font-size: 0.6rem;
	}

	.cl-tick-skipped {
		color: #e07070;
	}
</style>
