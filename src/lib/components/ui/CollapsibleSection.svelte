<script lang="ts">
	interface Props {
		title: string;
		count: number;
		defaultOpen?: boolean;
	}

	let { title, count, defaultOpen = true, children }: Props & { children?: import('svelte').Snippet } = $props();

	let open = $state(defaultOpen);
</script>

<div class="collapsible-section">
	<button
		class="collapsible-header"
		onclick={() => (open = !open)}
		aria-expanded={open}
	>
		<span class="collapsible-title">{title}</span>
		{#if count > 0}
			<span class="collapsible-count">{count}</span>
		{/if}
		<span class="collapsible-chevron" class:open>{open ? '▾' : '▸'}</span>
	</button>
	{#if open}
		<div class="collapsible-content">
			{@render children?.()}
		</div>
	{/if}
</div>

<style>
	.collapsible-section {
		display: flex;
		flex-direction: column;
	}

	.collapsible-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
		width: 100%;
		color: var(--color-text-secondary, #888);
		font-size: 0.75rem;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.collapsible-header:hover {
		color: var(--color-text-primary, #333);
	}

	.collapsible-title {
		flex: 1;
	}

	.collapsible-count {
		background: var(--color-surface-2, #e8e8e8);
		color: var(--color-text-secondary, #888);
		border-radius: 999px;
		padding: 0 0.4rem;
		font-size: 0.7rem;
		font-weight: 600;
		min-width: 1.2rem;
		text-align: center;
	}

	.collapsible-chevron {
		font-size: 0.7rem;
		opacity: 0.6;
	}

	.collapsible-content {
		display: flex;
		flex-direction: column;
	}
</style>
