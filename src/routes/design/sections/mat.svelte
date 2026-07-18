<script lang="ts">
	import FoodDashboard from '$lib/components/domain/FoodDashboard.svelte';
	import ShoppingListView from '$lib/components/domain/food/ShoppingListView.svelte';
	import { foodMealPlansMock, foodPantryMock, foodShoppingListItemsMock } from '../mocks';

	// Lokale kopier så demo-interaksjon (avhuking) ikke muterer mock-modulen.
	let odaItems = $state(foodShoppingListItemsMock.map((i) => ({ ...i })));
	let editItems = $state(foodShoppingListItemsMock.map((i) => ({ ...i })));
</script>

<!-- ══ MAT ════════════════════════════════════════════════════════════════ -->
<section id="mat" class="section">
	<h2 class="section-heading">Mat & matplan</h2>
	<p class="section-desc">
		Mat-temaets komponenter (<code>domain/FoodDashboard</code> + <code>domain/food/*</code>).
		Onsdagsøkta (<code>MatplanSession</code>) og sheets demoes ikke inline — de er
		fullskjerms-overlays; handlelisten under er samme komponent som øktas steg 2 og 3.
	</p>

	<h3 class="subsection">FoodDashboard — ukemeny, lager med faste varer (⭐) og budsjett</h3>
	<p class="section-desc">
		Matpakke- og kvitteringskortene henter egne data og er tomme i demoen.
		To middager samme dag = kresne-barn-dag.
	</p>
	<div class="demo-card demo-card--wide">
		<FoodDashboard
			weekContext="2026-W30"
			mealPlans={foodMealPlansMock}
			pantry={foodPantryMock}
			expiringSoon={foodPantryMock.filter((p) => p.expiresAt)}
			shoppingList={{ id: 'mock', status: 'draft', itemCount: 5, uncheckedCount: 4 }}
			groceryBudgetWeekly={2500}
			nextWeek={{
				weekContext: '2026-W31',
				mealPlans: [],
				shoppingList: null
			}}
		/>
	</div>

	<h3 class="subsection">ShoppingListView — redigeringsmodus (øktas steg 2)</h3>
	<div class="demo-card">
		<ShoppingListView listId="mock" bind:items={editItems} editable />
	</div>

	<h3 class="subsection">ShoppingListView — Oda-modus med søkelenker (øktas steg 3)</h3>
	<div class="demo-card">
		<ShoppingListView listId="mock" bind:items={odaItems} odaMode />
	</div>
</section>
