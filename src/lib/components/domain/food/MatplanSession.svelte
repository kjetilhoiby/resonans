<!--
  MatplanSession — «onsdagsøkta»: planlegg neste ukes middager og ferdigstill
  Oda-bestillingen i én økt. Tre steg: (1) velg middager per dag (forhåndsutfylt
  med forslag), (2) juster handlelisten, (3) Oda-modus med søkelenker + kopier.
  Fullskjerms fokusmodus; skal kunne fullføres på mobil på under 10 minutter.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import MealPickerSheet from './MealPickerSheet.svelte';
	import ShoppingListView from './ShoppingListView.svelte';
	import Skeleton from '../../ui/Skeleton.svelte';

	type Suggestion = { mealId: string; title: string; reason: string };
	type DayState = {
		date: string;
		chosen: Array<{ mealId?: string; title: string }>;
		skipped: boolean;
		suggestion: Suggestion | null;
		alternatives: Suggestion[];
	};
	type ShoppingItem = {
		id: string;
		name: string;
		normalizedName: string;
		quantity?: number | null;
		unit?: string | null;
		sources: string[];
		checked: boolean;
		manual: boolean;
		odaUrl?: string;
	};

	interface Props {
		onclose: () => void;
		/** Åpne temachat med forhåndsutfylt melding (AI-fluktvei). */
		onOpenChat?: (prefill: string) => void;
		/** Kalles når økta fullføres, så dashboardet kan refreshe. */
		oncompleted?: () => void;
	}

	let { onclose, onOpenChat, oncompleted }: Props = $props();

	let step = $state<1 | 2 | 3>(1);
	let loading = $state(true);
	let saving = $state(false);
	let weekContext = $state('');
	let days = $state<DayState[]>([]);
	let recipes = $state<Array<{ id: string; title: string; tags: string[] }>>([]);
	let pickerDayIndex = $state<number | null>(null);
	let listId = $state<string | null>(null);
	let listItems = $state<ShoppingItem[]>([]);
	let error = $state('');

	onMount(async () => {
		try {
			const [sessionRes, recipesRes] = await Promise.all([
				fetch('/api/food/week-session'),
				fetch('/api/food/recipes')
			]);
			if (!sessionRes.ok) throw new Error('load_failed');
			const session = await sessionRes.json();
			weekContext = session.weekContext;
			days = (session.days ?? []).map((day: {
				date: string;
				existingPlans: Array<{ mealId: string | null; mealTitle: string | null }>;
				suggestion: Suggestion | null;
				alternatives: Suggestion[];
			}) => ({
				date: day.date,
				chosen:
					day.existingPlans.length > 0
						? day.existingPlans
								.filter((plan) => plan.mealTitle)
								.map((plan) => ({ mealId: plan.mealId ?? undefined, title: plan.mealTitle! }))
						: day.suggestion
							? [{ mealId: day.suggestion.mealId, title: day.suggestion.title }]
							: [],
				skipped: false,
				suggestion: day.suggestion,
				alternatives: day.alternatives
			}));
			if (recipesRes.ok) {
				const data = await recipesRes.json();
				recipes = data.meals ?? [];
			}
		} catch {
			error = 'Klarte ikke laste ukesdata. Lukk og prøv igjen.';
		} finally {
			loading = false;
		}
	});

	function dayLabel(iso: string): string {
		return new Date(iso + 'T12:00:00').toLocaleDateString('no-NO', {
			weekday: 'long',
			day: 'numeric',
			month: 'short'
		});
	}

	const chosenCount = $derived(days.filter((d) => !d.skipped && d.chosen.length > 0).length);

	// 'replace' = vanlig bytt; 'add' = «+ middag» for kresne-barn-dager (2 retter)
	let pickerMode = $state<'replace' | 'add'>('replace');

	function pickMeal(choice: { mealId?: string; title: string }) {
		if (pickerDayIndex === null) return;
		days = days.map((d, i) =>
			i === pickerDayIndex
				? {
						...d,
						chosen: pickerMode === 'add' ? [...d.chosen, choice] : [choice],
						skipped: false
					}
				: d
		);
		pickerDayIndex = null;
		pickerMode = 'replace';
	}

	function skipDay() {
		if (pickerDayIndex === null) return;
		days = days.map((d, i) => (i === pickerDayIndex ? { ...d, chosen: [], skipped: true } : d));
		pickerDayIndex = null;
	}

	function removeMeal(dayIndex: number, mealIndex: number) {
		days = days.map((d, i) =>
			i === dayIndex ? { ...d, chosen: d.chosen.filter((_, mi) => mi !== mealIndex) } : d
		);
	}

	function askAi() {
		const date = pickerDayIndex !== null ? days[pickerDayIndex].date : null;
		pickerDayIndex = null;
		onclose();
		onOpenChat?.(
			date
				? `Foreslå en middag for ${dayLabel(date)} (${date}) og legg den i ukemenyen.`
				: 'Hjelp meg planlegge ukens middager.'
		);
	}

	let aiLoading = $state(false);

	// «Foreslå uka med AI» — GPT-forslag som tar hensyn til lager, historikk og
	// variasjon. Overskriver dagens valg (hopp-over-dager beholdes).
	async function aiSuggestWeek() {
		if (aiLoading) return;
		aiLoading = true;
		error = '';
		try {
			const res = await fetch('/api/food/week-session/ai-suggest', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ weekContext })
			});
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				error = data.error ?? 'AI-forslaget feilet. Prøv igjen.';
				return;
			}
			const data = await res.json();
			const byDate = new Map<string, { mealId: string | null; title: string; reason: string }>(
				(data.days ?? [])
					.filter((d: { suggestion: unknown }) => d.suggestion)
					.map((d: { date: string; suggestion: { mealId: string | null; title: string; reason: string } }) => [d.date, d.suggestion])
			);
			days = days.map((day) => {
				if (day.skipped) return day;
				const suggestion = byDate.get(day.date);
				if (!suggestion) return day;
				return {
					...day,
					chosen: [{ mealId: suggestion.mealId ?? undefined, title: suggestion.title }],
					suggestion: suggestion.mealId
						? { mealId: suggestion.mealId, title: suggestion.title, reason: suggestion.reason }
						: day.suggestion
				};
			});
		} finally {
			aiLoading = false;
		}
	}

	async function saveAndBuildList() {
		saving = true;
		error = '';
		try {
			const planRes = await fetch('/api/food/week-session/plan', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					weekContext,
					days: days.map((d) => ({
						date: d.date,
						meals: d.skipped ? [] : d.chosen.map((c) => ({ mealId: c.mealId, mealTitle: c.title }))
					}))
				})
			});
			if (!planRes.ok) throw new Error('plan_failed');

			const listRes = await fetch('/api/food/shopping-list/generate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ weekContext })
			});
			if (!listRes.ok) throw new Error('list_failed');
			const data = await listRes.json();
			listId = data.shoppingList.id;
			listItems = data.shoppingList.items;
			step = 2;
		} catch {
			error = 'Noe gikk galt ved lagring. Prøv igjen.';
		} finally {
			saving = false;
		}
	}

	async function finish() {
		if (listId) {
			await fetch(`/api/food/shopping-list/${listId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: 'final' })
			});
		}
		oncompleted?.();
		onclose();
	}
</script>

<div class="ms-overlay" transition:fade={{ duration: 180 }}>
	<header class="ms-header">
		<button class="ms-back" onclick={() => (step === 1 ? onclose() : (step = step === 3 ? 2 : 1))} aria-label={step === 1 ? 'Lukk matplan-økta' : 'Forrige steg'}>
			{step === 1 ? '✕' : '←'}
		</button>
		<div class="ms-title">
			<h1>Matplan {weekContext ? `uke ${weekContext.split('-W')[1]}` : ''}</h1>
			<div class="ms-dots" aria-label={`Steg ${step} av 3`}>
				{#each [1, 2, 3] as s}
					<span class="ms-dot" class:active={s === step} class:done={s < step}></span>
				{/each}
			</div>
		</div>
		<span class="ms-spacer"></span>
	</header>

	<div class="ms-body">
		{#if loading}
			<div class="ms-loading">
				<Skeleton height="72px" />
				<Skeleton height="72px" />
				<Skeleton height="72px" />
			</div>
		{:else if step === 1}
			<p class="ms-hint">Forslagene er basert på favoritter, variasjon og det som ligger i skap og fryser. Tapp en dag for å bytte.</p>
			<button class="ms-ai-btn" onclick={aiSuggestWeek} disabled={aiLoading} data-track="matplan:ai-foresla-uka">
				{aiLoading ? '✨ Tenker…' : '✨ Foreslå uka med AI'}
			</button>
			<div class="ms-days">
				{#each days as day, dayIndex (day.date)}
					<div class="ms-day" class:skipped={day.skipped}>
						<button class="ms-day-main" onclick={() => (pickerDayIndex = dayIndex)} data-track="matplan:velg-dag">
							<span class="ms-day-date">{dayLabel(day.date)}</span>
							{#if day.skipped}
								<span class="ms-day-meal ms-muted">Hopper over</span>
							{:else if day.chosen.length === 0}
								<span class="ms-day-meal ms-muted">Velg middag…</span>
							{:else}
								<span class="ms-day-meal">
									{#each day.chosen as choice}
										<span class="ms-meal-chip">🍽️ {choice.title}</span>
									{/each}
								</span>
								{#if !day.skipped && day.chosen.length === 1 && day.suggestion && day.chosen[0].mealId === day.suggestion.mealId}
									<span class="ms-day-reason">{day.suggestion.reason}</span>
								{/if}
							{/if}
						</button>
						{#if !day.skipped && day.chosen.length === 1}
							<button
								class="ms-add-meal"
								onclick={() => { pickerDayIndex = dayIndex; pickerMode = 'add'; }}
								aria-label={`Legg til middag nr. 2 for ${dayLabel(day.date)}`}
								data-track="matplan:middag-nr-2"
							>+</button>
						{:else if !day.skipped && day.chosen.length > 1}
							<button
								class="ms-add-meal"
								onclick={() => removeMeal(dayIndex, day.chosen.length - 1)}
								aria-label={`Fjern siste middag for ${dayLabel(day.date)}`}
								data-track="matplan:fjern-middag"
							>−</button>
						{/if}
					</div>
				{/each}
			</div>
		{:else if step === 2}
			<p class="ms-hint">Fjern det dere allerede har, og legg til faste varer (melk, brød, frukt til matpakkene …).</p>
			{#if listId}
				<ShoppingListView {listId} bind:items={listItems} editable />
			{/if}
		{:else}
			<p class="ms-hint">Åpne Oda og fyll handlekurven — hver vare har egen søkelenke, eller kopier hele lista.</p>
			{#if listId}
				<ShoppingListView {listId} bind:items={listItems} odaMode />
			{/if}
		{/if}

		{#if error}<p class="ms-error">{error}</p>{/if}
	</div>

	<footer class="ms-footer">
		{#if step === 1}
			<button class="ms-next" onclick={saveAndBuildList} disabled={loading || saving || chosenCount === 0} data-track="matplan:neste-handleliste">
				{saving ? 'Lagrer…' : `Neste: handleliste (${chosenCount} ${chosenCount === 1 ? 'middag' : 'middager'})`}
			</button>
		{:else if step === 2}
			<button class="ms-next" onclick={() => (step = 3)} data-track="matplan:neste-oda">
				Neste: til Oda ({listItems.filter((i) => !i.checked).length} varer)
			</button>
		{:else}
			<button class="ms-next" onclick={finish} data-track="matplan:ferdig">
				Ferdig ✓
			</button>
		{/if}
	</footer>
</div>

{#if pickerDayIndex !== null}
	<MealPickerSheet
		dayLabel={dayLabel(days[pickerDayIndex].date)}
		suggestion={days[pickerDayIndex].suggestion}
		alternatives={days[pickerDayIndex].alternatives}
		{recipes}
		onpick={pickMeal}
		onskip={skipDay}
		onaskai={askAi}
		onclose={() => (pickerDayIndex = null)}
	/>
{/if}

<style>
	.ms-overlay {
		position: fixed;
		inset: 0;
		z-index: 150;
		background: var(--page-bg, #0d0d10);
		display: flex;
		flex-direction: column;
	}
	.ms-header {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: calc(12px + env(safe-area-inset-top)) 16px 10px;
	}
	.ms-back {
		background: rgba(255, 255, 255, 0.07);
		border: none;
		border-radius: 10px;
		color: inherit;
		width: 38px;
		height: 38px;
		font-size: 1rem;
		cursor: pointer;
		flex-shrink: 0;
	}
	.ms-title {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.ms-title h1 {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 700;
	}
	.ms-dots {
		display: flex;
		gap: 5px;
	}
	.ms-dot {
		width: 18px;
		height: 4px;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.12);
	}
	.ms-dot.active {
		background: var(--accent-fg, #7c8ef5);
	}
	.ms-dot.done {
		background: rgba(124, 142, 245, 0.45);
	}
	.ms-spacer {
		width: 38px;
	}
	.ms-body {
		flex: 1;
		overflow-y: auto;
		padding: 8px 16px 20px;
	}
	.ms-hint {
		color: var(--color-text-secondary, #999);
		font-size: 0.85rem;
		line-height: 1.45;
		margin: 4px 0 14px;
	}
	.ms-loading {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.ms-ai-btn {
		width: 100%;
		background: rgba(124, 142, 245, 0.12);
		border: 1px dashed rgba(124, 142, 245, 0.4);
		border-radius: 12px;
		color: var(--accent-fg, #aab8ff);
		padding: 11px;
		font-size: 0.88rem;
		font-weight: 600;
		cursor: pointer;
		margin-bottom: 12px;
	}
	.ms-ai-btn:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.ms-days {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.ms-day {
		display: flex;
		align-items: stretch;
		gap: 6px;
	}
	.ms-add-meal {
		background: rgba(255, 255, 255, 0.05);
		border: 1px dashed rgba(255, 255, 255, 0.15);
		border-radius: 12px;
		color: var(--color-text-secondary, #999);
		width: 40px;
		font-size: 1.1rem;
		cursor: pointer;
		flex-shrink: 0;
	}
	.ms-day-main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 5px;
		background: var(--card-bg, rgba(255, 255, 255, 0.045));
		border: 1px solid var(--card-border, rgba(255, 255, 255, 0.08));
		border-radius: 14px;
		color: inherit;
		padding: 12px 14px;
		text-align: left;
		cursor: pointer;
	}
	.ms-day.skipped .ms-day-main {
		opacity: 0.55;
	}
	.ms-day-date {
		font-size: 0.76rem;
		font-weight: 600;
		text-transform: capitalize;
		color: var(--color-text-secondary, #999);
		letter-spacing: 0.02em;
	}
	.ms-day-meal {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		font-size: 0.95rem;
		font-weight: 600;
	}
	.ms-muted {
		color: var(--color-text-secondary, #777);
		font-weight: 400;
	}
	.ms-meal-chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.ms-day-reason {
		font-size: 0.75rem;
		color: rgba(154, 164, 214, 0.9);
	}
	.ms-error {
		color: #e07070;
		font-size: 0.85rem;
		margin-top: 12px;
	}
	.ms-footer {
		padding: 12px 16px calc(16px + env(safe-area-inset-bottom));
		border-top: 1px solid rgba(255, 255, 255, 0.07);
	}
	.ms-next {
		width: 100%;
		background: var(--accent-bg, #5865c9);
		border: none;
		border-radius: 14px;
		color: #fff;
		padding: 15px;
		font-size: 0.98rem;
		font-weight: 700;
		cursor: pointer;
	}
	.ms-next:disabled {
		opacity: 0.45;
		cursor: default;
	}
</style>
