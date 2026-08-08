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
		/**
		 * Tastaturet mobilen skal vise. `type="number"` alene gir ikke talltastatur på
		 * iOS, så et cm- eller kcal-felt trenger `inputmode="numeric"` i tillegg.
		 */
		inputmode?: HTMLInputAttributes['inputmode'];
		/**
		 * Etiketten brukslogging skal bruke, i kebab-case på norsk («område:handling»).
		 * Se brukslogging-avsnittet i CLAUDE.md: uten den ender feltet som en anonym
		 * `input[text]` i statistikken, og da er den ulesbar.
		 */
		dataTrack?: string;
		/**
		 * Tilgjengelig navn når feltet ikke har en synlig `<label>`. En placeholder
		 * er ikke et navn — den forsvinner så snart man begynner å skrive.
		 */
		ariaLabel?: string;
		/**
		 * Id-en til en `<datalist>` med forslag. Nettleseren gjør autofullføringen
		 * selv — ingen egen dropdown å vedlikeholde, og den virker med tastatur.
		 */
		list?: string;
		className?: string;
		onChange?: (event: Event) => void;
		onInput?: (event: Event) => void;
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
		inputmode,
		dataTrack,
		ariaLabel,
		list,
		className = '',
		onChange,
		onInput,
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
	{inputmode}
	data-track={dataTrack}
	aria-label={ariaLabel}
	{list}
	bind:value
	onchange={onChange}
	oninput={onInput}
	class={`ds-input ${className}`.trim()}
/>