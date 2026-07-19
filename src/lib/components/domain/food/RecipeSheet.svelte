<!--
  RecipeSheet — bottom-sheet for å se/redigere én oppskrift (meals-rad).
  Rask oppretting krever bare navn; alt annet (ingredienser, instruksjoner,
  tider, tags) er valgfritt og kan fylles inn når som helst.
-->
<script lang="ts">
	import BottomSheet from '../../ui/BottomSheet.svelte';
	import Button from '../../ui/Button.svelte';
	import { COMPOSITION_AXES } from '$lib/domains/food/composition';

	type Ingredient = { name: string; quantity?: number | null; unit?: string | null; optional?: boolean };
	type NutritionEstimate = {
		kcal?: number;
		proteinG?: number;
		carbsG?: number;
		fatG?: number;
		confidence?: number;
		source: 'vision' | 'manual' | 'recipe-derived';
	} | null;

	export type RecipeLike = {
		id: string;
		title: string;
		description?: string | null;
		ingredients: Ingredient[];
		instructions: string[];
		prepTimeMin?: number | null;
		cookTimeMin?: number | null;
		servings: number;
		tags: string[];
		mainProtein?: string | null;
		mainCarb?: string | null;
		greens?: string | null;
		wantMore?: boolean;
		effortLevel?: string | null;
		nutritionEstimate?: NutritionEstimate;
		sourceUrl?: string | null;
	};

	const EFFORT_LEVELS: Array<{ value: string; label: string }> = [
		{ value: 'lav', label: 'Lav' },
		{ value: 'middels', label: 'Middels' },
		{ value: 'høy', label: 'Høy' }
	];

	interface Props {
		recipe: RecipeLike;
		onclose: () => void;
		onsaved: (recipe: RecipeLike) => void;
		ondeleted: (id: string) => void;
	}

	let { recipe, onclose, onsaved, ondeleted }: Props = $props();

	let title = $state(recipe.title);
	let description = $state(recipe.description ?? '');
	let ingredients = $state<Ingredient[]>(recipe.ingredients.length ? [...recipe.ingredients] : []);
	let instructionsText = $state(recipe.instructions.join('\n'));
	let prepTimeMin = $state<string>(recipe.prepTimeMin != null ? String(recipe.prepTimeMin) : '');
	let cookTimeMin = $state<string>(recipe.cookTimeMin != null ? String(recipe.cookTimeMin) : '');
	let servings = $state<string>(String(recipe.servings ?? 5));
	let tagsText = $state(recipe.tags.join(', '));
	let mainProtein = $state(recipe.mainProtein ?? '');
	let mainCarb = $state(recipe.mainCarb ?? '');
	let greens = $state(recipe.greens ?? '');
	let wantMore = $state(recipe.wantMore ?? false);
	let effortLevel = $state(recipe.effortLevel ?? '');
	let kcal = $state<string>(recipe.nutritionEstimate?.kcal != null ? String(recipe.nutritionEstimate.kcal) : '');
	let proteinG = $state<string>(recipe.nutritionEstimate?.proteinG != null ? String(recipe.nutritionEstimate.proteinG) : '');
	let sourceUrl = $state(recipe.sourceUrl ?? '');
	let saving = $state(false);
	let error = $state('');

	function toggleEffort(value: string) {
		effortLevel = effortLevel === value ? '' : value;
	}

	function addIngredientRow() {
		ingredients = [...ingredients, { name: '', quantity: null, unit: null }];
	}

	function removeIngredientRow(index: number) {
		ingredients = ingredients.filter((_, i) => i !== index);
	}

	// Norsk mobiltastatur gir komma i desimalfelt — Number('0,5') er NaN.
	function parseDecimalInput(value: unknown): number | null {
		const text = String(value ?? '').trim().replace(',', '.');
		if (!text) return null;
		const parsed = Number(text);
		return Number.isFinite(parsed) ? parsed : null;
	}

	async function save() {
		if (!title.trim()) {
			error = 'Oppskriften trenger et navn.';
			return;
		}
		saving = true;
		error = '';
		const kcalVal = parseDecimalInput(kcal);
		const proteinVal = parseDecimalInput(proteinG);
		// Behold eksisterende estimat (f.eks. fra bilde) og overstyr bare det brukeren fyller inn.
		const prevNutrition = recipe.nutritionEstimate ?? null;
		let nutritionEstimate: NutritionEstimate = prevNutrition;
		if (kcalVal != null || proteinVal != null) {
			nutritionEstimate = {
				...(prevNutrition ?? {}),
				...(kcalVal != null ? { kcal: kcalVal } : {}),
				...(proteinVal != null ? { proteinG: proteinVal } : {}),
				source: 'manual'
			};
		} else if (prevNutrition && (prevNutrition.kcal != null || prevNutrition.proteinG != null)) {
			// Brukeren tømte begge felt → nullstill manuelt estimat.
			nutritionEstimate = null;
		}
		const payload = {
			id: recipe.id,
			title: title.trim(),
			description: description.trim() || null,
			mainProtein: mainProtein || null,
			mainCarb: mainCarb || null,
			greens: greens || null,
			wantMore,
			effortLevel: effortLevel || null,
			nutritionEstimate,
			ingredients: ingredients
				.filter((ing) => ing.name.trim())
				.map((ing) => ({
					name: ing.name.trim(),
					quantity: parseDecimalInput(ing.quantity),
					unit: ing.unit?.trim() || null,
					...(ing.optional ? { optional: true } : {})
				})),
			instructions: instructionsText
				.split('\n')
				.map((line) => line.trim())
				.filter(Boolean),
			prepTimeMin: parseDecimalInput(prepTimeMin),
			cookTimeMin: parseDecimalInput(cookTimeMin),
			servings: parseDecimalInput(servings) ?? 5,
			tags: tagsText
				.split(',')
				.map((t) => t.trim())
				.filter(Boolean),
			sourceUrl: sourceUrl.trim() || null
		};
		try {
			const res = await fetch(`/api/food/recipes/${recipe.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});
			if (!res.ok) throw new Error('save_failed');
			const data = await res.json();
			onsaved(data.meal ?? { ...recipe, ...payload });
		} catch {
			error = 'Klarte ikke lagre oppskriften. Prøv igjen.';
		} finally {
			saving = false;
		}
	}

	async function deleteRecipe() {
		if (!confirm(`Slette «${recipe.title}» fra kartoteket?`)) return;
		saving = true;
		try {
			const res = await fetch(`/api/food/recipes/${recipe.id}`, { method: 'DELETE' });
			if (!res.ok) throw new Error('delete_failed');
			ondeleted(recipe.id);
		} catch {
			error = 'Klarte ikke slette oppskriften.';
			saving = false;
		}
	}
</script>

<BottomSheet {onclose} ariaLabel="Rediger oppskrift">
	<header class="rs-header">
		<h2>🍲 Oppskrift</h2>
		<button class="rs-close" onclick={onclose} aria-label="Lukk oppskrift">✕</button>
	</header>

	<div class="rs-body">
		<label class="rs-field">
			<span class="rs-label">Navn</span>
			<input class="rs-input" bind:value={title} placeholder="F.eks. Fiskegrateng" data-track="oppskrifter:navn" />
		</label>

		<label class="rs-field">
			<span class="rs-label">Beskrivelse</span>
			<textarea class="rs-input" bind:value={description} rows="2" placeholder="Valgfritt" data-track="oppskrifter:beskrivelse"></textarea>
		</label>

		<div class="rs-field">
			<span class="rs-label">Sammensetning <span class="rs-hint">(valgfritt — lar oss lage varianter ved å bytte)</span></span>
			<div class="rs-row3">
				<label class="rs-sub">
					<span class="rs-sublabel">Protein</span>
					<select class="rs-input" bind:value={mainProtein} data-track="oppskrifter:hovedprotein">
						<option value="">–</option>
						{#each COMPOSITION_AXES.protein.options as opt}
							<option value={opt.key}>{opt.emoji} {opt.label}</option>
						{/each}
					</select>
				</label>
				<label class="rs-sub">
					<span class="rs-sublabel">Karbo</span>
					<select class="rs-input" bind:value={mainCarb} data-track="oppskrifter:hovedkarbo">
						<option value="">–</option>
						{#each COMPOSITION_AXES.carb.options as opt}
							<option value={opt.key}>{opt.emoji} {opt.label}</option>
						{/each}
					</select>
				</label>
				<label class="rs-sub">
					<span class="rs-sublabel">Grønt</span>
					<select class="rs-input" bind:value={greens} data-track="oppskrifter:gront">
						<option value="">–</option>
						{#each COMPOSITION_AXES.greens.options as opt}
							<option value={opt.key}>{opt.emoji} {opt.label}</option>
						{/each}
					</select>
				</label>
			</div>
			<p class="rs-hint rs-note">La feltene stå tomme for retter som ikke passer modellen (suppe, taco, pizza, pannekaker).</p>
		</div>

		<div class="rs-field">
			<span class="rs-label">Innsats</span>
			<div class="rs-segment" role="group" aria-label="Innsatsnivå">
				{#each EFFORT_LEVELS as level}
					<button
						type="button"
						class="rs-seg-btn"
						class:active={effortLevel === level.value}
						onclick={() => toggleEffort(level.value)}
						data-track="oppskrifter:innsats"
					>{level.label}</button>
				{/each}
			</div>
		</div>

		<label class="rs-toggle">
			<input type="checkbox" bind:checked={wantMore} data-track="oppskrifter:onsker-mer" />
			<span>⭐ Ønsker mer av denne <span class="rs-hint">(dukker oftere opp i forslag)</span></span>
		</label>

		<div class="rs-field">
			<span class="rs-label">Ernæring <span class="rs-hint">(per porsjon, valgfritt)</span></span>
			<div class="rs-row2">
				<label class="rs-sub">
					<span class="rs-sublabel">Kcal</span>
					<input class="rs-input" bind:value={kcal} inputmode="numeric" placeholder="–" data-track="oppskrifter:kcal" />
				</label>
				<label class="rs-sub">
					<span class="rs-sublabel">Protein (g)</span>
					<input class="rs-input" bind:value={proteinG} inputmode="numeric" placeholder="–" data-track="oppskrifter:protein-g" />
				</label>
			</div>
		</div>

		<div class="rs-field">
			<span class="rs-label">Ingredienser</span>
			{#each ingredients as ing, i}
				<div class="rs-ing-row">
					<input
						class="rs-ing-name"
						bind:value={ing.name}
						placeholder="Ingrediens"
						data-track="oppskrifter:ingrediens-navn"
					/>
					<input
						class="rs-ing-qty"
						bind:value={ing.quantity}
						placeholder="Mengde"
						inputmode="decimal"
						data-track="oppskrifter:ingrediens-mengde"
					/>
					<input
						class="rs-ing-unit"
						bind:value={ing.unit}
						placeholder="Enhet"
						data-track="oppskrifter:ingrediens-enhet"
					/>
					<button class="rs-ing-remove" onclick={() => removeIngredientRow(i)} aria-label="Fjern ingrediens">✕</button>
				</div>
			{/each}
			<button class="rs-add-row" onclick={addIngredientRow} data-track="oppskrifter:ny-ingrediens">
				+ Legg til ingrediens
			</button>
		</div>

		<label class="rs-field">
			<span class="rs-label">Fremgangsmåte <span class="rs-hint">(ett steg per linje)</span></span>
			<textarea class="rs-input" bind:value={instructionsText} rows="4" placeholder="Valgfritt" data-track="oppskrifter:fremgangsmate"></textarea>
		</label>

		<div class="rs-row3">
			<label class="rs-field">
				<span class="rs-label">Prep (min)</span>
				<input class="rs-input" bind:value={prepTimeMin} inputmode="numeric" placeholder="–" data-track="oppskrifter:prep-tid" />
			</label>
			<label class="rs-field">
				<span class="rs-label">Koketid (min)</span>
				<input class="rs-input" bind:value={cookTimeMin} inputmode="numeric" placeholder="–" data-track="oppskrifter:koketid" />
			</label>
			<label class="rs-field">
				<span class="rs-label">Porsjoner</span>
				<input class="rs-input" bind:value={servings} inputmode="numeric" data-track="oppskrifter:porsjoner" />
			</label>
		</div>

		<label class="rs-field">
			<span class="rs-label">Tags <span class="rs-hint">(kommaseparert — «favoritt» og «rask» påvirker forslag)</span></span>
			<input class="rs-input" bind:value={tagsText} placeholder="favoritt, rask, fisk" data-track="oppskrifter:tags" />
		</label>

		<label class="rs-field">
			<span class="rs-label">Kilde-URL</span>
			<input class="rs-input" bind:value={sourceUrl} placeholder="https://…" data-track="oppskrifter:kilde" />
		</label>

		{#if error}<p class="rs-error">{error}</p>{/if}
	</div>

	<footer class="rs-footer">
		<button class="rs-delete" onclick={deleteRecipe} disabled={saving} data-track="oppskrifter:slett">
			Slett
		</button>
		<Button onClick={save} disabled={saving}>
			{saving ? 'Lagrer…' : 'Lagre'}
		</Button>
	</footer>
</BottomSheet>

<style>
	.rs-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 18px 20px 10px;
	}
	.rs-header h2 {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 700;
	}
	.rs-close {
		background: none;
		border: none;
		color: var(--color-text-secondary, #999);
		font-size: 1rem;
		cursor: pointer;
		padding: 6px;
	}
	.rs-body {
		overflow-y: auto;
		padding: 4px 20px 16px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.rs-field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.rs-label {
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--color-text-secondary, #999);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.rs-hint {
		text-transform: none;
		letter-spacing: 0;
		font-weight: 400;
	}
	.rs-row3 {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		gap: 10px;
	}
	.rs-row2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	.rs-sub {
		display: flex;
		flex-direction: column;
		gap: 5px;
		min-width: 0;
	}
	.rs-sublabel {
		font-size: 0.72rem;
		font-weight: 500;
		color: var(--color-text-secondary, #999);
	}
	.rs-note {
		margin: 2px 0 0;
	}
	.rs-segment {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		gap: 6px;
	}
	.rs-seg-btn {
		background: var(--input-bg, #1a1a1a);
		border: 1px solid var(--input-border, #2a2a2a);
		border-radius: 10px;
		color: var(--color-text-secondary, #999);
		padding: 10px;
		font-size: 0.88rem;
		font-family: inherit;
		cursor: pointer;
	}
	.rs-seg-btn.active {
		background: color-mix(in srgb, var(--accent-light) 18%, transparent);
		border-color: var(--accent-light);
		color: var(--accent-light);
		font-weight: 600;
	}
	.rs-toggle {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 0.9rem;
		cursor: pointer;
	}
	.rs-toggle input {
		width: 18px;
		height: 18px;
		accent-color: var(--accent-primary);
		flex-shrink: 0;
	}
	.rs-ing-row {
		display: grid;
		grid-template-columns: 1fr 64px 64px 32px;
		gap: 6px;
		margin-bottom: 6px;
	}
	.rs-input {
		background: var(--input-bg, #1a1a1a);
		border: 1px solid var(--input-border, #2a2a2a);
		border-radius: 10px;
		color: inherit;
		padding: 10px 12px;
		font-size: 0.92rem;
		width: 100%;
		font-family: inherit;
		resize: vertical;
	}
	.rs-ing-row input {
		background: var(--input-bg, #1a1a1a);
		border: 1px solid var(--input-border, #2a2a2a);
		border-radius: 8px;
		color: inherit;
		padding: 8px 10px;
		font-size: 0.9rem;
		min-width: 0;
	}
	.rs-ing-remove {
		background: none;
		border: none;
		color: var(--color-text-secondary, #777);
		cursor: pointer;
		font-size: 0.85rem;
	}
	.rs-add-row {
		background: none;
		border: 1px dashed var(--input-border, #333);
		border-radius: 8px;
		color: var(--color-text-secondary, #999);
		padding: 8px;
		font-size: 0.85rem;
		cursor: pointer;
		text-align: center;
	}
	.rs-error {
		color: var(--error-text);
		font-size: 0.85rem;
		margin: 0;
	}
	.rs-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 12px 20px calc(16px + env(safe-area-inset-bottom));
		border-top: 1px solid var(--sheet-border, #222);
	}
	.rs-delete {
		background: none;
		border: none;
		color: var(--error-text);
		font-size: 0.9rem;
		cursor: pointer;
		padding: 8px 4px;
	}
</style>
