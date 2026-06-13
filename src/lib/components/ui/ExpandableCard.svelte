<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** Om kortet er utvidet. Eies av forelder (kontrollert komponent). */
		expanded?: boolean;
		/** Kalles når headeren klikkes — forelder oppdaterer `expanded`. */
		onToggle?: () => void;
		ariaLabel?: string;
		/** Innhold i headerlinja, til venstre for chevron (ikon + tittel + meta). */
		header: Snippet;
		/** Innhold som vises når kortet er utvidet. */
		children?: Snippet;
	}

	let { expanded = false, onToggle, ariaLabel, header, children }: Props = $props();
</script>

<div class="ec-card" class:ec-expanded={expanded}>
	<button
		type="button"
		class="ec-header"
		aria-expanded={expanded}
		aria-label={ariaLabel}
		onclick={() => onToggle?.()}
	>
		<span class="ec-header-content">{@render header()}</span>
		<span class="ec-chevron" class:ec-chevron-open={expanded} aria-hidden="true">›</span>
	</button>

	{#if expanded && children}
		<div class="ec-body">{@render children()}</div>
	{/if}
</div>

<style>
	/*
	 * Generisk utvidbart kort. Chrome styres via CSS-variabler så ulike
	 * kontekster (tema-liste, helse-aktiviteter) kan beholde sitt uttrykk uten
	 * å duplisere oppførselen. Standardverdiene gir et solid «card»-uttrykk;
	 * helse overstyrer til transparent bakgrunn med innrykket innhold.
	 */
	.ec-card {
		background: var(--ec-bg, #171717);
		border: 1px solid var(--ec-border, transparent);
		border-radius: var(--ec-radius, 10px);
		overflow: hidden;
		transition: border-color 0.15s;
	}

	.ec-card.ec-expanded {
		border-color: var(--ec-border-expanded, #2a2a2a);
	}

	.ec-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		padding: var(--ec-header-pad, 0.8rem 0.9rem);
		background: none;
		border: none;
		text-align: left;
		color: inherit;
		cursor: pointer;
		border-radius: var(--ec-radius, 10px);
		font: inherit;
		transition: background 0.12s;
	}

	.ec-header:hover {
		background: var(--ec-hover, rgba(255, 255, 255, 0.03));
	}

	.ec-header-content {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.ec-chevron {
		font-size: 1.2rem;
		line-height: 1;
		flex-shrink: 0;
		color: var(--ec-chevron, var(--text-tertiary, #777));
		transition: transform 0.18s ease;
	}

	.ec-chevron-open {
		transform: rotate(90deg);
		color: var(--ec-chevron-open, var(--accent-primary, #7c8ef5));
	}

	.ec-body {
		padding: var(--ec-body-pad, 0);
	}
</style>
