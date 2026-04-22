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
		min?: string | number;
		max?: string | number;
		step?: string | number;
		autocomplete?: HTMLInputAttributes['autocomplete'];
	}

	let {
		id,
		name,
		type = 'text',
		value,
		placeholder,
		required = false,
		disabled = false,
		min,
		max,
		step,
		autocomplete
	}: Props = $props();
</script>

<input
	{id}
	{name}
	{type}
	{value}
	{placeholder}
	{required}
	{disabled}
	{min}
	{max}
	{step}
	{autocomplete}
	class="ds-input"
/>