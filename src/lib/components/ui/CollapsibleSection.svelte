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
		/* Samme typografi som SectionLabel (interaktiv variant med hover) */
		color: var(--section-label-color, #94a3b8);
		font-size: 0.85rem;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.collapsible-header:hover {
		color: #b8b8b8;
	}

	.collapsible-title {
		flex: 1;
	}

	.collapsible-count {
		background: #202020;
		color: #9a9a9a;
		border: 1px solid #2a2a2a;
		border-radius: 999px;
		padding: 0.05rem 0.45rem;
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
