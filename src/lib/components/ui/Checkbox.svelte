<script lang="ts">
	interface Props {
		id?: string;
		name?: string;
		disabled?: boolean;
		className?: string;
		onChange?: (event: Event) => void;
		checked?: boolean;
		value?: string;
		group?: string[];
	}

	let {
		id,
		name,
		disabled = false,
		className = '',
		onChange,
		checked = $bindable(false),
		value,
		group = $bindable()
	}: Props = $props();
</script>

{#if group !== undefined}
	<input
		type="checkbox"
		{id}
		{name}
		{disabled}
		{value}
		bind:group
		onchange={onChange}
		class={`ds-checkbox ${className}`.trim()}
	/>
{:else}
	<input
		type="checkbox"
		{id}
		{name}
		{disabled}
		bind:checked
		onchange={onChange}
		class={`ds-checkbox ${className}`.trim()}
	/>
{/if}

<style>
	.ds-checkbox {
		accent-color: #10b981;
		width: 0.95rem;
		height: 0.95rem;
	}
</style>
