import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themes, pantryItems, foodSettings } from '$lib/db/schema';
import { resolveThemeDashboardKind } from '$lib/domain/theme-dashboard-registry';
import { and, eq, gte, lte, asc } from 'drizzle-orm';
import { addDaysIso, isoWeekKeyForDate, osloTodayIso } from '$lib/server/iso-week';
import { getWeekMealPlansWithTitles } from '$lib/server/services/meal-plan-sync';
import { getWeekShoppingList, type ShoppingListItem } from '$lib/server/services/shopping-list-service';

function shoppingListSummary(list: Awaited<ReturnType<typeof getWeekShoppingList>>) {
	if (!list) return null;
	const items = list.items as ShoppingListItem[];
	return {
		id: list.id,
		status: list.status,
		itemCount: items.length,
		uncheckedCount: items.filter((item) => !item.checked).length
	};
}

export const GET: RequestHandler = async ({ params, locals, url }) => {
	const userId = locals.userId;

	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, userId))
	});

	if (!theme) {
		return json({ error: 'Tema ikke funnet.' }, { status: 404 });
	}

	if (resolveThemeDashboardKind(theme.name) !== 'food') {
		return json({ error: 'Temaet har ikke matdashboard.' }, { status: 400 });
	}

	const today = osloTodayIso();
	const weekContext = url.searchParams.get('weekContext') ?? isoWeekKeyForDate(today);
	const nextWeekContext = isoWeekKeyForDate(addDaysIso(today, 7));

	const [enrichedPlans, nextWeekPlans, weekList, nextWeekList, pantry, settings] =
		await Promise.all([
			getWeekMealPlansWithTitles(userId, weekContext),
			getWeekMealPlansWithTitles(userId, nextWeekContext),
			getWeekShoppingList(userId, weekContext),
			getWeekShoppingList(userId, nextWeekContext),
			db
				.select()
				.from(pantryItems)
				.where(eq(pantryItems.userId, userId))
				.orderBy(asc(pantryItems.location), asc(pantryItems.name)),
			db.query.foodSettings.findFirst({ where: eq(foodSettings.userId, userId) })
		]);

	// «Går snart ut» utledes fra pantry-lista vi allerede har — ingen egen spørring.
	const horizon = addDaysIso(today, 7);
	const expiringSoon = pantry
		.filter((item) => item.expiresAt && item.expiresAt >= today && item.expiresAt <= horizon)
		.sort((a, b) => (a.expiresAt! < b.expiresAt! ? -1 : 1));

	return json({
		weekContext,
		mealPlans: enrichedPlans,
		pantry,
		expiringSoon,
		groceryBudgetWeekly:
			settings?.groceryBudgetWeekly != null ? Number(settings.groceryBudgetWeekly) : null,
		nextWeek: {
			weekContext: nextWeekContext,
			mealPlans: nextWeekPlans,
			shoppingList: shoppingListSummary(nextWeekList)
		},
		shoppingList: shoppingListSummary(weekList)
	});
};
