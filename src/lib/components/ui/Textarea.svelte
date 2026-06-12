<script lang="ts">
	interface Props {
		id?: string;
		name?: string;
		rows?: number;
		placeholder?: string;
		disabled?: boolean;
		required?: boolean;
		className?: string;
		ariaLabel?: string;
		onChange?: (event: Event) => void;
		value?: string;
	}

	let {
		id,
		name,
		rows,
		placeholder,
		disabled = false,
		required = false,
		className = '',
		ariaLabel,
		onChange,
		value = $bindable('')
	}: Props = $props();
</script>

<textarea
	{id}
	{name}
	{rows}
	{placeholder}
	{disabled}
	{required}
	aria-label={ariaLabel}
	bind:value
	onchange={onChange}
	class={`ds-input ds-textarea ${className}`.trim()}
></textarea>

<style>
	.ds-textarea {
		resize: vertical;
	}
</style>
