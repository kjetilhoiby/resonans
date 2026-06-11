<!--
  SectionLabel — standard seksjons-/diagramlabel for dashboards og soner.
  Svarer på «hva er denne blokken». Erstatter de lokale variantene
  (.hd-section-title, .ef-card-title, .theme-projects-title, osv.).

  Props:
    tag     hvilket element som rendres (h2/h3/h4/span) — velg etter
            overskriftshierarkiet på siden. Default h3.
    nowrap  ellipsis i stedet for linjefall — bruk i flex-rader med
            actions/meta til høyre. Trunkering skal være et eksplisitt valg.

  Farge kan overstyres per kontekst med --section-label-color.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		tag?: 'h2' | 'h3' | 'h4' | 'span';
		nowrap?: boolean;
		children: Snippet;
	}

	let { tag = 'h3', nowrap = false, children }: Props = $props();
</script>

<svelte:element this={tag} class="section-label" class:nowrap>{@render children()}</svelte:element>

<style>
	.section-label {
		margin: 0;
		font-size: var(--font-size-label, 0.78rem);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--section-label-color, #94a3b8);
	}

	.section-label.nowrap {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}
</style>
