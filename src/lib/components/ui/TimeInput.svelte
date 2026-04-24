<script lang="ts">
	interface Props {
		id?: string;
		name?: string;
		value?: string;
		required?: boolean;
		disabled?: boolean;
		min?: string;
		max?: string;
		step?: string | number;
		className?: string;
		onChange?: (event: Event) => void;
	}

	let {
		id,
		name,
		required = false,
		disabled = false,
		min,
		max,
		step,
		className = '',
		onChange,
		value = $bindable()
	}: Props = $props();
</script>

<input
	type="time"
	{id}
	{name}
	{required}
	{disabled}
	{min}
	{max}
	{step}
	bind:value
	onchange={onChange}
	class={`ds-input ds-time-input ${className}`.trim()}
/>

<style>
	.ds-time-input {
		width: min(100%, 7.5rem);
		min-width: 0;
	}
</style>