<!--
  ThemeRecipesTab — «Oppskrifter»-fanen på mat-temaet. Oppskriftskartoteket:
  søk, hurtig-oppretting (bare navn), og redigering via RecipeSheet.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import SectionLabel from '../../ui/SectionLabel.svelte';
	import Skeleton from '../../ui/Skeleton.svelte';
	import RecipeSheet, { type RecipeLike } from '../food/RecipeSheet.svelte';

	type RecipeRow = RecipeLike & {
		timesPlanned?: number;
		lastPlannedDate?: string | null;
	};

	let recipes = $state<RecipeRow[]>([]);
	let loading = $state(true);
	let query = $state('');
	let newTitle = $state('');
	let creating = $state(false);
	let selected = $state<RecipeRow | null>(null);

	onMount(load);

	async function load() {
		loading = true;
		try {
			const res = await fetch('/api/food/recipes?withStats=1');
			if (res.ok) {
				const data = await res.json();
				recipes = data.meals ?? [];
			}
		} finally {
			loading = false;
		}
	}

	const filtered = $derived(
		query.trim()
			? recipes.filter((recipe) => {
					const q = query.trim().toLowerCase();
					return (
						recipe.title.toLowerCase().includes(q) ||
						recipe.tags.some((tag) => tag.toLowerCase().includes(q))
					);
				})
			: recipes
	);

	async function createRecipe() {
		const title = newTitle.trim();
		if (!title || creating) return;
		creating = true;
		try {
			const res = await fetch('/api/food/recipes', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ title })
			});
			if (res.ok) {
				const data = await res.json();
				recipes = [{ ...data.meal, timesPlanned: 0, lastPlannedDate: null }, ...recipes];
				newTitle = '';
			}
		} finally {
			creating = false;
		}
	}

	function timeLabel(recipe: RecipeRow): string | null {
		if (recipe.prepTimeMin == null && recipe.cookTimeMin == null) return null;
		const total = (recipe.prepTimeMin ?? 0) + (recipe.cookTimeMin ?? 0);
		return `⏱ ${total} min`;
	}

	function lastPlannedLabel(recipe: RecipeRow): string | null {
		if (!recipe.lastPlannedDate) return null;
		const then = new Date(recipe.lastPlannedDate + 'T12:00:00');
		const days = Math.round((Date.now() - then.getTime()) / 86400000);
		if (days <= 0) return 'planlagt i dag';
		if (days < 7) return `sist: for ${days} d siden`;
		const weeks = Math.round(days / 7);
		return `sist: for ${weeks} ${weeks === 1 ? 'uke' : 'uker'} siden`;
	}

	function handleSaved(saved: RecipeLike) {
		recipes = recipes.map((recipe) =>
			recipe.id === saved.id ? { ...recipe, ...saved } : recipe
		);
		selected = null;
	}

	function handleDeleted(id: string) {
		recipes = recipes.filter((recipe) => recipe.id !== id);
		selected = null;
	}
</script>

<div class="recipes-panel">
	<div class="recipes-create">
		<input
			class="recipes-create-input"
			bind:value={newTitle}
			placeholder="+ Ny oppskrift — bare navnet holder"
			onkeydown={(e) => e.key === 'Enter' && createRecipe()}
			data-track="oppskrifter:ny-oppskrift-navn"
		/>
		{#if newTitle.trim()}
			<button class="recipes-create-btn" onclick={createRecipe} disabled={creating} data-track="oppskrifter:opprett">
				{creating ? '…' : 'Legg til'}
			</button>
		{/if}
	</div>

	{#if recipes.length > 6 || query}
		<input
			class="recipes-search"
			bind:value={query}
			placeholder="Søk i kartoteket…"
			data-track="oppskrifter:sok"
		/>
	{/if}

	{#if loading}
		<div class="recipes-list">
			<Skeleton height="64px" />
			<Skeleton height="64px" />
			<Skeleton height="64px" />
		</div>
	{:else if filtered.length === 0}
		<div class="recipes-empty">
			{#if recipes.length === 0}
				<p>Kartoteket er tomt. Legg inn familiens faste middager over — bare navnet holder, detaljer kan fylles inn senere.</p>
				<p class="recipes-empty-hint">Tips: tag favoritter med «favoritt» og kjappe retter med «rask» — det påvirker ukeforslagene.</p>
			{:else}
				<p>Ingen treff på «{query}».</p>
			{/if}
		</div>
	{:else}
		<SectionLabel tag="h2">{filtered.length} {filtered.length === 1 ? 'oppskrift' : 'oppskrifter'}</SectionLabel>
		<div class="recipes-list">
			{#each filtered as recipe (recipe.id)}
				<button class="recipe-card" onclick={() => (selected = recipe)} data-track="oppskrifter:apne">
					<div class="recipe-card-main">
						<span class="recipe-title">{recipe.title}</span>
						<div class="recipe-meta">
							{#if timeLabel(recipe)}<span>{timeLabel(recipe)}</span>{/if}
							{#if lastPlannedLabel(recipe)}<span>{lastPlannedLabel(recipe)}</span>{/if}
							{#if recipe.ingredients.length > 0}<span>{recipe.ingredients.length} ingredienser</span>{/if}
						</div>
					</div>
					{#if recipe.tags.length > 0}
						<div class="recipe-tags">
							{#each recipe.tags.slice(0, 3) as tag}
								<span class="recipe-tag">{tag}</span>
							{/each}
						</div>
					{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>

{#if selected}
	<RecipeSheet
		recipe={selected}
		onclose={() => (selected = null)}
		onsaved={handleSaved}
		ondeleted={handleDeleted}
	/>
{/if}

<style>
	.recipes-panel {
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 16px var(--page-px, 20px) 40px;
	}
	.recipes-create {
		display: flex;
		gap: 8px;
	}
	.recipes-create-input,
	.recipes-search {
		flex: 1;
		background: var(--input-bg, rgba(255, 255, 255, 0.05));
		border: 1px solid var(--input-border, rgba(255, 255, 255, 0.1));
		border-radius: 12px;
		color: inherit;
		padding: 12px 14px;
		font-size: 0.95rem;
	}
	.recipes-create-btn {
		background: var(--accent-bg, rgba(124, 142, 245, 0.18));
		border: none;
		border-radius: 12px;
		color: var(--accent-fg, #aab8ff);
		padding: 0 18px;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
	}
	.recipes-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.recipe-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		background: var(--card-bg, rgba(255, 255, 255, 0.04));
		border: 1px solid var(--card-border, rgba(255, 255, 255, 0.07));
		border-radius: 14px;
		padding: 12px 14px;
		color: inherit;
		text-align: left;
		cursor: pointer;
	}
	.recipe-card-main {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}
	.recipe-title {
		font-weight: 600;
		font-size: 0.95rem;
	}
	.recipe-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		font-size: 0.78rem;
		color: var(--color-text-secondary, #999);
	}
	.recipe-tags {
		display: flex;
		gap: 4px;
		flex-shrink: 0;
	}
	.recipe-tag {
		background: rgba(255, 255, 255, 0.07);
		border-radius: 999px;
		padding: 3px 9px;
		font-size: 0.72rem;
		color: var(--color-text-secondary, #bbb);
		white-space: nowrap;
	}
	.recipes-empty {
		padding: 24px 8px;
		color: var(--color-text-secondary, #999);
		font-size: 0.92rem;
		line-height: 1.5;
	}
	.recipes-empty-hint {
		font-size: 0.82rem;
		opacity: 0.8;
	}
</style>
