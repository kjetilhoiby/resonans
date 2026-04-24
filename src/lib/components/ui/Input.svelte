<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	interface Props {
		id?: string;
		name?: string;
		type?: string;
		value?: string | number;
		placeholder?: string;
		required?: boolean;
		disabled?: boolean;
		readonly?: boolean;
		min?: string | number;
		max?: string | number;
		step?: string | number;
		autocomplete?: HTMLInputAttributes['autocomplete'];
		className?: string;
		onChange?: (event: Event) => void;
	}

	let {
		id,
		name,
		type = 'text',
		placeholder,
		required = false,
		disabled = false,
		readonly = false,
		min,
		max,
		step,
		autocomplete,
		className = '',
		onChange,
		value = $bindable()
	}: Props = $props();
</script>

<input
	{id}
	{name}
	{type}
	{placeholder}
	{required}
	{disabled}
	readonly={readonly || undefined}
	{min}
	{max}
	{step}
	{autocomplete}
	bind:value
	onchange={onChange}
	class={`ds-input ${className}`.trim()}
/>