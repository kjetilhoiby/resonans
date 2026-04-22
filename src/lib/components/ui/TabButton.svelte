<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		children: Snippet;
		active?: boolean;
		href?: string;
		disabled?: boolean;
		type?: 'button' | 'submit' | 'reset';
		className?: string;
		ariaLabel?: string;
		onClick?: () => void;
	}

	let {
		children,
		active = false,
		href,
		disabled = false,
		type = 'button',
		className = '',
		ariaLabel,
		onClick
	}: Props = $props();
</script>

{#if active && href}
	<span class={`ds-tab-button is-active ${className}`.trim()} aria-current="page">
		{@render children()}
	</span>
{:else if href}
	<a
		href={href}
		class={`ds-tab-button ${active ? 'is-active' : ''} ${className}`.trim()}
		aria-label={ariaLabel}
		onclick={onClick}
	>
		{@render children()}
	</a>
{:else}
	<button
		type={type}
		disabled={disabled}
		class={`ds-tab-button ${active ? 'is-active' : ''} ${className}`.trim()}
		aria-label={ariaLabel}
		onclick={onClick}
	>
		{@render children()}
	</button>
{/if}

<style>
	.ds-tab-button {
		padding: 0.6rem 1.25rem;
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		margin-bottom: -2px;
		font-size: 0.95rem;
		font-weight: 500;
		color: var(--text-secondary);
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
		border-radius: 0;
		text-decoration: none;
		display: inline-flex;
		align-items: center;
		white-space: nowrap;
	}

	.ds-tab-button:hover {
		color: var(--text-primary);
	}

	.ds-tab-button.is-active {
		color: var(--text-primary);
		border-bottom-color: #10b981;
		font-weight: 600;
	}

	.ds-tab-button:disabled {
		opacity: 0.6;
		cursor: default;
	}
</style>
