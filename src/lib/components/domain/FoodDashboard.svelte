<script lang="ts">
	import { MEAL_TYPES, PANTRY_LOCATIONS, type MealType, type PantryLocation } from '$lib/domains/food';

	interface MealPlanRow {
		id: string;
		date: string;
		mealType: MealType;
		recipeId: string | null;
		customTitle: string | null;
		notes: string | null;
		servings: number;
		photoUrl: string | null;
		recipeTitle?: string | null;
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
		onOpenChat?: (prefill: string) => void;
	}

	let { weekContext, mealPlans, pantry, expiringSoon, onOpenChat }: Props = $props();

	const days = $derived(
		Array.from(new Set(mealPlans.map((m) => m.date))).sort()
	);

	function plansForDay(date: string): MealPlanRow[] {
		return mealPlans
			.filter((m) => m.date === date)
			.sort((a, b) => mealTypeOrder(a.mealType) - mealTypeOrder(b.mealType));
	}

	function mealTypeOrder(t: MealType): number {
		return { breakfast: 0, lunch: 1, dinner: 2, snack: 3 }[t];
	}

	function pantryGrouped(): Record<PantryLocation, PantryRow[]> {
		const out: Record<PantryLocation, PantryRow[]> = { pantry: [], fridge: [], freezer: [] };
		for (const item of pantry) out[item.location].push(item);
		return out;
	}

	const grouped = $derived(pantryGrouped());

	function formatNorwegianDate(iso: string): string {
		const d = new Date(iso);
		return d.toLocaleDateString('no-NO', { weekday: 'short', day: 'numeric', month: 'short' });
	}
</script>

<div class="food-dashboard">
	<header class="head">
		<h2>🍽️ Mat — uke {weekContext}</h2>
		{#if onOpenChat}
			<button class="cta" onclick={() => onOpenChat('Hjelp meg planlegge ukens middager.')}>
				Planlegg uka
			</button>
		{/if}
	</header>

	<section class="week">
		<h3>Ukens meny</h3>
		{#if days.length === 0}
			<p class="empty">Ingen måltider planlagt enda.</p>
		{:else}
			<ul class="days">
				{#each days as date}
					<li class="day">
						<div class="date">{formatNorwegianDate(date)}</div>
						<ul class="meals">
							{#each plansForDay(date) as plan}
								<li class="meal">
									<span class="emoji">{MEAL_TYPES[plan.mealType].emoji}</span>
									<span class="title">
										{plan.recipeTitle ?? plan.customTitle ?? '—'}
									</span>
									{#if plan.servings && plan.servings !== 2}
										<span class="servings">×{plan.servings}</span>
									{/if}
								</li>
							{/each}
						</ul>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="pantry">
		<h3>Pantry</h3>
		<div class="locations">
			{#each Object.entries(PANTRY_LOCATIONS) as [loc, meta]}
				<div class="location">
					<h4>{meta.emoji} {meta.label}</h4>
					{#if grouped[loc as PantryLocation].length === 0}
						<p class="empty">—</p>
					{:else}
						<ul>
							{#each grouped[loc as PantryLocation] as item}
								<li>
									{item.name}
									{#if item.quantity}
										<span class="qty">({item.quantity}{item.unit ? ' ' + item.unit : ''})</span>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/each}
		</div>
	</section>

	{#if expiringSoon.length > 0}
		<section class="expiring">
			<h3>⚠️ Går snart ut</h3>
			<ul>
				{#each expiringSoon as item}
					<li>
						{item.name}
						{#if item.expiresAt}<span class="qty">— {formatNorwegianDate(item.expiresAt)}</span>{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>

<style>
	.food-dashboard {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		padding: 1rem;
	}

	.head {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.cta {
		background: var(--color-accent, #7c8ef5);
		color: white;
		border: none;
		border-radius: 0.5rem;
		padding: 0.5rem 1rem;
		cursor: pointer;
	}

	h2 { margin: 0; font-size: 1.25rem; }
	h3 { margin: 0 0 0.5rem; font-size: 1rem; }
	h4 { margin: 0 0 0.25rem; font-size: 0.9rem; }

	.empty { color: var(--color-muted, #888); font-style: italic; }

	.days, .meals, ul { list-style: none; padding: 0; margin: 0; }

	.day {
		border-top: 1px solid var(--color-border, #eee);
		padding: 0.5rem 0;
	}

	.date {
		font-weight: 600;
		text-transform: capitalize;
		margin-bottom: 0.25rem;
	}

	.meal {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		padding: 0.125rem 0;
	}

	.servings, .qty {
		color: var(--color-muted, #888);
		font-size: 0.85rem;
	}

	.locations {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 1rem;
	}

	.location ul li {
		padding: 0.125rem 0;
		font-size: 0.9rem;
	}

	.expiring {
		background: rgba(255, 200, 0, 0.1);
		border-radius: 0.5rem;
		padding: 0.75rem 1rem;
	}
</style>
