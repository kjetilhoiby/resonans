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
		/**
		 * Etikett for brukslogging, «område:handling» i kebab-case. Svelte
		 * videresender ikke ukjente attributter til komponenter, så et tekstfelt
		 * uten denne propen logges anonymt som `input[text]`.
		 */
		dataTrack?: string;
		onChange?: (event: Event) => void;
		onInput?: (event: Event) => void;
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
		dataTrack,
		onChange,
		onInput,
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
	data-track={dataTrack}
	bind:value
	onchange={onChange}
	oninput={onInput}
	class={`ds-input ds-textarea ${className}`.trim()}
></textarea>

<style>
	.ds-textarea {
		resize: vertical;
	}
</style>
