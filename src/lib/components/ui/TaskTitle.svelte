<!--
  TaskTitle — viser en task-tittel med tallerken-ikon foran når tittelen
  er en måltids-task (middag:/frokost:/lunsj:/kveldsmat: ...). Stripper
  prefiks fra det som vises og fremhever @-mentions via MentionText.
-->
<script lang="ts">
	import { detectMealPrefix } from '$lib/domains/food';
	import MentionText from './MentionText.svelte';

	let { title }: { title: string } = $props();
	const meal = $derived(detectMealPrefix(title));
</script>

{#if meal}
	<span class="meal-icon" aria-hidden="true">🍽️</span><MentionText text={meal.cleanTitle} />
{:else}
	<MentionText text={title} />
{/if}

<style>
	.meal-icon {
		margin-right: 6px;
		font-size: 1em;
		line-height: 1;
	}
</style>
