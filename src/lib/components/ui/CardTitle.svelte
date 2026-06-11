<!--
  CardTitle — standard kort-tittel. Svarer på «hva gjør/viser dette kortet»
  («Ukesnotat», «Legg inn skjermbilder», …). Normal case, hvit — i motsetning
  til SectionLabel (uppercase, muted) som merker blokker og diagrammer.

  Props:
    tag  hvilket element som rendres (h2/h3/h4) — velg etter
         overskriftshierarkiet på siden. Default h2.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		tag?: 'h2' | 'h3' | 'h4';
		children: Snippet;
	}

	let { tag = 'h2', children }: Props = $props();
</script>

<svelte:element this={tag} class="card-title">{@render children()}</svelte:element>

<style>
	.card-title {
		margin: 0;
		font-size: var(--font-size-title, 1rem);
		font-weight: 600;
		color: var(--text-primary, #eee);
	}
</style>
