<!--
  FoodDashboard — «Oversikt»-fanen på mat-temaet. Neste ukes meny med
  «Planlegg uka»-CTA (åpner MatplanSession), denne ukas meny, handleliste-
  status, pantry og «går snart ut». Matpakke- og kvitteringskort kommer som
  egne seksjoner (DEL B).
-->
<script lang="ts">
	import { MEAL_TYPES, PANTRY_LOCATIONS, type MealType, type PantryLocation } from '$lib/domains/food';
	import SectionCard from '../ui/SectionCard.svelte';
	import SectionLabel from '../ui/SectionLabel.svelte';
	import MatplanSession from './food/MatplanSession.svelte';
	import ShoppingListView from './food/ShoppingListView.svelte';
	import LunchboxCard from './food/LunchboxCard.svelte';
	import BottomSheet from '../ui/BottomSheet.svelte';
	import type { FoodShoppingListSummary } from '$lib/client/dashboard-cache';

	interface MealPlanRow {
		id: string;
		date: string;
		mealType: MealType;
		mealId: string | null;
		notes: string | null;
		servings: number;
		photoUrl: string | null;
		mealTitle?: string | null;
	}

	interface PantryRow {
		id: string;
		name: string;
		location: PantryLocation;
		quantity: string | null;
		unit: string | null;
		expiresAt: string | null;
	}

	interface Props {
		weekContext: string;
		mealPlans: MealPlanRow[];
		pantry: PantryRow[];
		expiringSoon: PantryRow[];
		shoppingList?: FoodShoppingListSummary | null;
		nextWeek?: {
			weekContext: string;
			mealPlans: MealPlanRow[];
			shoppingList?: FoodShoppingListSummary | null;
		};
		onOpenChat?: (prefill: string) => void;
		onRefresh?: () => void;
	}

	let { weekContext, mealPlans, pantry, expiringSoon, shoppingList = null, nextWeek, onOpenChat, onRefresh }: Props = $props();

	let matplanOpen = $state(false);
	let listSheetOpen = $state(false);
	let listSheetId = $state<string | null>(null);
	let listSheetItems = $state<Array<{
		id: string; name: string; normalizedName: string; quantity?: number | null;
		unit?: string | null; sources: string[]; checked: boolean; manual: boolean; odaUrl?: string;
	}>>([]);

	function weekNumber(context: string): string {
		return context.split('-W')[1] ?? context;
	}

	function dinnersByDay(plans: MealPlanRow[]): Array<{ date: string; plans: MealPlanRow[] }> {
		const days = Array.from(new Set(plans.map((m) => m.date))).sort();
		return days.map((date) => ({
			date,
			plans: plans
				.filter((m) => m.date === date)
				.sort((a, b) => mealTypeOrder(a.mealType) - mealTypeOrder(b.mealType))
		}));
	}

	function mealTypeOrder(t: MealType): number {
		return { breakfast: 0, lunch: 1, dinner: 2, snack: 3 }[t];
	}

	const thisWeekDays = $derived(dinnersByDay(mealPlans));
	const nextWeekDays = $derived(nextWeek ? dinnersByDay(nextWeek.mealPlans) : []);
	const activeListSummary = $derived(nextWeek?.shoppingList ?? shoppingList);

	const grouped = $derived.by(() => {
		const out: Record<PantryLocation, PantryRow[]> = { pantry: [], fridge: [], freezer: [] };
		for (const item of pantry) out[item.location].push(item);
		return out;
	});

	function formatNorwegianDate(iso: string): string {
		return new Date(iso + 'T12:00:00').toLocaleDateString('no-NO', {
			weekday: 'short',
			day: 'numeric',
			month: 'short'
		});
	}

	async function openListSheet(summary: FoodShoppingListSummary, context: string) {
		const res = await fetch(`/api/food/shopping-list?weekContext=${encodeURIComponent(context)}`);
		if (!res.ok) return;
		const data = await res.json();
		if (!data.shoppingList) return;
		listSheetId = data.shoppingList.id;
		listSheetItems = data.shoppingList.items;
		listSheetOpen = true;
		void summary;
	}
</script>

<div class="food-dashboard">
	<!-- Matpakker: dagens forslag per barn + retur-logging -->
	<LunchboxCard />

	<!-- Neste uke: planleggings-CTA -->
	<SectionCard tone="subtle">
		<div class="fd-plan-card">
			<div class="fd-plan-copy">
				<h3 class="fd-plan-title">Uke {nextWeek ? weekNumber(nextWeek.weekContext) : '–'}</h3>
				{#if nextWeekDays.length === 0}
					<p class="fd-plan-sub">Ingen middager planlagt ennå. Ta økta nå — velg middager og gjør Oda-bestillingen klar i ett.</p>
				{:else}
					<p class="fd-plan-sub">
						{nextWeek?.mealPlans.filter((p) => p.mealType === 'dinner').length ?? 0} middager planlagt
						{#if nextWeek?.shoppingList}
							· handleliste {nextWeek.shoppingList.status === 'final' ? 'ferdig' : 'utkast'} ({nextWeek.shoppingList.itemCount} varer)
						{/if}
					</p>
				{/if}
			</div>
			<button class="fd-cta" onclick={() => (matplanOpen = true)} data-track="matplan:start">
				{nextWeekDays.length === 0 ? 'Planlegg uka →' : 'Juster planen →'}
			</button>
		</div>
		{#if nextWeekDays.length > 0}
			<ul class="fd-days fd-days-compact">
				{#each nextWeekDays as day}
					<li class="fd-day">
						<span class="fd-day-date">{formatNorwegianDate(day.date)}</span>
						<span class="fd-day-meals">
							{#each day.plans as plan}
								<span class="fd-meal">{MEAL_TYPES[plan.mealType].emoji} {plan.mealTitle ?? '—'}</span>
							{/each}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</SectionCard>

	<!-- Handleliste-status -->
	{#if activeListSummary}
		<SectionCard tone="subtle">
			<button
				class="fd-list-row"
				onclick={() => openListSheet(activeListSummary, nextWeek?.shoppingList ? nextWeek.weekContext : weekContext)}
				data-track="matplan:apne-handleliste"
			>
				<span class="fd-list-icon">🛒</span>
				<span class="fd-list-copy">
					<span class="fd-list-title">Handleliste uke {weekNumber(nextWeek?.shoppingList ? nextWeek.weekContext : weekContext)}</span>
					<span class="fd-list-sub">
						{activeListSummary.uncheckedCount} av {activeListSummary.itemCount} varer gjenstår
						· {activeListSummary.status === 'final' ? 'klar for Oda' : 'utkast'}
					</span>
				</span>
				<span class="fd-list-chevron">›</span>
			</button>
		</SectionCard>
	{/if}

	<!-- Denne uka -->
	<section>
		<SectionLabel tag="h3">Denne uka</SectionLabel>
		{#if thisWeekDays.length === 0}
			<p class="fd-empty">
				Ingen måltider planlagt for uke {weekNumber(weekContext)}.
				{#if onOpenChat}
					<button class="fd-link" onclick={() => onOpenChat?.('Hjelp meg planlegge ukens middager.')}>
						Spør AI om hjelp
					</button>
				{/if}
			</p>
		{:else}
			<ul class="fd-days">
				{#each thisWeekDays as day}
					<li class="fd-day">
						<span class="fd-day-date">{formatNorwegianDate(day.date)}</span>
						<span class="fd-day-meals">
							{#each day.plans as plan}
								<span class="fd-meal">
									{MEAL_TYPES[plan.mealType].emoji} {plan.mealTitle ?? '—'}
									{#if plan.servings && plan.servings !== 5}<span class="fd-servings">×{plan.servings}</span>{/if}
								</span>
							{/each}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<!-- Går snart ut -->
	{#if expiringSoon.length > 0}
		<SectionCard tone="subtle" title="⚠️ Går snart ut">
			<ul class="fd-expiring">
				{#each expiringSoon as item}
					<li>
						{item.name}
						{#if item.expiresAt}<span class="fd-muted"> — {formatNorwegianDate(item.expiresAt)}</span>{/if}
					</li>
				{/each}
			</ul>
		</SectionCard>
	{/if}

	<!-- Lager -->
	<section>
		<SectionLabel tag="h3">Lager</SectionLabel>
		<div class="fd-locations">
			{#each Object.entries(PANTRY_LOCATIONS) as [loc, meta]}
				<div class="fd-location">
					<h4>{meta.emoji} {meta.label}</h4>
					{#if grouped[loc as PantryLocation].length === 0}
						<p class="fd-muted">—</p>
					{:else}
						<ul>
							{#each grouped[loc as PantryLocation] as item}
								<li>
									{item.name}
									{#if item.quantity}
										<span class="fd-muted">({item.quantity}{item.unit ? ' ' + item.unit : ''})</span>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/each}
		</div>
	</section>
</div>

{#if matplanOpen}
	<MatplanSession
		onclose={() => (matplanOpen = false)}
		onOpenChat={onOpenChat}
		oncompleted={() => onRefresh?.()}
	/>
{/if}

{#if listSheetOpen && listSheetId}
	<BottomSheet onclose={() => (listSheetOpen = false)} ariaLabel="Handleliste">
		<div class="fd-sheet-body">
			<h3 class="fd-sheet-title">🛒 Handleliste</h3>
			<ShoppingListView listId={listSheetId} bind:items={listSheetItems} odaMode />
		</div>
	</BottomSheet>
{/if}

<style>
	.food-dashboard {
		display: flex;
		flex-direction: column;
		gap: 18px;
		/* Horisontal padding kommer fra .data-panel (var(--page-px)) */
		padding: 0;
	}

	.fd-plan-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
	}
	.fd-plan-title {
		margin: 0 0 3px;
		font-size: 1rem;
		font-weight: 700;
	}
	.fd-plan-sub {
		margin: 0;
		font-size: 0.82rem;
		color: var(--color-text-secondary, #999);
		line-height: 1.4;
	}
	.fd-cta {
		background: var(--accent-bg, #5865c9);
		color: #fff;
		border: none;
		border-radius: 12px;
		padding: 12px 16px;
		font-size: 0.88rem;
		font-weight: 700;
		cursor: pointer;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.fd-list-row {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		background: none;
		border: none;
		color: inherit;
		padding: 2px 0;
		cursor: pointer;
		text-align: left;
	}
	.fd-list-icon {
		font-size: 1.3rem;
	}
	.fd-list-copy {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.fd-list-title {
		font-weight: 600;
		font-size: 0.92rem;
	}
	.fd-list-sub {
		font-size: 0.78rem;
		color: var(--color-text-secondary, #999);
	}
	.fd-list-chevron {
		color: var(--color-text-secondary, #777);
		font-size: 1.2rem;
	}

	.fd-days {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.fd-days-compact {
		margin-top: 12px;
	}
	.fd-day {
		display: flex;
		align-items: baseline;
		gap: 12px;
		padding: 7px 0;
		border-top: 1px solid rgba(255, 255, 255, 0.06);
	}
	.fd-day-date {
		width: 84px;
		flex-shrink: 0;
		font-size: 0.78rem;
		font-weight: 600;
		text-transform: capitalize;
		color: var(--color-text-secondary, #999);
	}
	.fd-day-meals {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		font-size: 0.9rem;
	}
	.fd-meal {
		display: inline-flex;
		align-items: baseline;
		gap: 4px;
	}
	.fd-servings,
	.fd-muted {
		color: var(--color-text-secondary, #888);
		font-size: 0.8rem;
	}
	.fd-empty {
		color: var(--color-text-secondary, #999);
		font-size: 0.88rem;
	}
	.fd-link {
		background: none;
		border: none;
		color: var(--accent-fg, #aab8ff);
		cursor: pointer;
		font-size: 0.88rem;
		padding: 0;
		text-decoration: underline;
	}

	.fd-expiring {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 0.88rem;
	}

	.fd-locations {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 14px;
	}
	.fd-location h4 {
		margin: 0 0 4px;
		font-size: 0.85rem;
	}
	.fd-location ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.fd-location li {
		padding: 2px 0;
		font-size: 0.86rem;
	}

	.fd-sheet-body {
		overflow-y: auto;
		padding: 18px 20px calc(20px + env(safe-area-inset-bottom));
	}
	.fd-sheet-title {
		margin: 0 0 12px;
		font-size: 1rem;
	}
</style>
