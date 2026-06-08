<script lang="ts">
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
			<h2 class="section-title">{title}</h2>
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
		background: var(--bg-elevated);
		border-radius: var(--radius-lg);
		padding: var(--space-lg);
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

	.section-title {
		margin: 0;
		font-size: 0.88rem;
		font-weight: 700;
		color: var(--text-primary);
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
