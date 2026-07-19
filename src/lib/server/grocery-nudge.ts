/**
 * grocery-nudge.ts — ukentlig dagligvare-oppsummering (mandag morgen).
 *
 * Sender én melding per uke: forrige ukes dagligvareforbruk mot 4-ukers snitt
 * og eventuelt ukebudsjett (food_settings), pluss plan-vs-kjøp fra Oda-
 * kvitteringen når den finnes. Mønster fra salary-nudge/day-planning-nudges:
 * timebasert cron + lokal tidsmatching + dedup via nudge_events.
 */

import { and, eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { groceryOrders, groceryOrderLines, nudgeEvents, shoppingLists, themes, users } from '$lib/db/schema';
import { getGroceryWeekSpend } from '$lib/server/services/grocery-insights';
import { createNudgeEvent, markNudgeSent } from '$lib/server/nudge-events';
import {
	getGoogleChatWebhooksForRoutes,
	resolveRoutesForNotification,
	routeTargetsPwa
} from '$lib/server/notification-channels';
import { sendGoogleChatMessage } from '$lib/server/google-chat';
import { PushDeliveryService } from '$lib/server/services/push-delivery-service';
import { localHm, isWithinRecentMinutesWindow } from '$lib/server/nudge-time';
import { addDaysIso, datesForIsoWeek, isoWeekKeyForDate, osloTodayIso } from '$lib/server/iso-week';
import { compareShoppingListToOrder } from '$lib/domains/food/grocery';
import { resolveThemeDashboardKind } from '$lib/domain/theme-dashboard-registry';
import type { ShoppingListItem } from '$lib/server/services/shopping-list-service';

const DEFAULT_TIME = '09:00';
const WINDOW_MINUTES = 60;

function fmt(n: number) {
	return Math.round(Math.abs(n)).toLocaleString('nb-NO');
}

function localWeekday(timeZone: string, now: Date): string {
	return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(now).toLowerCase();
}

async function findFoodThemeUrl(userId: string, appUrl: string): Promise<string> {
	const userThemes = await db
		.select({ id: themes.id, name: themes.name })
		.from(themes)
		.where(eq(themes.userId, userId));
	const foodTheme = userThemes.find((t) => resolveThemeDashboardKind(t.name) === 'food');
	return foodTheme ? `${appUrl}/tema/${foodTheme.id}` : appUrl;
}

export async function sendGroceryWeeklyNudge(
	userId: string,
	user: typeof users.$inferSelect,
	appUrl: string,
	now: Date,
	opts: { force?: boolean } = {}
): Promise<{ sent: boolean; reason: string }> {
	const settings = user.notificationSettings?.groceryWeekly;
	if (settings?.enabled === false) return { sent: false, reason: 'disabled' };

	const timeZone = user.timezone ?? 'Europe/Oslo';
	if (!opts.force) {
		if (localWeekday(timeZone, now) !== 'monday') {
			return { sent: false, reason: 'not-monday' };
		}
		const target = settings?.time ?? DEFAULT_TIME;
		if (!isWithinRecentMinutesWindow(localHm(timeZone, now), target, WINDOW_MINUTES)) {
			return { sent: false, reason: 'outside-time-window' };
		}
	}

	// Forrige hele uke (man–søn) — Oslo-dato, ikke UTC (mandag 00–01 norsk tid)
	const todayIso = osloTodayIso(now);
	const lastWeekKey = isoWeekKeyForDate(addDaysIso(todayIso, -7));
	const lastWeekDays = datesForIsoWeek(lastWeekKey);
	if (lastWeekDays.length === 0) return { sent: false, reason: 'invalid-week' };
	const weekStart = new Date(`${lastWeekDays[0]}T00:00:00.000Z`);
	const weekEnd = new Date(`${addDaysIso(lastWeekDays[6], 1)}T00:00:00.000Z`);

	// Dedup: én oppsummering per uke
	const existing = await db.query.nudgeEvents.findFirst({
		where: and(
			eq(nudgeEvents.userId, userId),
			eq(nudgeEvents.nudgeType, 'grocery_weekly'),
			sql`(${nudgeEvents.context}->>'weekContext') = ${lastWeekKey}`
		),
		columns: { id: true, sentAt: true }
	});
	if (!opts.force && existing?.sentAt) {
		return { sent: false, reason: 'already-sent-this-week' };
	}

	// Ingen leveringsruter → ikke gjør transaksjonsanalysen i det hele tatt
	const routes = resolveRoutesForNotification(user, 'groceryWeekly');
	if (routes.length === 0) return { sent: false, reason: 'no-routes' };

	// Forbruk forrige uke + baseline + budsjett — samme beregning som
	// economics_grocery_spend_weekly-signalet (delt helper).
	const { spend, baselineWeeklyAvg: baselineWeekly, budgetWeekly: budget } =
		await getGroceryWeekSpend(userId, weekStart, weekEnd);

	if (spend === 0 && baselineWeekly === 0) {
		return { sent: false, reason: 'no-grocery-data' };
	}

	// Plan-vs-kjøp fra ukas Oda-ordre (hvis både ordre og handleliste finnes)
	let planVsKjop: { bought: number; missing: number; impulse: number } | null = null;
	const order = await db.query.groceryOrders.findFirst({
		where: and(eq(groceryOrders.userId, userId), eq(groceryOrders.weekContext, lastWeekKey))
	});
	if (order) {
		const list = await db.query.shoppingLists.findFirst({
			where: and(
				eq(shoppingLists.userId, userId),
				eq(shoppingLists.weekContext, lastWeekKey),
				eq(shoppingLists.kind, 'week')
			)
		});
		if (list) {
			const lines = await db
				.select({ name: groceryOrderLines.name, category: groceryOrderLines.category })
				.from(groceryOrderLines)
				.where(eq(groceryOrderLines.orderId, order.id));
			const comparison = compareShoppingListToOrder(
				(list.items as ShoppingListItem[]).map((item) => ({ text: item.name })),
				lines
			);
			planVsKjop = {
				bought: comparison.bought.length,
				missing: comparison.missing.length,
				impulse: comparison.impulse.length
			};
		}
	}

	// Bygg melding
	const weekNo = lastWeekKey.split('-W')[1];
	const lines: string[] = [`🛒 **Dagligvareuka ${weekNo}: kr ${fmt(spend)}**`];

	if (budget != null && budget > 0) {
		const diff = spend - budget;
		lines.push(
			diff <= 0
				? `✅ kr ${fmt(diff)} under ukebudsjettet (kr ${fmt(budget)})`
				: `⚠️ kr ${fmt(diff)} over ukebudsjettet (kr ${fmt(budget)})`
		);
	}
	if (baselineWeekly > 0) {
		const pct = Math.round(((spend - baselineWeekly) / baselineWeekly) * 100);
		lines.push(
			pct === 0
				? `På snittet av de siste 4 ukene (kr ${fmt(baselineWeekly)}/uke).`
				: `${Math.abs(pct)} % ${pct > 0 ? 'over' : 'under'} snittet av de siste 4 ukene (kr ${fmt(baselineWeekly)}/uke).`
		);
	}
	if (planVsKjop) {
		lines.push(
			`Oda-handelen: ✅ ${planVsKjop.bought} som planlagt · ⚠️ ${planVsKjop.missing} manglet · 🛒 ${planVsKjop.impulse} utenom lista.`
		);
	}

	const themeUrl = await findFoodThemeUrl(userId, appUrl);
	lines.push('');
	lines.push(`Klar for onsdagsøkta? Planlegg neste uke her: ${themeUrl}`);
	const message = lines.join('\n');

	const eventId = await createNudgeEvent({
		userId,
		nudgeType: 'grocery_weekly',
		mode: 'interactive',
		context: { weekContext: lastWeekKey, spend, baselineWeekly, budget }
	});

	let sent = false;

	if (routeTargetsPwa(routes)) {
		try {
			const delivery = await PushDeliveryService.deliverToUser({
				userId,
				payload: {
					title: `🛒 Dagligvareuka ${weekNo}: kr ${fmt(spend)}`,
					body:
						budget != null && budget > 0
							? spend <= budget
								? `Under budsjett (kr ${fmt(budget)}). Trykk for detaljer.`
								: `kr ${fmt(spend - budget)} over budsjett. Trykk for detaljer.`
							: 'Trykk for ukesoppsummering og planlegging.',
					url: themeUrl,
					tag: `grocery-weekly-${lastWeekKey}`
				},
				onGone: 'disable'
			});
			if (delivery.sent > 0) sent = true;
		} catch {
			// Non-fatal
		}
	}

	const webhooks = getGoogleChatWebhooksForRoutes(user, routes);
	for (const webhook of webhooks) {
		const ok = await sendGoogleChatMessage(webhook, { text: message });
		if (ok) sent = true;
	}

	if (sent && eventId) {
		await markNudgeSent(eventId);
	}

	return { sent, reason: sent ? 'ok' : 'delivery-failed' };
}

export async function sendGroceryWeeklyNudgesForAllUsers(
	appUrl: string,
	now: Date = new Date(),
	opts: { force?: boolean } = {}
) {
	const allUsers = await db.query.users.findMany();
	const results: Array<{ userId: string; sent: boolean; reason: string }> = [];

	for (const user of allUsers) {
		try {
			const result = await sendGroceryWeeklyNudge(user.id, user, appUrl, now, opts);
			results.push({ userId: user.id, ...result });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`[grocery-nudge] user=${user.id} error: ${message}`);
			results.push({ userId: user.id, sent: false, reason: `error: ${message}` });
		}
	}

	return {
		processedUsers: results.length,
		nudgesSent: results.filter((r) => r.sent).length,
		results
	};
}
