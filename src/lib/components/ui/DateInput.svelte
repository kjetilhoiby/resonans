<!--
  DateInput — appens datofelt. Tynn wrapper over .ds-input (som TimeInput),
  med color-scheme: dark slik at native kalender-popup og -indikator er
  synlige på mørk bakgrunn. Bruk denne — aldri rå <input type="date">.
-->
<script lang="ts">
	interface Props {
		id?: string;
		name?: string;
		value?: string;
		required?: boolean;
		disabled?: boolean;
		min?: string;
		max?: string;
		className?: string;
		ariaLabel?: string;
		/**
		 * Label i brukslogginga. Uten den ender feltet som et anonymt
		 * `input[date]`, og bruksstatistikken kan ikke leses — se
		 * brukslogging-reglene i CLAUDE.md. Svelte videresender ikke ukjente
		 * attributter til komponenter, så dette MÅ være en prop.
		 */
		dataTrack?: string;
		onChange?: (event: Event & { currentTarget: EventTarget & HTMLInputElement }) => void;
	}

	let {
		id,
		name,
		required = false,
		disabled = false,
		min,
		max,
		className = '',
		ariaLabel,
		dataTrack,
		onChange,
		value = $bindable()
	}: Props = $props();
</script>

<input
	type="date"
	{id}
	{name}
	{required}
	{disabled}
	{min}
	{max}
	aria-label={ariaLabel}
	data-track={dataTrack}
	bind:value
	onchange={onChange}
	class={`ds-input ds-date-input ${className}`.trim()}
/>

<style>
	.ds-date-input {
		width: min(100%, 10.5rem);
		min-width: 0;
		/* Mørk native kalender-popup + synlig kalender-ikon */
		color-scheme: dark;
	}

	.ds-date-input::-webkit-calendar-picker-indicator {
		cursor: pointer;
		opacity: 0.8;
	}
</style>
