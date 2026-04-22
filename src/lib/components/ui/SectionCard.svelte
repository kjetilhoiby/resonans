<script lang="ts">
	import type { Snippet } from 'svelte';

	type SectionCardTone = 'default' | 'subtle';

	interface Props {
		title?: string;
		meta?: string;
		description?: string;
		tone?: SectionCardTone;
		className?: string;
		children: Snippet;
	}

	let {
		title,
		meta,
		description,
		tone = 'default',
		className = '',
		children
	}: Props = $props();
</script>

<section class={`section-card tone-${tone} ${className}`.trim()}>
	{#if title || meta || description}
		<header class="section-card-header">
			<div class="section-card-copy">
				{#if title}
					<h2>{title}</h2>
				{/if}
				{#if description}
					<p>{description}</p>
				{/if}
			</div>
			{#if meta}
				<span class="section-card-meta">{meta}</span>
			{/if}
		</header>
	{/if}
	<div class="section-card-content">
		{@render children()}
	</div>
</section>

<style>
	.section-card {
		background: #171717;
		border-radius: 16px;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		color: var(--text-primary);
	}

	.section-card.tone-subtle {
		background: #141414;
	}

	.section-card-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}

	.section-card-copy {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}

	h2 {
		margin: 0;
		font-size: 1rem;
		color: var(--text-primary);
	}

	p {
		margin: 0;
		color: var(--text-secondary);
		line-height: 1.5;
	}

	.section-card-meta {
		font-size: 0.78rem;
		color: var(--text-tertiary);
		white-space: nowrap;
	}

	.section-card-content {
		display: flex;
		flex-direction: column;
		gap: 12px;
		color: var(--text-primary);
	}
</style>