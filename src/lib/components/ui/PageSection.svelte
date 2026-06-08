<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		bleed?: boolean;
		children: Snippet;
	}

	let { bleed = false, children }: Props = $props();
</script>

<div class="page-section" class:bleed>
	{@render children()}
</div>

<style>
	.page-section {
		display: flex;
		flex-direction: column;
		gap: var(--page-gap, 16px);
		padding: var(--page-pt) var(--page-px) var(--page-pb);
	}
	.page-section.bleed {
		padding: 0;
	}
</style>
