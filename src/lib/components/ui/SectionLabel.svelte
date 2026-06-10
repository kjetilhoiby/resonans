<!--
  SectionLabel — standard seksjons-/diagramlabel for dashboards og soner.
  Erstatter de lokale variantene (.hd-section-title, .ef-card-title,
  .theme-projects-title, osv.) med én delt stil.

  Props:
    tag  hvilket element som rendres (h2/h3/h4/span) — velg etter
         overskriftshierarkiet på siden. Default h3.

  Farge kan overstyres per kontekst med --section-label-color.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		tag?: 'h2' | 'h3' | 'h4' | 'span';
		children: Snippet;
	}

	let { tag = 'h3', children }: Props = $props();
</script>

<svelte:element this={tag} class="section-label">{@render children()}</svelte:element>

<style>
	.section-label {
		margin: 0;
		font-size: 0.85rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--section-label-color, #94a3b8);
	}
</style>
