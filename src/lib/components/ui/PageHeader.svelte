<script lang="ts">
	import type { Snippet } from 'svelte';
	import IconButton from './IconButton.svelte';

	interface Props {
		title: string;
		subtitle?: string;
		backHref?: string;
		backLabel?: string;
		titleHref?: string;
		titleLabel?: string;
		actions?: Snippet;
	}

	let {
		title,
		subtitle = '',
		backHref,
		backLabel = 'Tilbake',
		titleHref,
		titleLabel = title,
		actions
	}: Props = $props();
</script>

<header class="page-header">
	<div class="page-header-main">
		{#if backHref}
			<IconButton href={backHref} icon="back" variant="nav" ariaLabel={backLabel} />
		{/if}
		<div class="page-header-copy">
			{#if titleHref}
				<a href={titleHref} class="page-header-title-link" aria-label={titleLabel}>
					<h1>{title}</h1>
				</a>
			{:else}
				<h1>{title}</h1>
			{/if}
			{#if subtitle}
				<p>{subtitle}</p>
			{/if}
		</div>
	</div>
	{#if actions}
		<div class="page-header-actions">
			{@render actions()}
		</div>
	{/if}
</header>

<style>
	.page-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
	}

	.page-header-main {
		display: flex;
		align-items: flex-start;
		gap: 14px;
		min-width: 0;
		flex: 1;
	}

	.page-header-copy {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}

	.page-header-title-link {
		color: inherit;
		text-decoration: none;
		width: fit-content;
	}

	.page-header-title-link:hover h1 {
		color: var(--accent-primary);
	}

	h1 {
		margin: 0;
		font-size: clamp(1.45rem, 2.8vw, 1.85rem);
		line-height: 1.08;
		letter-spacing: -0.03em;
		color: var(--text-primary);
	}

	p {
		margin: 0;
		font-size: 0.95rem;
		color: var(--text-secondary);
		line-height: 1.5;
	}

	.page-header-actions {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}

	@media (max-width: 720px) {
		.page-header {
			flex-direction: column;
		}

		.page-header-actions {
			width: 100%;
		}
	}
</style>