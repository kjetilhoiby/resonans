<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		id?: string;
		name?: string;
		disabled?: boolean;
		className?: string;
		/** Etikett for brukslogging, «område:handling» i kebab-case. Se CLAUDE.md. */
		dataTrack?: string;
		/** Tilgjengelig navn når velgeren ikke har en synlig `<label>`. */
		ariaLabel?: string;
		onChange?: (event: Event) => void;
		value?: string;
		children: Snippet;
	}

	let {
		id,
		name,
		disabled = false,
		className = '',
		dataTrack,
		ariaLabel,
		onChange,
		value = $bindable(),
		children
	}: Props = $props();
</script>

<select
	{id}
	{name}
	{disabled}
	data-track={dataTrack}
	aria-label={ariaLabel}
	bind:value
	onchange={onChange}
	class={`ds-input ds-select ${className}`.trim()}
>
	{@render children()}
</select>
