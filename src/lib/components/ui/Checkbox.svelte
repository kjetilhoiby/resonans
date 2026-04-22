<script lang="ts">
	interface Props {
		id?: string;
		name?: string;
		disabled?: boolean;
		className?: string;
		onChange?: (event: Event) => void;
		checked?: boolean;
	}

	let {
		id,
		name,
		disabled = false,
		className = '',
		onChange,
		checked = $bindable(false)
	}: Props = $props();
</script>

<input
	type="checkbox"
	{id}
	{name}
	{disabled}
	bind:checked
	onchange={onChange}
	class={`ds-checkbox ${className}`.trim()}
/>

<style>
	.ds-checkbox {
		accent-color: #10b981;
		width: 0.95rem;
		height: 0.95rem;
	}
</style>
