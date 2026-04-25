import { json } from '@sveltejs/kit';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { canonicalBankTransactions, goals, memories, sensorEvents } from '$lib/db/schema';
import { detectGlobalPayday } from '$lib/server/integrations/payday-detector';
import { buildDailyBalances } from '$lib/server/integrations/balance-reconstructor';
import {
	ensureCategorizedEventsForRange,
	queryCategorizedEvents
} from '$lib/server/integrations/categorized-events';
import { METRIC_CATALOG, type MetricId } from '$lib/domain/metric-catalog';
import type { GoalTrack } from '$lib/domain/goal-tracks';
import type { SalaryMonthReport, GoalProgressItem } from '$lib/types/salary-report';
import type { RequestHandler } from './$types';

const SALARY_KEYWORDS = ['lønn', 'lonn', 'salary', 'arbeidsgiver', 'folktrygd', 'nav '];

// Metrics that are relevant to economics/spending
const ECONOMIC_METRIC_IDS: MetricId[] = ['grocery_spend'];

export const GET: RequestHandler = async ({ locals }) => {
	const userId = locals.userId;

	// 1. Detect payday dates
	const payDay = await detectGlobalPayday(userId);
	if (!payDay || payDay.paydayDates.length < 2) {
		return json({ error: 'No salary data detected' }, { status: 404 });
	}

	const currentSalaryDate = payDay.paydayDates[payDay.paydayDates.length - 1];
	const prevSalaryDate = payDay.paydayDates[payDay.paydayDates.length - 2];
	const sourceAccountId = payDay.sourceAccountId;

	const currentFrom = new Date(`${currentSalaryDate}T00:00:00.000Z`);
	const prevFrom = new Date(`${prevSalaryDate}T00:00:00.000Z`);
	const today = new Date();

	// 2. Ensure categorized events are up to date
	await ensureCategorizedEventsForRange({ userId, from: prevFrom, to: today });

	// 3. Fetch spending for current salary period
	const currentTxRows = await queryCategorizedEvents({
		userId,
		from: currentFrom,
		to: today,
		spendingOnly: true
	});

	// Aggregate by category
	const categoryMap = new Map<string, { label: string; emoji: string; amount: number; count: number; isFixed: boolean }>();
	let totalFixed = 0;
	let totalVariable = 0;

	for (const row of currentTxRows) {
		const cat = row.resolvedCategory ?? 'ukategorisert';
		const abs = Math.abs(row.amount);
		const existing = categoryMap.get(cat);
		if (existing) {
			existing.amount += abs;
			existing.count++;
		} else {
			categoryMap.set(cat, {
				label: row.resolvedLabel ?? cat,
				emoji: row.resolvedEmoji ?? '📦',
				amount: abs,
				count: 1,
				isFixed: row.isFixed ?? false
			});
		}
		if (row.isFixed) {
			totalFixed += abs;
		} else {
			totalVariable += abs;
		}
	}

	const categories = Array.from(categoryMap.entries())
		.map(([category, data]) => ({ category, ...data }))
		.sort((a, b) => b.amount - a.amount);

	const totalSpending = totalFixed + totalVariable;

	// 4. Fetch previous period spending for trend
	const prevTxRows = await queryCategorizedEvents({
		userId,
		from: prevFrom,
		to: currentFrom,
		spendingOnly: true
	});
	const previousMonthSpending = prevTxRows.reduce((sum, row) => sum + Math.abs(row.amount), 0);
	const spendingTrend = previousMonthSpending > 0
		? ((totalSpending - previousMonthSpending) / previousMonthSpending) * 100
		: 0;

	// 5. Fetch salary transaction amount
	let salaryAmount = 0;
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
				sql`${canonicalBankTransactions.canonicalDate} = ${currentSalaryDate}`,
				sql`${canonicalBankTransactions.amount} >= 10000`
			)
		)
		.orderBy(desc(canonicalBankTransactions.amount))
		.limit(5);

	for (const row of salaryTxRows) {
		const descText = (row.description ?? '').toLowerCase();
		if (SALARY_KEYWORDS.some((kw) => descText.includes(kw))) {
			salaryAmount = Number(row.amount);
			break;
		}
	}
	if (salaryAmount === 0 && salaryTxRows.length > 0) {
		salaryAmount = Number(salaryTxRows[0].amount);
	}

	// 6. Compute savings account balance change
	const savingsChanges: SalaryMonthReport['savingsChanges'] = [];
	if (sourceAccountId) {
		try {
			const dailyBalances = await buildDailyBalances(userId, sourceAccountId);

			// Get account name from latest bank_balance event
			const accountNameRow = await db
				.select({ accountName: sql<string>`data->>'accountName'` })
				.from(sensorEvents)
				.where(
					and(
						eq(sensorEvents.userId, userId),
						eq(sensorEvents.dataType, 'bank_balance'),
						sql`data->>'accountId' = ${sourceAccountId}`
					)
				)
				.orderBy(desc(sensorEvents.timestamp))
				.limit(1);
			const accountName = accountNameRow[0]?.accountName ?? sourceAccountId;

			// Find balance on or after payday
			const startRow = dailyBalances.find((r) => r.date >= currentSalaryDate);
			const endRow = dailyBalances.length > 0 ? dailyBalances[dailyBalances.length - 1] : null;

			if (startRow && endRow) {
				savingsChanges.push({
					accountId: sourceAccountId,
					accountName,
					startBalance: startRow.balance,
					endBalance: endRow.balance,
					change: endRow.balance - startRow.balance
				});
			}
		} catch {
			// Non-fatal
		}
	}

	// 7. Fetch goal tracks from memories store
	const goalProgress: GoalProgressItem[] = [];

	try {
		const storeMemory = await db.query.memories.findFirst({
			where: and(eq(memories.userId, userId), eq(memories.source, 'goal_tracks_v1')),
			columns: { content: true }
		});

		if (storeMemory?.content) {
			const store = JSON.parse(storeMemory.content) as Partial<Record<MetricId, GoalTrack[]>>;

			for (const metricId of ECONOMIC_METRIC_IDS) {
				const tracks = store[metricId] ?? [];
				const catalog = METRIC_CATALOG[metricId];
				if (!catalog) continue;

				for (const track of tracks) {
					// Compute actual value for this track in the current salary period
					let actualValue = 0;

					if (metricId === 'grocery_spend') {
						const groceryRows = await queryCategorizedEvents({
							userId,
							from: currentFrom,
							to: today,
							category: 'dagligvarer',
							spendingOnly: true
						});
						actualValue = groceryRows.reduce((sum, row) => sum + Math.abs(row.amount), 0);
					}

					const direction = catalog.direction as GoalProgressItem['direction'];
					const achieved =
						direction === 'lower_is_better'
							? actualValue <= track.targetValue
							: direction === 'higher_is_better'
								? actualValue >= track.targetValue
								: Math.abs(actualValue - track.targetValue) / track.targetValue < 0.1;

					goalProgress.push({
						type: 'track',
						metricId,
						label: track.label || catalog.label,
						targetValue: track.targetValue,
						actualValue,
						unit: track.unit || catalog.defaultUnit,
						direction,
						achieved
					});
				}
			}
		}
	} catch {
		// Non-fatal — report still works without goal tracks
	}

	// 8. Fetch active goals from goals table
	try {
		const activeGoals = await db
			.select({ id: goals.id, title: goals.title, description: goals.description })
			.from(goals)
			.where(and(eq(goals.userId, userId), eq(goals.status, 'active')))
			.limit(10);

		for (const goal of activeGoals) {
			goalProgress.push({
				type: 'goal',
				label: goal.title,
				targetValue: 0,
				actualValue: 0,
				unit: '',
				direction: 'higher_is_better',
				achieved: false,
				goalTitle: goal.title,
				goalDescription: goal.description
			});
		}
	} catch {
		// Non-fatal
	}

	const report: SalaryMonthReport = {
		currentSalaryDate,
		prevSalaryDate,
		salaryAmount,
		totalSpending,
		totalFixed,
		totalVariable,
		categories,
		savingsChanges,
		goalProgress,
		previousMonthSpending,
		spendingTrend
	};

	return json(report);
};
