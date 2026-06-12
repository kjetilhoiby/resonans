<!--
  Ordsky — vektet ordsky der weight (0..1) styrer skriftstørrelse og opasitet.
  Ordene beregnes server-side ($lib/server/ordsky); komponenten er ren visning.
-->
<script lang="ts">
	import type { OrdskyWordView } from './types';

	interface Props {
		words: OrdskyWordView[];
	}

	let { words }: Props = $props();
</script>

<div class="kv-ordsky">
	{#each words as word, i (word.word)}
		<span
			class="kv-ord"
			style={`font-size: calc(0.72rem + ${word.weight} * 1.1rem); opacity: ${0.55 + word.weight * 0.45}; --whue: ${(210 + i * 23) % 360};`}
			title={`${word.count} ganger`}>{word.word}</span
		>
	{/each}
</div>

<style>
	.kv-ordsky {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: center;
		gap: 6px 12px;
		padding: 6px 0;
	}

	/* --kv-ord-color kan overstyres av kontekst-skins (f.eks. festskinnet) */
	.kv-ord {
		color: var(--kv-ord-color, hsl(var(--whue) 75% 74%));
		line-height: 1.2;
	}
</style>
