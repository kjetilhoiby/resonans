<!--
  TaskTitle — viser en task-tittel med tallerken-ikon foran når tittelen
  er en måltids-task (middag:/frokost:/lunsj:/kveldsmat: ...). Stripper
  prefiks fra det som vises.
-->
<script lang="ts">
	import { detectMealPrefix } from '$lib/domains/food';

	let { title }: { title: string } = $props();
	const meal = $derived(detectMealPrefix(title));
</script>

{#if meal}
	<span class="meal-icon" aria-hidden="true">🍽️</span><span>{meal.cleanTitle}</span>
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
