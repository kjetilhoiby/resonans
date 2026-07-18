import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themes, pantryItems } from '$lib/db/schema';
import { resolveThemeDashboardKind } from '$lib/domain/theme-dashboard-registry';
import { and, eq, gte, lte, asc } from 'drizzle-orm';
import { addDaysIso, isoWeekKeyForDate } from '$lib/server/iso-week';
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

	const today = new Date().toISOString().slice(0, 10);
	const weekContext = url.searchParams.get('weekContext') ?? isoWeekKeyForDate(today);
	const nextWeekContext = isoWeekKeyForDate(addDaysIso(today, 7));

	const [enrichedPlans, nextWeekPlans, weekList, nextWeekList] = await Promise.all([
		getWeekMealPlansWithTitles(userId, weekContext),
		getWeekMealPlansWithTitles(userId, nextWeekContext),
		getWeekShoppingList(userId, weekContext),
		getWeekShoppingList(userId, nextWeekContext)
	]);

	const pantry = await db
		.select()
		.from(pantryItems)
		.where(eq(pantryItems.userId, userId))
		.orderBy(asc(pantryItems.location), asc(pantryItems.name));

	const horizon = addDaysIso(today, 7);
	const expiringSoon = await db
		.select()
		.from(pantryItems)
		.where(
			and(
				eq(pantryItems.userId, userId),
				gte(pantryItems.expiresAt, today),
				lte(pantryItems.expiresAt, horizon)
			)
		)
		.orderBy(asc(pantryItems.expiresAt));

	return json({
		weekContext,
		mealPlans: enrichedPlans,
		pantry,
		expiringSoon,
		nextWeek: {
			weekContext: nextWeekContext,
			mealPlans: nextWeekPlans,
			shoppingList: shoppingListSummary(nextWeekList)
		},
		shoppingList: shoppingListSummary(weekList)
	});
};
