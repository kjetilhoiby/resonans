<script lang="ts">
	import type { Snippet } from 'svelte';

	type SectionCardTone = 'default' | 'subtle' | 'transparent' | 'bordered';

	interface Props {
		title?: string;
		meta?: string;
		description?: string;
		tone?: SectionCardTone;
		interactive?: boolean;
		statusColor?: string;
		compact?: boolean;
		className?: string;
		children: Snippet;
		actions?: Snippet;
	}

	let {
		title,
		meta,
		description,
		tone = 'default',
		interactive = false,
		statusColor,
		compact = false,
		className = '',
		children,
		actions
	}: Props = $props();
</script>

<section
	class={`section-card tone-${tone} ${interactive ? 'is-interactive' : ''} ${compact ? 'is-compact' : ''} ${className}`.trim()}
	style={statusColor ? `border-left: 3px solid ${statusColor}` : undefined}
>
	{#if title || meta || description || actions}
		<header class="section-card-header">
			<div class="section-card-copy">
				{#if title}
					<h2>{title}</h2>
				{/if}
				{#if description}
					<p>{description}</p>
				{/if}
			</div>
			<div class="section-card-trailing">
				{#if meta}
					<span class="section-card-meta">{meta}</span>
				{/if}
				{#if actions}
					{@render actions()}
				{/if}
			</div>
		</header>
	{/if}
	<div class="section-card-content">
		{@render children()}
	</div>
</section>

<style>
	.section-card {
		background: var(--card-bg, var(--bg-card));
		border-radius: var(--card-radius, var(--radius-lg));
		padding: var(--card-padding, var(--space-lg));
		display: flex;
		flex-direction: column;
		gap: 14px;
		color: var(--text-primary);
	}

	.section-card.is-compact {
		padding: var(--space-md);
		gap: var(--space-sm);
	}

	.section-card.tone-subtle {
		background: var(--card-bg-subtle, var(--bg-elevated));
	}

	.section-card.tone-transparent {
		background: transparent;
		padding: 0;
	}

	.section-card.tone-bordered {
		background: var(--card-bg, var(--bg-card));
		border: 1px solid var(--card-border, var(--border-color));
	}

	.section-card.is-interactive {
		cursor: pointer;
		transition: background 0.12s, border-color 0.12s;
	}

	.section-card.is-interactive:hover {
		background: var(--bg-hover);
	}

	.section-card-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-md);
	}

	.section-card-copy {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}

	.section-card-trailing {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		flex-shrink: 0;
	}

	h2 {
		margin: 0;
		font-size: var(--font-size-title, 1rem);
		font-weight: 600;
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
		gap: var(--space-md);
		color: var(--text-primary);
	}
</style>
