<!--
  TaskTitle — viser en task-tittel med eventuelt måltids-ikon foran.
  Strippe "middag:/frokost:/lunsj:/kveldsmat:"-prefiks når detektert.
-->
<script lang="ts">
	import { detectMealPrefix } from '$lib/domains/food';

	let { title }: { title: string } = $props();
	const meal = $derived(detectMealPrefix(title));
</script>

{#if meal}
	<span class="meal-icon" aria-hidden="true">{meal.emoji}</span><span>{meal.cleanTitle}</span>
{:else}
	{title}
{/if}

<style>
	.meal-icon {
		margin-right: 6px;
		font-size: 1em;
		line-height: 1;
	}
</style>
