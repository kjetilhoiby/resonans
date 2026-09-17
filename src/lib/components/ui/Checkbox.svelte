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
		/**
		 * Tilgjengelig navn når avkryssingsboksen ikke har en egen `<label>`.
		 * Uten den er den bare «avkryssingsboks» for en skjermleser.
		 */
		ariaLabel?: string;
		/**
		 * Etiketten brukslogginga skal bruke («område:handling», kebab-case norsk).
		 * Uten den ender boksen som en anonym `input[checkbox]` i statistikken — se
		 * brukslogging-reglene i CLAUDE.md. Svelte videresender ikke ukjente
		 * attributter til komponenter, så dette MÅ være en prop.
		 */
		dataTrack?: string;
	}

	let {
		id,
		name,
		disabled = false,
		className = '',
		onChange,
		checked = $bindable(false),
		value,
		ariaLabel,
		dataTrack,
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
		aria-label={ariaLabel}
		data-track={dataTrack}
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
		aria-label={ariaLabel}
		data-track={dataTrack}
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
