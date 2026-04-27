<script lang="ts">
	import type { Snippet } from 'svelte';

	type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

	interface Props {
		children: Snippet;
		variant?: ButtonVariant;
		type?: 'button' | 'submit' | 'reset';
		disabled?: boolean;
		href?: string;
		fullWidth?: boolean;
		ariaLabel?: string;
		title?: string;
		className?: string;
		onClick?: () => void;
	}

	let {
		children,
		variant = 'primary',
		type = 'button',
		disabled = false,
		href,
		fullWidth = false,
		ariaLabel,
		title,
		className = '',
		onClick
	}: Props = $props();
</script>

{#if href}
	<a
		href={href}
		class={`ds-button btn-${variant} ${fullWidth ? 'is-full-width' : ''} ${className}`.trim()}
		aria-label={ariaLabel}
		title={title}
		onclick={onClick}
	>
		{@render children()}
	</a>
{:else}
	<button
		type={type}
		disabled={disabled}
		class={`ds-button btn-${variant} ${fullWidth ? 'is-full-width' : ''} ${className}`.trim()}
		aria-label={ariaLabel}
		title={title}
		onclick={onClick}
	>
		{@render children()}
	</button>
{/if}

<style>
	.ds-button.is-full-width {
		width: 100%;
	}
</style>