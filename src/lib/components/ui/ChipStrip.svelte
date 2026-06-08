<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		children: Snippet;
		gap?: number;
		ariaLabel?: string;
		class?: string;
	}

	let { children, gap = 8, ariaLabel, class: className }: Props = $props();
</script>

<div
	class="chip-strip {className ?? ''}"
	style:gap="{gap}px"
	role="group"
	aria-label={ariaLabel}
>
	{@render children()}
</div>

<style>
	.chip-strip {
		display: flex;
		overflow-x: auto;
		overflow-y: hidden;
		scrollbar-width: none;
		-webkit-overflow-scrolling: touch;
		padding: 4px 0;
		margin: -4px 0;
	}

	.chip-strip::-webkit-scrollbar {
		display: none;
	}
</style>
