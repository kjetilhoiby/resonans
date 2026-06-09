<script lang="ts">
	import { onMount } from 'svelte';
	import type { Snippet } from 'svelte';
	import IconButton from './IconButton.svelte';

	interface Props {
		title: string;
		subtitle?: string;
		emoji?: string | null;
		backHref?: string;
		backLabel?: string;
		titleHref?: string;
		titleLabel?: string;
		onTitleClick?: () => void;
		morph?: { to: string; delay?: number; charDelay?: number };
		actions?: Snippet;
	}

	let {
		title,
		subtitle = '',
		emoji,
		backHref,
		backLabel = 'Tilbake',
		titleHref,
		titleLabel = title,
		onTitleClick,
		morph,
		actions
	}: Props = $props();

	let displayed = $state(title);

	if (morph) {
		const from = title;
		const to = morph.to;
		const maxLen = Math.max(from.length, to.length);
		const fromPadded = from.padEnd(maxLen, ' ');
		const toPadded = to.padEnd(maxLen, ' ');

		onMount(() => {
			const start = setTimeout(() => {
				let step = 0;
				const interval = setInterval(() => {
					step++;
					let result = '';
					for (let i = 0; i < maxLen; i++) {
						result += i < step ? toPadded[i] : fromPadded[i];
					}
					displayed = result.trimEnd();
					if (step >= maxLen) clearInterval(interval);
				}, morph.charDelay ?? 75);
			}, morph.delay ?? 2200);
			return () => clearTimeout(start);
		});
	}
</script>

<header class="page-header">
	<div class="page-header-main">
		{#if backHref}
			<IconButton href={backHref} icon="back" variant="nav" ariaLabel={backLabel} />
		{/if}
		<div class="page-header-copy">
			{#if titleHref}
				<a href={titleHref} class="page-header-title-link" aria-label={titleLabel}>
					<div class="page-header-title-row">
						{#if emoji}<span class="page-header-emoji">{emoji}</span>{/if}
						<h1>{displayed}</h1>
					</div>
				</a>
			{:else if onTitleClick || morph}
				<button class="page-header-title-link" type="button" onclick={() => onTitleClick?.()} aria-label={titleLabel}>
					<div class="page-header-title-row">
						{#if emoji}<span class="page-header-emoji">{emoji}</span>{/if}
						<h1>{displayed}</h1>
					</div>
				</button>
			{:else}
				<div class="page-header-title-row">
					{#if emoji}<span class="page-header-emoji">{emoji}</span>{/if}
					<h1>{displayed}</h1>
				</div>
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
		align-items: center;
		justify-content: space-between;
		gap: var(--space-lg);
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
		gap: 4px;
		min-width: 0;
	}

	.page-header-title-row {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.page-header-emoji {
		font-size: 1.5rem;
		line-height: 1;
		flex-shrink: 0;
	}

	.page-header-title-link {
		color: inherit;
		text-decoration: none;
		width: fit-content;
		background: none;
		border: none;
		padding: 0;
		margin: 0;
		cursor: pointer;
		font: inherit;
		text-align: left;
	}

	.page-header-title-link:hover h1 {
		color: var(--accent-primary);
	}

	.page-header-title-link:focus-visible {
		outline: 2px solid var(--accent-primary);
		outline-offset: 4px;
		border-radius: 6px;
	}

	h1 {
		margin: 0;
		font-size: 1.4rem;
		font-weight: 700;
		line-height: 1;
		letter-spacing: -0.03em;
		color: var(--text-primary);
	}

	p {
		margin: 0;
		font-size: 0.85rem;
		color: var(--text-secondary);
		line-height: 1.5;
	}

	.page-header-actions {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: nowrap;
		flex-shrink: 0;
	}
</style>
