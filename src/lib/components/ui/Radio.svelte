<script lang="ts">
	interface Props {
		id?: string;
		name?: string;
		required?: boolean;
		disabled?: boolean;
		className?: string;
		onChange?: (event: Event) => void;
		value?: string;
		group?: string;
	}

	let {
		id,
		name,
		required = false,
		disabled = false,
		className = '',
		onChange,
		value,
		group = $bindable()
	}: Props = $props();
</script>

<input
	type="radio"
	{id}
	{name}
	{required}
	{disabled}
	{value}
	bind:group
	onchange={onChange}
	class={`ds-radio ${className}`.trim()}
/>

<style>
	.ds-radio {
		accent-color: #10b981;
		width: 0.95rem;
		height: 0.95rem;
	}
</style>
