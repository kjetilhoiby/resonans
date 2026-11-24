<!--
  MealCardSheet — middagskortet: oppskriften, mengdene for familien og det
  familien har erfart med retten, samlet ett sted. Erfaringene er notatene fra
  kveldene retten ble spist (meal_plans.notes), så historikken bor på planradene
  og overlever en sammenslåing av duplikater. Se
  docs/changelog/2026-11-24-middagsplanen-som-fasit.md.
-->
<script lang="ts">
	import BottomSheet from '../../ui/BottomSheet.svelte';
	import { extractApiErrorMessage } from '$lib/client/api-error';
	import { MEAL_LOG_READING_LABEL, type MealLogReading } from '$lib/domains/food/meal-log';

	type Ingredient = { name: string; quantity?: number | null; unit?: string | null; optional?: boolean };

	type MealCard = {
		meal: {
			id: string;
			title: string;
			description: string | null;
			ingredients: Ingredient[];
			instructions: string[];
			servings: number;
			prepTimeMin: number | null;
			cookTimeMin: number | null;
			sourceUrl: string | null;
		};
		favorite: boolean;
		takeaway: boolean;
		familyServings: number;
		familyIngredients: Ingredient[];
		history: {
			timesEaten: number;
			timesSkipped: number;
			lastEaten: string | null;
			nextPlanned: string | null;
			occurrences: Array<{ planId: string; date: string; reading: MealLogReading; notes: string | null }>;
			experiences: Array<{ planId: string; date: string; text: string }>;
		};
		duplicates: Array<{ id: string; title: string }>;
	};

	interface Props {
		mealId: string;
		onclose: () => void;
		/** Åpne oppskriftsredigeringen for retten. Uten den vises ingen redigerknapp. */
		onedit?: (mealId: string) => void;
		/** Kartoteket endret seg (sammenslåing). */
		onchanged?: () => void;
	}

	let { mealId, onclose, onedit, onchanged }: Props = $props();

	let card = $state<MealCard | null>(null);
	let error = $state('');
	let family = $state(true);
	let merging = $state<string | null>(null);

	async function load(id: string) {
		error = '';
		try {
			const res = await fetch(`/api/food/recipes/${encodeURIComponent(id)}/kort`);
			if (!res.ok) throw new Error(extractApiErrorMessage(res.status, await res.text()));
			card = await res.json();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Klarte ikke hente middagskortet.';
		}
	}

	$effect(() => {
		load(mealId);
	});

	const ingredients = $derived(card ? (family ? card.familyIngredients : card.meal.ingredients) : []);
	const totalMinutes = $derived(
		card && (card.meal.prepTimeMin != null || card.meal.cookTimeMin != null)
			? (card.meal.prepTimeMin ?? 0) + (card.meal.cookTimeMin ?? 0)
			: null
	);

	function formatDate(iso: string): string {
		return new Date(iso + 'T12:00:00').toLocaleDateString('no-NO', { day: 'numeric', month: 'short', year: 'numeric' });
	}

	function formatQuantity(ing: Ingredient): string {
		if (ing.quantity == null) return '';
		const q = String(ing.quantity).replace('.', ',');
		return ing.unit ? `${q} ${ing.unit}` : q;
	}

	async function merge(duplicateId: string) {
		if (!card || merging) return;
		merging = duplicateId;
		error = '';
		try {
			const res = await fetch(`/api/food/recipes/${encodeURIComponent(card.meal.id)}/merge`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ duplicateId })
			});
			if (!res.ok) throw new Error(extractApiErrorMessage(res.status, await res.text()));
			await load(card.meal.id);
			onchanged?.();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Sammenslåingen feilet.';
		} finally {
			merging = null;
		}
	}
</script>

<BottomSheet {onclose} ariaLabel="Middagskort">
	<div class="mc">
		{#if !card}
			<button class="mc-title" onclick={onclose} aria-label="Lukk">Middagskort</button>
			{#if error}<p class="mc-error" role="alert">{error}</p>{:else}<p class="mc-muted">Henter …</p>{/if}
		{:else}
			<header class="mc-head">
				<button class="mc-title" onclick={onclose} aria-label="Lukk middagskortet">{card.meal.title}</button>
				<div class="mc-badges">
					{#if card.favorite}<span class="mc-badge">⭐ Favoritt</span>{/if}
					{#if card.takeaway}<span class="mc-badge">🥡 Takeaway</span>{/if}
					{#if totalMinutes}<span class="mc-badge">⏱ {totalMinutes} min</span>{/if}
				</div>
				{#if card.meal.description}<p class="mc-desc">{card.meal.description}</p>{/if}
			</header>

			<p class="mc-stats">
				{#if card.history.timesEaten > 0}
					Spist {card.history.timesEaten} {card.history.timesEaten === 1 ? 'gang' : 'ganger'}, sist {formatDate(card.history.lastEaten!)}.
				{:else}
					Ikke registrert spist ennå.
				{/if}
				{#if card.history.nextPlanned}Neste gang: {formatDate(card.history.nextPlanned)}.{/if}
			</p>

			{#if card.duplicates.length > 0}
				<section class="mc-section mc-dup">
					<span class="mc-label">Samme rett finnes flere ganger</span>
					{#each card.duplicates as dup (dup.id)}
						<div class="mc-dup-row">
							<span>«{dup.title}»</span>
							<button class="mc-button" disabled={merging !== null} onclick={() => merge(dup.id)} data-track="middagskort:slaa-sammen">
								{merging === dup.id ? 'Slår sammen …' : 'Slå sammen hit'}
							</button>
						</div>
					{/each}
					<p class="mc-muted">Planer og erfaringer flyttes over; ingenting av historikken går tapt.</p>
				</section>
			{/if}

			<section class="mc-section">
				<div class="mc-label-row">
					<span class="mc-label">Ingredienser</span>
					{#if card.meal.ingredients.length > 0 && card.meal.servings !== card.familyServings}
						<div class="mc-toggle" role="group" aria-label="Mengder">
							<button class:active={family} onclick={() => (family = true)} data-track="middagskort:familiemengde">Familien ({card.familyServings})</button>
							<button class:active={!family} onclick={() => (family = false)} data-track="middagskort:oppskriftsmengde">Oppskriften ({card.meal.servings})</button>
						</div>
					{/if}
				</div>
				{#if ingredients.length === 0}
					<p class="mc-muted">Ingen ingredienser registrert.</p>
				{:else}
					<ul class="mc-ingredients">
						{#each ingredients as ing, i (i)}
							<li>
								<span class="mc-qty">{formatQuantity(ing)}</span>
								<span>{ing.name}{#if ing.optional}{' '}<span class="mc-muted">(valgfri)</span>{/if}</span>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			{#if card.meal.instructions.length > 0}
				<section class="mc-section">
					<span class="mc-label">Slik gjør du</span>
					<ol class="mc-steps">
						{#each card.meal.instructions as step, i (i)}<li>{step}</li>{/each}
					</ol>
				</section>
			{/if}

			<section class="mc-section">
				<span class="mc-label">Erfaringer</span>
				{#if card.history.experiences.length === 0}
					<p class="mc-muted">Ingen ennå. Skriv en på middagen i planen — den havner her.</p>
				{:else}
					<ul class="mc-experiences">
						{#each card.history.experiences as exp (exp.planId)}
							<li><span class="mc-muted">{formatDate(exp.date)}</span> {exp.text}</li>
						{/each}
					</ul>
				{/if}
			</section>

			{#if card.history.occurrences.length > 0}
				<details class="mc-section">
					<summary class="mc-label">Historikk ({card.history.occurrences.length})</summary>
					<ul class="mc-history">
						{#each card.history.occurrences as occ (occ.planId)}
							<li><span>{formatDate(occ.date)}</span><span class="mc-muted">{MEAL_LOG_READING_LABEL[occ.reading]}</span></li>
						{/each}
					</ul>
				</details>
			{/if}

			<div class="mc-actions">
				{#if onedit}
					<button class="mc-button" onclick={() => onedit?.(card!.meal.id)} data-track="middagskort:rediger">Rediger oppskrift</button>
				{/if}
				{#if card.meal.sourceUrl}
					<a class="mc-link" href={card.meal.sourceUrl} target="_blank" rel="noopener noreferrer">Original oppskrift ↗</a>
				{/if}
			</div>
			{#if error}<p class="mc-error" role="alert">{error}</p>{/if}
		{/if}
	</div>
</BottomSheet>

<style>
	.mc {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 18px 20px calc(20px + env(safe-area-inset-bottom));
		overflow-y: auto;
		color: var(--text-primary);
	}
	.mc-head {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.mc-title {
		background: none;
		border: none;
		padding: 0;
		color: inherit;
		text-align: left;
		cursor: pointer;
		font-size: var(--font-size-title, 1rem);
		font-weight: 700;
	}
	.mc-badges {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.mc-badge {
		font-size: var(--font-size-caption, 0.72rem);
		padding: 3px 8px;
		border-radius: 999px;
		border: 1px solid var(--border-color);
		color: var(--text-secondary);
	}
	.mc-desc,
	.mc-stats {
		margin: 0;
		font-size: var(--font-size-body, 0.9rem);
		color: var(--text-secondary);
	}
	.mc-section {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.mc-dup {
		padding: 10px 12px;
		border-radius: 12px;
		background: var(--warning-bg);
		border: 1px solid var(--warning-border);
	}
	.mc-dup-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		font-size: var(--font-size-body, 0.9rem);
	}
	.mc-label-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}
	.mc-label {
		font-size: var(--font-size-label, 0.78rem);
		font-weight: 600;
		color: var(--text-secondary);
	}
	summary.mc-label {
		cursor: pointer;
	}
	.mc-toggle {
		display: flex;
		flex-shrink: 0;
		border: 1px solid var(--border-color);
		border-radius: 999px;
		overflow: hidden;
	}
	.mc-toggle button {
		background: none;
		border: none;
		padding: 4px 10px;
		font-size: var(--font-size-caption, 0.72rem);
		color: var(--text-secondary);
		cursor: pointer;
	}
	.mc-toggle button.active {
		background: var(--accent-primary);
		color: var(--accent-contrast);
	}
	.mc-ingredients,
	.mc-experiences,
	.mc-history {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: var(--font-size-body, 0.9rem);
	}
	.mc-ingredients li {
		display: flex;
		gap: 10px;
	}
	.mc-qty {
		min-width: 64px;
		flex-shrink: 0;
		color: var(--text-secondary);
		font-variant-numeric: tabular-nums;
	}
	.mc-history li {
		display: flex;
		justify-content: space-between;
		gap: 10px;
	}
	.mc-steps {
		margin: 0;
		padding-left: 20px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: var(--font-size-body, 0.9rem);
	}
	.mc-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 12px;
	}
	.mc-button {
		background: var(--bg-input);
		border: 1px solid var(--border-color);
		border-radius: 10px;
		color: var(--text-primary);
		padding: 7px 12px;
		font-size: var(--font-size-body, 0.9rem);
		cursor: pointer;
		flex-shrink: 0;
	}
	.mc-button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.mc-link {
		color: var(--accent-primary);
		font-size: var(--font-size-body, 0.9rem);
	}
	.mc-muted {
		margin: 0;
		color: var(--text-secondary);
		font-size: var(--font-size-caption, 0.72rem);
	}
	.mc-error {
		margin: 0;
		color: var(--error-text);
		font-size: var(--font-size-caption, 0.72rem);
	}
</style>
