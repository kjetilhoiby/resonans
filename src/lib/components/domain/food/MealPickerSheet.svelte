<!--
  MealPickerSheet — velg middag for én dag i onsdagsøkta: forslags-chips,
  søk i kartoteket, fritekst (ny rett lagres i kartoteket) eller hopp over.
-->
<script lang="ts">
	import BottomSheet from '../../ui/BottomSheet.svelte';

	type Choice = { mealId?: string; title: string };
	type Suggestion = { mealId: string; title: string; reason: string };
	type Recipe = { id: string; title: string; tags: string[] };

	interface Props {
		dayLabel: string;
		suggestion: Suggestion | null;
		alternatives: Suggestion[];
		recipes: Recipe[];
		onpick: (choice: Choice) => void;
		onskip: () => void;
		onaskai: () => void;
		onclose: () => void;
	}

	let { dayLabel, suggestion, alternatives, recipes, onpick, onskip, onaskai, onclose }: Props = $props();

	let query = $state('');

	const chips = $derived(
		[suggestion, ...alternatives].filter((s): s is Suggestion => s !== null)
	);

	const searchResults = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return [];
		return recipes
			.filter((r) => r.title.toLowerCase().includes(q) || r.tags.some((t) => t.toLowerCase().includes(q)))
			.slice(0, 8);
	});

	const exactMatch = $derived(
		recipes.some((r) => r.title.toLowerCase() === query.trim().toLowerCase())
	);
</script>

<BottomSheet {onclose} ariaLabel="Velg middag">
	<header class="mp-header">
		<h2>🍽️ Middag {dayLabel}</h2>
		<button class="mp-close" onclick={onclose} aria-label="Lukk middagsvelger">✕</button>
	</header>

	<div class="mp-body">
		{#if chips.length > 0}
			<div class="mp-section">
				<span class="mp-label">Forslag</span>
				<div class="mp-chips">
					{#each chips as chip}
						<button
							class="mp-chip"
							onclick={() => onpick({ mealId: chip.mealId, title: chip.title })}
							data-track="matplan:velg-forslag"
						>
							<span class="mp-chip-title">{chip.title}</span>
							<span class="mp-chip-reason">{chip.reason}</span>
						</button>
					{/each}
				</div>
			</div>
		{/if}

		<div class="mp-section">
			<span class="mp-label">Søk eller skriv ny rett</span>
			<input
				class="mp-search"
				bind:value={query}
				placeholder="F.eks. fiskegrateng…"
				onkeydown={(e) => {
					if (e.key === 'Enter' && query.trim()) onpick({ title: query.trim() });
				}}
				data-track="matplan:sok-rett"
			/>
			{#if searchResults.length > 0}
				<div class="mp-results">
					{#each searchResults as recipe}
						<button
							class="mp-result"
							onclick={() => onpick({ mealId: recipe.id, title: recipe.title })}
							data-track="matplan:velg-fra-kartotek"
						>
							{recipe.title}
						</button>
					{/each}
				</div>
			{/if}
			{#if query.trim() && !exactMatch}
				<button class="mp-create" onclick={() => onpick({ title: query.trim() })} data-track="matplan:ny-rett">
					+ «{query.trim()}» — ny rett, lagres i kartoteket
				</button>
			{/if}
		</div>

		<div class="mp-footer-actions">
			<button class="mp-secondary" onclick={onskip} data-track="matplan:hopp-over-dag">
				Hopp over dagen
			</button>
			<button class="mp-secondary" onclick={onaskai} data-track="matplan:spor-ai">
				✨ Spør AI
			</button>
		</div>
	</div>
</BottomSheet>

<style>
	.mp-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 18px 20px 8px;
	}
	.mp-header h2 {
		margin: 0;
		font-size: 1.02rem;
		font-weight: 700;
		text-transform: capitalize;
	}
	.mp-close {
		background: none;
		border: none;
		color: var(--color-text-secondary, #999);
		cursor: pointer;
		padding: 6px;
	}
	.mp-body {
		overflow-y: auto;
		padding: 6px 20px calc(20px + env(safe-area-inset-bottom));
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	.mp-section {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.mp-label {
		font-size: 0.76rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-secondary, #999);
	}
	.mp-chips {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.mp-chip {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
		background: rgba(124, 142, 245, 0.1);
		border: 1px solid rgba(124, 142, 245, 0.25);
		border-radius: 12px;
		color: inherit;
		padding: 12px 14px;
		cursor: pointer;
		text-align: left;
	}
	.mp-chip-title {
		font-weight: 600;
		font-size: 0.93rem;
	}
	.mp-chip-reason {
		font-size: 0.75rem;
		color: var(--color-text-secondary, #9aa4d6);
		white-space: nowrap;
	}
	.mp-search {
		background: var(--input-bg, rgba(255, 255, 255, 0.05));
		border: 1px solid var(--input-border, rgba(255, 255, 255, 0.1));
		border-radius: 12px;
		color: inherit;
		padding: 12px 14px;
		font-size: 0.95rem;
	}
	.mp-results {
		display: flex;
		flex-direction: column;
	}
	.mp-result {
		background: none;
		border: none;
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
		color: inherit;
		padding: 11px 4px;
		font-size: 0.92rem;
		text-align: left;
		cursor: pointer;
	}
	.mp-create {
		background: none;
		border: 1px dashed rgba(255, 255, 255, 0.2);
		border-radius: 10px;
		color: var(--color-text-secondary, #bbb);
		padding: 11px;
		font-size: 0.86rem;
		cursor: pointer;
		text-align: left;
	}
	.mp-footer-actions {
		display: flex;
		gap: 10px;
	}
	.mp-secondary {
		flex: 1;
		background: rgba(255, 255, 255, 0.06);
		border: none;
		border-radius: 12px;
		color: var(--color-text-secondary, #ccc);
		padding: 12px;
		font-size: 0.88rem;
		cursor: pointer;
	}
</style>
