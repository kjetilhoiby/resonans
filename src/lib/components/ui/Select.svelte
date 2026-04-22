<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		id?: string;
		name?: string;
		disabled?: boolean;
		className?: string;
		onChange?: (event: Event) => void;
		value?: string;
		children: Snippet;
	}

	let {
		id,
		name,
		disabled = false,
		className = '',
		onChange,
		value = $bindable(),
		children
	}: Props = $props();
</script>

<select
	{id}
	{name}
	{disabled}
	bind:value
	onchange={onChange}
	class={`ds-input ds-select ${className}`.trim()}
>
	{@render children()}
</select>
