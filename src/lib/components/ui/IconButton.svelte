<script lang="ts">
	import type { IconName } from './Icon.svelte';
	import Icon from './Icon.svelte';

	type IconButtonVariant = 'default' | 'danger' | 'nav';

	interface Props {
		icon: IconName;
		ariaLabel: string;
		variant?: IconButtonVariant;
		href?: string;
		type?: 'button' | 'submit' | 'reset';
		disabled?: boolean;
		size?: number;
	}

	let {
		icon,
		ariaLabel,
		variant = 'default',
		href,
		type = 'button',
		disabled = false,
		size = 20
	}: Props = $props();

	const className = $derived(
		variant === 'nav'
			? 'btn-nav'
			: variant === 'danger'
				? 'btn-icon-danger'
				: 'btn-icon'
	);
</script>

{#if href}
	<a href={href} class={className} aria-label={ariaLabel}>
		<Icon name={icon} size={size} />
	</a>
{:else}
	<button type={type} class={className} aria-label={ariaLabel} disabled={disabled}>
		<Icon name={icon} size={size} />
	</button>
{/if}