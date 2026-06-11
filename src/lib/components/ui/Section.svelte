<script lang="ts">
	import SectionLabel from './SectionLabel.svelte';

	interface Props {
		title?: string;
		meta?: string;
		children: import('svelte').Snippet;
	}

	let { title, meta, children }: Props = $props();
</script>

<div class="section">
	{#if title}
		<header class="section-header">
			<SectionLabel tag="h2">{title}</SectionLabel>
			{#if meta}
				<span class="section-meta">{meta}</span>
			{/if}
		</header>
	{/if}
	<div class="section-content">
		{@render children()}
	</div>
</div>

<style>
	.section {
		background: var(--card-bg-subtle, var(--bg-elevated));
		border-radius: var(--card-radius, var(--radius-lg));
		padding: var(--card-padding, var(--space-lg));
		display: flex;
		flex-direction: column;
		gap: var(--space-md);
	}

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-md);
	}

	.section-meta {
		font-size: 0.72rem;
		color: var(--text-muted);
		white-space: nowrap;
	}

	.section-content {
		display: flex;
		flex-direction: column;
	}
</style>
