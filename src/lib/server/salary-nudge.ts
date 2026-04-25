import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { canonicalBankTransactions, nudgeEvents, users } from '$lib/db/schema';
import { detectGlobalPayday } from '$lib/server/integrations/payday-detector';
import { buildDailyBalances } from '$lib/server/integrations/balance-reconstructor';
import {
	ensureCategorizedEventsForRange,
	queryCategorizedEvents
} from '$lib/server/integrations/categorized-events';
import { createNudgeEvent, markNudgeSent } from '$lib/server/nudge-events';
import {
	getGoogleChatWebhooksForRoutes,
	resolveRoutesForNotification,
	routeTargetsPwa
} from '$lib/server/notification-channels';
import { buildSalaryNudgeMessage, sendGoogleChatMessage } from '$lib/server/google-chat';
import { PushDeliveryService } from '$lib/server/services/push-delivery-service';

const SALARY_DETECTION_WINDOW_DAYS = 3;

function fmt(n: number) {
	return Math.round(Math.abs(n)).toLocaleString('nb-NO');
}

export async function sendSalaryReceivedNudge(
	userId: string,
	user: (typeof users.$inferSelect),
	appUrl: string,
	now: Date,
	opts: { force?: boolean } = {}
): Promise<{ sent: boolean; reason: string }> {
	// 1. Detect payday dates
	const payDay = await detectGlobalPayday(userId);
	if (!payDay || payDay.paydayDates.length < 2) {
		return { sent: false, reason: 'no-payday-detected' };
	}

	// 2. Check if the most recent payday is within the detection window
	const mostRecentPayday = payDay.paydayDates[payDay.paydayDates.length - 1];
	const paydayDate = new Date(`${mostRecentPayday}T00:00:00.000Z`);
	const diffMs = now.getTime() - paydayDate.getTime();
	const diffDays = diffMs / (1000 * 60 * 60 * 24);
	if (!opts.force && (diffDays < 0 || diffDays > SALARY_DETECTION_WINDOW_DAYS)) {
		return { sent: false, reason: 'payday-not-recent' };
	}

	const salaryMonth = mostRecentPayday.slice(0, 7); // YYYY-MM

	// 3. Dedup: check if we already sent a nudge for this salary month
	const existing = await db.query.nudgeEvents.findFirst({
		where: and(
			eq(nudgeEvents.userId, userId),
			eq(nudgeEvents.nudgeType, 'salary_received'),
			sql`(${nudgeEvents.context}->>'salaryMonth') = ${salaryMonth}`
		),
		columns: { id: true, sentAt: true }
	});
	if (!opts.force && existing?.sentAt) {
		return { sent: false, reason: 'already-sent-this-month' };
	}

	// 4. Fetch salary transaction amount
	const salaryKeywords = ['lønn', 'lonn', 'salary', 'arbeidsgiver', 'folktrygd', 'nav '];
	const salaryTxRows = await db
		.select({
			amount: canonicalBankTransactions.amount,
			description: sql<string>`COALESCE(${canonicalBankTransactions.descriptionDisplay}, ${canonicalBankTransactions.merchantKey}, '')`
		})
		.from(canonicalBankTransactions)
		.where(
			and(
				eq(canonicalBankTransactions.userId, userId),
				eq(canonicalBankTransactions.isActive, true),
				sql`${canonicalBankTransactions.canonicalDate} = ${mostRecentPayday}`,
				sql`${canonicalBankTransactions.amount} >= 10000`
			)
		)
		.orderBy(desc(canonicalBankTransactions.amount))
		.limit(5);

	let salaryAmount = 0;
	for (const row of salaryTxRows) {
		const desc = (row.description ?? '').toLowerCase();
		if (salaryKeywords.some((kw) => desc.includes(kw))) {
			salaryAmount = Number(row.amount);
			break;
		}
	}
	if (salaryAmount === 0 && salaryTxRows.length > 0) {
		salaryAmount = Number(salaryTxRows[0].amount);
	}

	// 5. Compute spending since payday
	const from = paydayDate;
	const to = now;
	let totalSpending = 0;
	try {
		await ensureCategorizedEventsForRange({ userId, from, to });
		const txRows = await queryCategorizedEvents({ userId, from, to, spendingOnly: true });
		totalSpending = txRows.reduce((sum, row) => sum + Math.abs(Number(row.amount)), 0);
	} catch {
		// Non-fatal — nudge still sends without spending total
	}

	// 6. Compute savings account balance change
	let savingsChange = 0;
	if (payDay.sourceAccountId) {
		try {
			const dailyBalances = await buildDailyBalances(userId, payDay.sourceAccountId);
			const startRow = dailyBalances.find((r) => r.date >= mostRecentPayday);
			const endRow = dailyBalances[dailyBalances.length - 1];
			if (startRow && endRow) {
				savingsChange = endRow.balance - startRow.balance;
			}
		} catch {
			// Non-fatal
		}
	}

	// 7. Compute spending trend vs. previous period
	let spendingTrend = 0;
	try {
		const prevPayday = payDay.paydayDates[payDay.paydayDates.length - 2];
		const prevFrom = new Date(`${prevPayday}T00:00:00.000Z`);
		const prevTo = paydayDate;
		await ensureCategorizedEventsForRange({ userId, from: prevFrom, to: prevTo });
		const prevTxRows = await queryCategorizedEvents({ userId, from: prevFrom, to: prevTo, spendingOnly: true });
		const prevSpending = prevTxRows.reduce((sum, row) => sum + Math.abs(Number(row.amount)), 0);
		if (prevSpending > 0) {
			spendingTrend = ((totalSpending - prevSpending) / prevSpending) * 100;
		}
	} catch {
		// Non-fatal
	}

	// 8. Create nudge event
	const eventId = await createNudgeEvent({
		userId,
		nudgeType: 'salary_received',
		mode: 'interactive',
		context: { salaryMonth, paydayDate: mostRecentPayday, trigger: 'bank_sync' }
	});

	// 9. Resolve notification routes
	const routes = resolveRoutesForNotification(user, 'salaryReceived');
	if (routes.length === 0) {
		return { sent: false, reason: 'no-routes' };
	}

	let sent = false;

	// 10. Send PWA push
	if (routeTargetsPwa(routes)) {
		const pushUrl = eventId
			? `${appUrl}/economics/lonnsmaned?nudgeTrack=salary_received&nudgeEventId=${eventId}`
			: `${appUrl}/economics/lonnsmaned`;
		try {
			const delivery = await PushDeliveryService.deliverToUser({
				userId,
				payload: {
					title: 'Lønn mottatt 💰',
					body: `kr ${fmt(salaryAmount)} inn · brukt kr ${fmt(totalSpending)} hittil`,
					url: pushUrl,
					tag: `nudge-salary-${salaryMonth}`
				},
				onGone: 'disable'
			});
			if (delivery.sent > 0) sent = true;
		} catch {
			// Non-fatal
		}
	}

	// 11. Send Google Chat
	const webhooks = getGoogleChatWebhooksForRoutes(user, routes);
	if (webhooks.length > 0) {
		const message = buildSalaryNudgeMessage({
			appUrl,
			userName: user.name,
			salaryAmount,
			totalSpending,
			savingsChange,
			spendingTrend,
			salaryMonth,
			nudgeEventId: eventId
		});
		for (const webhook of webhooks) {
			const ok = await sendGoogleChatMessage(webhook, message);
			if (ok) sent = true;
		}
	}

	// 12. Mark sent
	if (sent && eventId) {
		await markNudgeSent(eventId);
	}

	return { sent, reason: sent ? 'ok' : 'delivery-failed' };
}

export async function sendSalaryNudgesForAllUsers(
	appUrl: string,
	now: Date = new Date()
): Promise<{
	processedUsers: number;
	nudgesSent: number;
	results: Array<{ userId: string; sent: boolean; reason: string }>;
}> {
	const allUsers = await db.query.users.findMany();
	const results: Array<{ userId: string; sent: boolean; reason: string }> = [];

	for (const user of allUsers) {
		try {
			const result = await sendSalaryReceivedNudge(user.id, user, appUrl, now);
			results.push({ userId: user.id, ...result });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`[salary-nudge] user=${user.id} error: ${message}`);
			results.push({ userId: user.id, sent: false, reason: `error: ${message}` });
		}
	}

	return {
		processedUsers: results.length,
		nudgesSent: results.filter((r) => r.sent).length,
		results
	};
}
