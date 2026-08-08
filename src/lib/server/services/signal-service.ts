import { sql } from 'drizzle-orm';
import { db, pgClient, rowsOf } from '$lib/db';
import { users } from '$lib/db/schema';
import { fitBestEffortWeightModel, predictDeltaKg } from '$lib/util/effort-weight-model';
import { buildEffortWeightInputs } from '$lib/server/health/effort-weight-data';
import { getEnduranceWorkouts, getStrengthSessions } from '$lib/server/tracks/repository';
import { getRecentRouteLabels } from '$lib/server/tracks/routes-repository';
import { computeBalanceState } from '$lib/server/tracks/balance';
import { evaluateProteinVsLoad } from '$lib/domain/nutrition/protein-vs-load';
import { getGroceryWeekSpend } from '$lib/server/services/grocery-insights';
import { isoWeekKeyForDate } from '$lib/server/iso-week';
import { readDeduplicatedWorkouts } from '$lib/server/workouts/deduplicated-workouts';
import { matchesWorkoutSportFilter } from '$lib/domain/health/workout-sport';
import {
	collectFlokeStatus,
	collectFollowThrough7d,
	collectNaps7d,
	collectProactivity7d
} from '$lib/server/services/observed-behavior-service';
import {
	classifyBudgetPressure,
	classifyFlokeLoad,
	classifyFollowThrough,
	classifyNapLoad,
	classifyRestingHrElevation,
	projectBudget
} from '$lib/domain/observed-behavior';
import { readCategorySpend } from '$lib/server/goal-progress';
import { readChoreBalance } from '$lib/server/services/chore-service';
import { readMoodTrend } from '$lib/server/services/observed-behavior-service';
import { classifyChoreBalance, classifyMoodTrend } from '$lib/domain/observed-behavior';
import { CATEGORIES } from '$lib/integrations/transaction-categories-client';

type Severity = 'info' | 'low' | 'medium' | 'high';

type UpsertDomainSignalInput = {
	signalType: string;
	ownerDomain: 'health' | 'economics' | 'home' | 'relationship' | 'family';
	userId: string;
	relatedUserId?: string | null;
	valueNumber?: number | null;
	valueText?: string | null;
	valueBool?: boolean | null;
	severity: Severity;
	confidence: number;
	windowStart: Date;
	windowEnd: Date;
	observedAt: Date;
	context?: Record<string, unknown>;
	schemaVersion?: number;
};

type ProducedInputs = {
	budgetPressureSeverity: Severity;
	overdueCount7d: number;
	planningReliability14d: number;
};

function clamp01(value: number) {
	if (!Number.isFinite(value)) return 0;
	if (value < 0) return 0;
	if (value > 1) return 1;
	return value;
}

function daysAgo(now: Date, days: number) {
	return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function isoDay(now: Date) {
	return now.toISOString().slice(0, 10);
}

function startOfIsoWeekUtc(now: Date) {
	const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
	const day = d.getUTCDay();
	const diffToMonday = day === 0 ? -6 : 1 - day;
	d.setUTCDate(d.getUTCDate() + diffToMonday);
	d.setUTCHours(0, 0, 0, 0);
	return d;
}

function toSeverityFromRatio(ratio: number): Severity {
	if (ratio >= 1.25) return 'high';
	if (ratio >= 1.1) return 'medium';
	if (ratio >= 0.95) return 'low';
	return 'info';
}

function toNumber(value: unknown) {
	const n = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(n) ? n : 0;
}

function ratioToSeverity(ratio: number): Severity {
	if (ratio >= 1) return 'info';
	if (ratio >= 0.7) return 'low';
	if (ratio >= 0.4) return 'medium';
	return 'high';
}

async function upsertDomainSignal(input: UpsertDomainSignalInput) {
	const contextJson = JSON.stringify(input.context ?? {});
	const valueNumber = input.valueNumber ?? null;
	const valueText = input.valueText ?? null;
	const valueBool = input.valueBool ?? null;
	const schemaVersion = input.schemaVersion ?? 1;

	await db.execute(sql`
		INSERT INTO domain_signals (
			signal_type,
			owner_domain,
			user_id,
			related_user_id,
			value_number,
			value_text,
			value_bool,
			severity,
			confidence,
			window_start,
			window_end,
			observed_at,
			context,
			schema_version,
			updated_at
		)
		VALUES (
			${input.signalType},
			${input.ownerDomain},
			${input.userId},
			${input.relatedUserId ?? null},
			${valueNumber},
			${valueText},
			${valueBool},
			${input.severity},
			${String(input.confidence)},
			${input.windowStart},
			${input.windowEnd},
			${input.observedAt},
			${contextJson}::jsonb,
			${schemaVersion},
			NOW()
		)
		ON CONFLICT (user_id, signal_type, window_end)
		DO UPDATE SET
			owner_domain = EXCLUDED.owner_domain,
			related_user_id = EXCLUDED.related_user_id,
			value_number = EXCLUDED.value_number,
			value_text = EXCLUDED.value_text,
			value_bool = EXCLUDED.value_bool,
			severity = EXCLUDED.severity,
			confidence = EXCLUDED.confidence,
			window_start = EXCLUDED.window_start,
			observed_at = EXCLUDED.observed_at,
			context = EXCLUDED.context,
			schema_version = EXCLUDED.schema_version,
			updated_at = NOW()
	`);
}

async function ensureSignalContract(input: {
	signalType: string;
	ownerDomain: 'health' | 'economics' | 'home' | 'relationship';
	allowedConsumerDomains: Array<'health' | 'economics' | 'home' | 'relationship'>;
	description: string;
}) {
	await db.execute(sql`
		INSERT INTO signal_contracts (
			signal_type,
			owner_domain,
			allowed_consumer_domains,
			schema_version,
			status,
			description,
			updated_at
		)
		VALUES (
			${input.signalType},
			${input.ownerDomain},
			${`{${input.allowedConsumerDomains.join(',')}}`}::text[],
			1,
			'active',
			${input.description},
			NOW()
		)
		ON CONFLICT (signal_type)
		DO UPDATE SET
			owner_domain = EXCLUDED.owner_domain,
			allowed_consumer_domains = EXCLUDED.allowed_consumer_domains,
			schema_version = EXCLUDED.schema_version,
			status = EXCLUDED.status,
			description = EXCLUDED.description,
			updated_at = NOW()
	`);
}

async function produceActivityRunPrWeekSignal(userId: string, now: Date) {
	const windowStart = startOfIsoWeekUtc(now);

	await ensureSignalContract({
		signalType: 'activity_run_pr_week',
		ownerDomain: 'health',
		allowedConsumerDomains: ['health', 'home', 'relationship'],
		description: 'Number of running workouts this ISO week, used for weekly running-goal tracking.'
	});

	// Deduplikerte økter: én løpetur skrives av opptil tre kilder (klokke, GPX,
	// app), og en rå COUNT(*) gjorde uka til tre løpeturer på et «tre ganger»-mål.
	const workouts = await readDeduplicatedWorkouts(userId, windowStart, new Date(now.getTime() - 1));
	const runCount = workouts.filter((w) => matchesWorkoutSportFilter(w.sportType, 'running')).length;

	const goalRows = await db.execute(sql`
		SELECT id, metadata
		FROM goals
		WHERE user_id = ${userId}
		  AND status = 'active'
		  AND COALESCE(metadata->>'intentStatus', '') = 'parsed'
		  AND COALESCE(metadata->'parsedIntent'->>'signalType', '') = 'activity_run_pr_week'
		  AND COALESCE(metadata->'parsedIntent'->>'period', '') = 'week'
	`);

	const typedGoals = rowsOf<{
		id: string;
		metadata: Record<string, unknown> | null;
	}>(goalRows);

	let matchedGoals = 0;
	let metGoals = 0;
	let maxThreshold = 0;

	for (const goal of typedGoals) {
		const metadata = (goal.metadata ?? {}) as Record<string, unknown>;
		const parsedIntent = (metadata.parsedIntent ?? {}) as Record<string, unknown>;
		const threshold = toNumber(parsedIntent.threshold);
		if (threshold < 1) continue;

		matchedGoals += 1;
		maxThreshold = Math.max(maxThreshold, threshold);
		const met = runCount >= threshold;
		if (met) metGoals += 1;

		const nextMetadata = {
			...metadata,
			intentEvaluation: {
				signalType: 'activity_run_pr_week',
				window: 'week',
				windowStart: windowStart.toISOString(),
				windowEnd: now.toISOString(),
				currentValue: runCount,
				targetValue: threshold,
				comparator: '>=',
				met,
				lastEvaluatedAt: now.toISOString()
			}
		};

		await db.execute(sql`
			UPDATE goals
			SET metadata = ${JSON.stringify(nextMetadata)}::jsonb,
				updated_at = NOW()
			WHERE id = ${goal.id}
		`);
	}

	if (matchedGoals === 0) {
		return null;
	}

	const completionRatio = maxThreshold > 0 ? runCount / maxThreshold : 0;
	const severity = ratioToSeverity(completionRatio);

	await upsertDomainSignal({
		signalType: 'activity_run_pr_week',
		ownerDomain: 'health',
		userId,
		valueNumber: runCount,
		valueBool: metGoals === matchedGoals,
		valueText: `${runCount}`,
		severity,
		confidence: 0.85,
		windowStart,
		windowEnd: now,
		observedAt: now,
		context: {
			runCount,
			matchedGoals,
			metGoals,
			maxThreshold,
			completionRatio
		}
	});

	return {
		runCount,
		matchedGoals,
		metGoals
	};
}

async function produceTaskCompletionWeeklySignal(userId: string, now: Date) {
	const windowStart = startOfIsoWeekUtc(now);

	await ensureSignalContract({
		signalType: 'task_completion_weekly',
		ownerDomain: 'home',
		allowedConsumerDomains: ['home', 'relationship', 'health'],
		description: 'Weekly completion ratio for active weekly tasks with explicit targets.'
	});

	const rows = await db.execute(sql`
		SELECT
			t.id,
			t.target_value::int AS target_value,
			COALESCE(SUM(COALESCE(p.value, 1)), 0)::int AS current_value
		FROM tasks t
		JOIN goals g ON g.id = t.goal_id
		LEFT JOIN progress p
			ON p.task_id = t.id
			AND p.user_id = ${userId}
			AND p.completed_at >= ${windowStart}
			AND p.completed_at < ${now}
		WHERE g.user_id = ${userId}
		  AND g.status = 'active'
		  AND t.status = 'active'
		  AND t.frequency = 'weekly'
		  AND COALESCE(t.target_value, 0) > 0
		GROUP BY t.id, t.target_value
	`);

	const tasksWeekly = rowsOf<{
		id: string;
		target_value: number;
		current_value: number;
	}>(rows);

	if (tasksWeekly.length === 0) {
		return null;
	}

	let metCount = 0;
	let totalCurrent = 0;
	let totalTarget = 0;
	let completionRatioSum = 0;

	for (const task of tasksWeekly) {
		const target = Math.max(1, toNumber(task.target_value));
		const current = Math.max(0, toNumber(task.current_value));
		const met = current >= target;
		const completionRatio = Math.min(1, target > 0 ? current / target : 0);

		if (met) metCount += 1;
		totalCurrent += current;
		totalTarget += target;
		completionRatioSum += completionRatio;

		const evaluation = {
			signalType: 'task_completion_weekly',
			window: 'week',
			windowStart: windowStart.toISOString(),
			windowEnd: now.toISOString(),
			currentValue: current,
			targetValue: target,
			comparator: '>=',
			met,
			lastEvaluatedAt: now.toISOString()
		};

		await db.execute(sql`
			UPDATE tasks
			SET metadata = jsonb_set(
				COALESCE(metadata, '{}'::jsonb),
				'{intentEvaluation}',
				${JSON.stringify(evaluation)}::jsonb
			),
			updated_at = NOW()
			WHERE id = ${task.id}
		`);
	}

	const taskCount = tasksWeekly.length;
	const averageCompletionRatio = taskCount > 0 ? completionRatioSum / taskCount : 0;
	const allMet = metCount === taskCount;

	await upsertDomainSignal({
		signalType: 'task_completion_weekly',
		ownerDomain: 'home',
		userId,
		valueNumber: Number((averageCompletionRatio * 100).toFixed(2)),
		valueBool: allMet,
		valueText: `${metCount}/${taskCount}`,
		severity: ratioToSeverity(averageCompletionRatio),
		confidence: 0.85,
		windowStart,
		windowEnd: now,
		observedAt: now,
		context: {
			taskCount,
			metCount,
			totalCurrent,
			totalTarget,
			averageCompletionRatio
		}
	});

	return {
		taskCount,
		metCount,
		averageCompletionRatio
	};
}

async function produceEconomicsBudgetPressure7d(userId: string, now: Date) {
	const windowStart = daysAgo(now, 7);
	const prevStart = daysAgo(now, 37);
	const prevEnd = daysAgo(now, 7);

	const spend7dRows = await db.execute(sql`
		SELECT COALESCE(SUM(ABS(amount::numeric)), 0)::float8 AS value
		FROM categorized_events
		WHERE user_id = ${userId}
		  AND timestamp >= ${windowStart}
		  AND timestamp < ${now}
		  AND amount::numeric < 0
	`);

	const baselineRows = await db.execute(sql`
		SELECT COALESCE(SUM(ABS(amount::numeric)), 0)::float8 AS value
		FROM categorized_events
		WHERE user_id = ${userId}
		  AND timestamp >= ${prevStart}
		  AND timestamp < ${prevEnd}
		  AND amount::numeric < 0
	`);

	const spend7d = toNumber(rowsOf<{ value: number }>(spend7dRows)[0]?.value);
	const baseline30d = toNumber(rowsOf<{ value: number }>(baselineRows)[0]?.value);
	const baselineWeekly = baseline30d / (30 / 7);
	const ratio = baselineWeekly > 0 ? spend7d / baselineWeekly : 1;
	const severity = toSeverityFromRatio(ratio);
	const pressureBand = severity === 'high' ? 'high' : severity === 'medium' ? 'medium' : 'low';

	await upsertDomainSignal({
		signalType: 'economics_budget_pressure_7d',
		ownerDomain: 'economics',
		userId,
		valueNumber: ratio,
		valueText: pressureBand,
		severity,
		confidence: baseline30d > 0 ? 0.85 : 0.45,
		windowStart,
		windowEnd: now,
		observedAt: now,
		context: {
			spend7d,
			baselineWeekly,
			ratio,
			baselineWindowDays: 30
		}
	});

	return severity;
}

// Ukentlig dagligvareforbruk (kategori 'dagligvarer') mot snitt av 4 foregående
// hele uker, prorated for hvor langt uka er kommet. Leser via
// queryCanonicalTransactions (foretrukket lesevei — håndterer overrides og
// merchant-mappings, inkl. Oda). Del av matplan-prosjektet.
async function produceEconomicsGrocerySpendWeekly(userId: string, now: Date) {
	await ensureSignalContract({
		signalType: 'economics_grocery_spend_weekly',
		ownerDomain: 'economics',
		allowedConsumerDomains: ['economics', 'home'],
		description: 'Grocery spend week-to-date vs. 4-week weekly average (prorated ratio). Supports the meal-planning loop (Oda).'
	});

	const weekStart = startOfIsoWeekUtc(now);
	const { spend: spendWeekToDate, baselineWeeklyAvg, budgetWeekly, transactionCount } =
		await getGroceryWeekSpend(userId, weekStart, now);

	// Ukebudsjett (food_settings) trumfer historisk snitt som referanse når satt.
	const referenceWeekly = budgetWeekly != null && budgetWeekly > 0 ? budgetWeekly : baselineWeeklyAvg;

	// Prorate referansen mot hvor langt uka er kommet (minst én dag).
	const daysElapsed = Math.max(1, (now.getTime() - weekStart.getTime()) / 86400000);
	const expectedToDate = referenceWeekly * (Math.min(7, daysElapsed) / 7);
	const ratio = expectedToDate > 0 ? spendWeekToDate / expectedToDate : 1;
	const severity = toSeverityFromRatio(ratio);
	const pressureBand = severity === 'high' ? 'high' : severity === 'medium' ? 'medium' : 'low';

	await upsertDomainSignal({
		signalType: 'economics_grocery_spend_weekly',
		ownerDomain: 'economics',
		userId,
		valueNumber: ratio,
		valueText: pressureBand,
		severity,
		confidence: referenceWeekly > 0 ? 0.85 : 0.4,
		windowStart: weekStart,
		windowEnd: now,
		observedAt: now,
		context: {
			spendWeekToDate,
			baselineWeeklyAvg,
			budgetWeekly,
			referenceSource: budgetWeekly != null && budgetWeekly > 0 ? 'budget' : 'baseline',
			expectedToDate,
			ratio,
			transactionCount,
			weekContext: isoWeekKeyForDate(now.toISOString().slice(0, 10))
		}
	});

	return severity;
}

async function produceHomeOverdueSharedTasks7d(userId: string, now: Date) {
	const windowStart = daysAgo(now, 7);
	const overdueThreshold = daysAgo(now, 7);

	const rows = await db.execute(sql`
		SELECT COUNT(ci.id)::int AS value
		FROM checklist_items ci
		INNER JOIN checklists c ON c.id = ci.checklist_id
		WHERE c.user_id = ${userId}
		  AND ci.checked = false
		  AND ci.created_at < ${overdueThreshold}
	`);

	const overdueCount = toNumber(rowsOf<{ value: number }>(rows)[0]?.value);
	const severity: Severity = overdueCount > 7 ? 'high' : overdueCount > 3 ? 'medium' : overdueCount > 0 ? 'low' : 'info';
	const bucket = overdueCount === 0 ? 'none' : overdueCount <= 3 ? 'few' : overdueCount <= 7 ? 'some' : 'many';

	await upsertDomainSignal({
		signalType: 'home_overdue_shared_tasks_7d',
		ownerDomain: 'home',
		userId,
		valueNumber: overdueCount,
		valueText: bucket,
		severity,
		confidence: 0.7,
		windowStart,
		windowEnd: now,
		observedAt: now,
		context: {
			overdueCount,
			overdueThresholdDays: 7
		}
	});

	return overdueCount;
}

async function produceHomePlanningReliability14d(userId: string, now: Date) {
	const windowStart = daysAgo(now, 14);

	const rows = await db.execute(sql`
		SELECT
			c.id,
			COUNT(ci.id)::int AS item_count,
			COALESCE(SUM(CASE WHEN ci.checked = false THEN 1 ELSE 0 END), 0)::int AS unchecked_count
		FROM checklists c
		LEFT JOIN checklist_items ci ON ci.checklist_id = c.id
		WHERE c.user_id = ${userId}
		  AND c.context LIKE 'week:%:day:%'
		  AND c.created_at >= ${windowStart}
		  AND c.created_at < ${now}
		GROUP BY c.id
	`);

	const typedRows = rowsOf<{ id: string; item_count: number; unchecked_count: number }>(rows);
	const planned = typedRows.filter((row) => toNumber(row.item_count) > 0).length;
	const completed = typedRows.filter((row) => toNumber(row.item_count) > 0 && toNumber(row.unchecked_count) === 0).length;
	const reliability = planned > 0 ? (completed / planned) * 100 : 100;
	const severity: Severity = reliability < 40 ? 'high' : reliability < 60 ? 'medium' : reliability < 80 ? 'low' : 'info';

	await upsertDomainSignal({
		signalType: 'home_planning_reliability_14d',
		ownerDomain: 'home',
		userId,
		valueNumber: reliability,
		valueText: reliability >= 80 ? 'high' : reliability >= 60 ? 'medium' : 'low',
		severity,
		confidence: planned > 0 ? 0.85 : 0.45,
		windowStart,
		windowEnd: now,
		observedAt: now,
		context: {
			planned,
			completed,
			reliability
		}
	});

	return reliability;
}

async function produceRoutineAdherence7d(userId: string, now: Date) {
	const windowStart = daysAgo(now, 7);

	await ensureSignalContract({
		signalType: 'routine_adherence_7d',
		ownerDomain: 'home',
		allowedConsumerDomains: ['home', 'health', 'relationship'],
		description: 'Andel av items i routine-checklists siste 7 dager som er hakket av (på tvers av egenpleie, trening, hus, familie). God indikator på overskudd/underskudd. NB: lagt under ownerDomain=home av schema-begrensninger, ikke fordi rutiner er hus-spesifikke.'
	});

	const rows = await db.execute(sql`
		SELECT
			COUNT(ci.id)::int AS item_count,
			COALESCE(SUM(CASE WHEN ci.checked = true THEN 1 ELSE 0 END), 0)::int AS checked_count,
			COUNT(DISTINCT c.id)::int AS instance_count
		FROM checklists c
		LEFT JOIN checklist_items ci ON ci.checklist_id = c.id
		WHERE c.user_id = ${userId}
		  AND c.context LIKE 'routine:%'
		  AND c.created_at >= ${windowStart}
		  AND c.created_at < ${now}
	`);

	const typedRows = rowsOf<{ item_count: number; checked_count: number; instance_count: number }>(rows);
	const itemCount = toNumber(typedRows[0]?.item_count);
	const checkedCount = toNumber(typedRows[0]?.checked_count);
	const instanceCount = toNumber(typedRows[0]?.instance_count);

	if (itemCount === 0) {
		return null;
	}

	const adherence = (checkedCount / itemCount) * 100;
	const severity: Severity = adherence >= 80 ? 'info' : adherence >= 60 ? 'low' : adherence >= 40 ? 'medium' : 'high';
	const band = adherence >= 80 ? 'high' : adherence >= 60 ? 'medium' : adherence >= 40 ? 'low' : 'very_low';

	await upsertDomainSignal({
		signalType: 'routine_adherence_7d',
		ownerDomain: 'home',
		userId,
		valueNumber: adherence,
		valueText: band,
		severity,
		confidence: instanceCount >= 3 ? 0.85 : 0.55,
		windowStart,
		windowEnd: now,
		observedAt: now,
		context: {
			adherence,
			checkedCount,
			itemCount,
			instanceCount,
			windowDays: 7
		}
	});

	return adherence;
}

/**
 * Kveldsjobbing på PC siste 7 dager, fra RescueTime (dataType 'rescuetime_day').
 * Fase 1: ikke noe jobb/hobby-skille — måler kveldsaktivitet (fra kl. 17) totalt,
 * med kategorifordeling som kontekst. Returnerer null uten RescueTime-data.
 */
async function produceEveningScreenWork7d(userId: string, now: Date) {
	const windowStart = new Date(now.getTime() - 7 * 24 * 3600_000);

	const dayRows = await db.execute(sql`
		SELECT data
		FROM sensor_events
		WHERE user_id = ${userId}
		  AND data_type = 'rescuetime_day'
		  AND timestamp >= ${windowStart}
		  AND timestamp <= ${now}
	`);
	const days = rowsOf<{ data: Record<string, unknown> | null }>(dayRows);
	if (days.length === 0) {
		return null;
	}

	await ensureSignalContract({
		signalType: 'evening_screen_work_7d',
		ownerDomain: 'health',
		allowedConsumerDomains: ['health', 'home', 'relationship'],
		description:
			'PC-aktivitet på kveldstid (fra kl. 17) siste 7 dager fra RescueTime — antall kvelder, total tid og toppkategorier. Brukes til å se kveldsjobbing-mønster.'
	});

	const EVENING_DAY_THRESHOLD_SECONDS = 15 * 60;
	let totalEveningSeconds = 0;
	let productiveEveningSeconds = 0;
	let eveningDays = 0;
	const categoryTotals = new Map<string, number>();
	const perDay: Array<{ dateISO: string; eveningMinutes: number }> = [];

	for (const row of days) {
		const data = (row.data ?? {}) as Record<string, unknown>;
		const evening = (data.evening ?? {}) as Record<string, unknown>;
		const seconds = toNumber(evening.seconds);
		totalEveningSeconds += seconds;
		productiveEveningSeconds += toNumber(evening.productiveSeconds);
		if (seconds >= EVENING_DAY_THRESHOLD_SECONDS) eveningDays += 1;
		perDay.push({
			dateISO: typeof data.dateISO === 'string' ? data.dateISO : '',
			eveningMinutes: Math.round(seconds / 60)
		});
		const byCategory = Array.isArray(evening.byCategory) ? evening.byCategory : [];
		for (const entry of byCategory as Array<Record<string, unknown>>) {
			const category = typeof entry.category === 'string' ? entry.category : null;
			if (!category) continue;
			categoryTotals.set(category, (categoryTotals.get(category) ?? 0) + toNumber(entry.seconds));
		}
	}

	const topCategories = [...categoryTotals.entries()]
		.map(([category, seconds]) => ({ category, minutes: Math.round(seconds / 60) }))
		.sort((a, b) => b.minutes - a.minutes)
		.slice(0, 5);

	const eveningHours = totalEveningSeconds / 3600;
	const severity: Severity =
		eveningDays >= 4 && eveningHours >= 4 ? 'medium' : eveningDays >= 2 ? 'low' : 'info';

	await upsertDomainSignal({
		signalType: 'evening_screen_work_7d',
		ownerDomain: 'health',
		userId,
		valueNumber: Math.round(totalEveningSeconds / 60),
		valueText: `${eveningDays} kvelder, ${eveningHours.toFixed(1)} t`,
		severity,
		confidence: days.length >= 5 ? 0.85 : 0.6,
		windowStart,
		windowEnd: now,
		observedAt: now,
		context: {
			eveningDays,
			totalEveningMinutes: Math.round(totalEveningSeconds / 60),
			productiveEveningMinutes: Math.round(productiveEveningSeconds / 60),
			topCategories,
			perDay,
			daysWithData: days.length,
			windowDays: 7
		}
	});

	return { eveningDays, totalEveningMinutes: Math.round(totalEveningSeconds / 60) };
}

/**
 * Nåværende effort-nivå (snitt over modellens vindu) mot estimert ukentlig
 * effort-terskel for vektvedlikehold/-nedgang. Terskelen fittes fra
 * historiske ukespar med vindu-skanning for kumulativ/lag-effekt.
 */
async function produceHealthEffortVsThreshold(userId: string, now: Date) {
	// Direkte fra kildene (sensor_events + canonical_workouts) — historiske
	// sensor_aggregates kan mangle weeklyEffort og ville gitt falske 0-uker.
	// Hele historikken brukes (samme grunnlag som effort/vekt-kortet).
	const { weeks: inputs, rolling7dEffort } = await buildEffortWeightInputs(userId);

	// Hopp over brukere helt uten vektdata — signalet gir ingen mening da.
	if (!inputs.some((w) => w.weightAvg != null)) {
		return null;
	}

	await ensureSignalContract({
		signalType: 'health_effort_vs_threshold',
		ownerDomain: 'health',
		allowedConsumerDomains: ['health', 'home', 'relationship'],
		description:
			'Nåværende ukentlig effort-nivå (snitt over modellens lag-vindu) mot estimert effort-terskel for vektvedlikehold/-nedgang (lineær regresjon av ukentlig vektendring mot trailing snitt-effort). context har modellparametre og kvalitet.'
	});

	const { model, windowWeeks, binThreshold, effectiveThreshold, thresholdSource } =
		fitBestEffortWeightModel(inputs);

	// Nå-tilstand i samme enhet som modellens x: snitt-effort siste L uker
	const lastWindow = inputs.slice(-windowWeeks);
	const currentEffortAvg =
		lastWindow.length > 0
			? Math.round(lastWindow.reduce((sum, w) => sum + w.effort, 0) / lastWindow.length)
			: 0;

	const threshold = effectiveThreshold;
	const hasThreshold = threshold != null && threshold > 0;
	const ratio = hasThreshold ? currentEffortAvg / threshold : null;
	const pctVsThreshold = ratio != null ? Math.round((ratio - 1) * 100) : null;
	const predictedWeeklyDeltaKg =
		thresholdSource === 'regresjon'
			? predictDeltaKg(model, currentEffortAvg)
			: thresholdSource === 'bins' && binThreshold != null && hasThreshold && currentEffortAvg >= threshold
				? binThreshold.topBinMeanDeltaKg
				: null;

	let valueText: string;
	if (ratio == null) valueText = 'ukjent';
	else if (ratio >= 1) valueText = 'over_terskel';
	else if (ratio >= 0.85) valueText = 'naer_terskel';
	else if (ratio >= 0.6) valueText = 'under_terskel';
	else valueText = 'langt_under';

	// Høy severity = trenger oppmerksomhet gitt intensjon om vektnedgang.
	let severity: Severity;
	if (ratio == null || ratio >= 1) severity = 'info';
	else if (ratio >= 0.85) severity = 'low';
	else if (ratio >= 0.6) severity = 'medium';
	else severity = 'high';

	const confidence =
		thresholdSource === 'bins'
			? 0.6
			: model.quality === 'good'
				? 0.85
				: model.quality === 'ok'
					? 0.7
					: model.quality === 'weak'
						? 0.45
						: 0.3;

	const weeklyEffortLast8 = inputs.slice(-8).map((w) => Math.round(w.effort));

	await upsertDomainSignal({
		signalType: 'health_effort_vs_threshold',
		ownerDomain: 'health',
		userId,
		valueNumber: ratio != null ? Math.round(ratio * 100) / 100 : null,
		valueText,
		severity,
		confidence,
		windowStart: daysAgo(now, 7),
		windowEnd: now,
		observedAt: now,
		context: {
			thresholdEffort: threshold,
			thresholdSource,
			binThreshold,
			slope: model.slope,
			intercept: model.intercept,
			r: model.r,
			nWeeks: model.nWeeks,
			quality: model.quality,
			extrapolated: model.extrapolated,
			rolling7dEffort,
			currentEffortAvg,
			windowWeeks,
			pctVsThreshold,
			predictedWeeklyDeltaKg,
			weeklyEffortLast8,
			modelWindowWeeks: inputs.length
		}
	});

	return { ratio, quality: model.quality, rolling7dEffort };
}

/**
 * Protein mot treningsbelastning: spiser du nok til det du gjør?
 *
 * Kryss-domene-signalet mellom Ernæring og Trening. Hverken flate kan se det
 * alene — Trening kjenner belastningen, Ernæring inntaket, og spørsmålet ligger
 * mellom dem. Det er nettopp den typen sammenheng mortemaet finnes for.
 *
 * Leser ukesaggregatet framfor loggen direkte, fordi `metrics.nutrition` og
 * `metrics.weeklyEffort` da kommer fra samme periode og samme rad.
 *
 * Returnerer null når grunnlaget er for tynt — se `evaluateProteinVsLoad`.
 */
async function produceProteinVsLoad(userId: string, now: Date) {
	const weekRows = await db.execute(sql`
		SELECT metrics
		FROM sensor_aggregates
		WHERE user_id = ${userId} AND period = 'week'
		ORDER BY start_date DESC
		LIMIT 1
	`);

	// NB: MÅ gå gjennom rowsOf — neon-http gir et resultatobjekt, ikke en array.
	const metrics = rowsOf<{ metrics: Record<string, any> | null }>(weekRows)[0]?.metrics ?? null;
	if (!metrics) return null;

	const evaluation = evaluateProteinVsLoad({
		proteinPerDay: toNumber(metrics.nutrition?.proteinPerDay),
		loggedDays: toNumber(metrics.nutrition?.loggedDays) ?? 0,
		weeklyEffort: toNumber(metrics.weeklyEffort?.total),
		// Ukesvekten først; månedssnittet er ikke på denne raden, og en uke uten
		// veiing skal ikke gi et signal basert på fjorårets vekt.
		bodyWeightKg: toNumber(metrics.weight?.latest) ?? toNumber(metrics.weight?.avg)
	});
	if (!evaluation) return null;

	await ensureSignalContract({
		signalType: 'nutrition_protein_vs_load',
		ownerDomain: 'health',
		allowedConsumerDomains: ['health'],
		description:
			'Loggført protein per dag mot behovet treningsbelastningen tilsier (1,2–1,7 g/kg etter ukens effort). valueNumber = gram som mangler per dag (negativt = over målet), valueText = mål i g/kg. context har mål, faktisk inntak, andel og antall loggede dager.'
	});

	await upsertDomainSignal({
		signalType: 'nutrition_protein_vs_load',
		ownerDomain: 'health',
		userId,
		valueNumber: evaluation.deficit,
		valueText: `${evaluation.gPerKg} g/kg`,
		severity: evaluation.severity,
		// Konfidensen speiler at inntaket er et estimat, ikke en måling, og at
		// den bygger på så mange dager som brukeren faktisk logget.
		confidence: Math.min(0.7, 0.35 + evaluation.loggedDays * 0.05),
		windowStart: daysAgo(now, 7),
		windowEnd: now,
		observedAt: now,
		context: {
			targetPerDay: evaluation.targetPerDay,
			actualPerDay: evaluation.actualPerDay,
			deficit: evaluation.deficit,
			share: evaluation.share,
			gPerKg: evaluation.gPerKg,
			loggedDays: evaluation.loggedDays,
			weeklyEffort: evaluation.weeklyEffort,
			message: evaluation.message
		}
	});

	return evaluation;
}

/**
 * Treningsbalanse-signalet: disiplin-miks, styrke-dekning og intensitetsspredning
 * siste ~4 uker + én nudge mot det underbrukte hodet. Cache for hjem-widget og
 * AI-coach; /trening beregner samme tilstand live. Balanse påvirker forslag,
 * ikke effort-skåringen. Returnerer null for brukere uten registrert trening.
 */
async function produceTrainingBalance(userId: string, now: Date) {
	const day = isoDay(now);
	const [workouts, strengthSessions, routeLabels] = await Promise.all([
		getEnduranceWorkouts(userId, 42),
		getStrengthSessions(userId, 42),
		getRecentRouteLabels(userId, 42).catch(() => [] as string[])
	]);
	if (workouts.length === 0 && strengthSessions.length === 0) return null;

	// Enkel referanse-pace for intensitetssoner: median pace av tellende løp.
	const runPaces = workouts
		.filter((w) => w.family === 'running' && (w.distanceMeters ?? 0) >= 500 && (w.durationSeconds ?? 0) > 0)
		.map((w) => (w.durationSeconds ?? 0) / ((w.distanceMeters ?? 0) / 1000))
		.filter((p) => p <= 540)
		.sort((a, b) => a - b);
	const easyPace = runPaces.length > 0 ? runPaces[Math.floor(runPaces.length / 2)] : null;

	const balance = computeBalanceState(
		workouts,
		strengthSessions.map((s) => s.date),
		easyPace,
		day,
		routeLabels
	);
	if (balance.totalEffort === 0) return null;

	await ensureSignalContract({
		signalType: 'training_balance',
		ownerDomain: 'health',
		allowedConsumerDomains: ['health', 'home', 'relationship'],
		description:
			'Treningsbalanse siste 4 uker: disiplin-miks (andel effort per family), styrke-dekning denne uka og intensitetsspredning for løp. valueNumber = balanse-score 0–100, valueText = nudge-type. context har miks, intensitet og nudge-tekst.'
	});

	// Nudge = trenger oppmerksomhet. Ingen nudge = balansen er god.
	const severity: Severity = balance.nudge
		? balance.nudge.severity === 'medium'
			? 'medium'
			: 'low'
		: 'info';

	await upsertDomainSignal({
		signalType: 'training_balance',
		ownerDomain: 'health',
		userId,
		valueNumber: balance.score,
		valueText: balance.nudge?.kind ?? 'balansert',
		severity,
		confidence: 0.7,
		windowStart: daysAgo(now, 28),
		windowEnd: now,
		observedAt: now,
		context: {
			score: balance.score,
			totalEffort: balance.totalEffort,
			disciplines: balance.disciplines,
			strengthSessionsThisWeek: balance.strengthSessionsThisWeek,
			runSessionsThisWeek: balance.runSessionsThisWeek,
			intensity: balance.intensity,
			routeRotation: balance.routeRotation,
			nudge: balance.nudge
		}
	});

	return { score: balance.score, nudge: balance.nudge };
}

async function produceRelationshipCoordinationReadinessToday(userId: string, relatedUserId: string, now: Date) {
	const day = isoDay(now);
	const windowStart = new Date(`${day}T00:00:00.000Z`);

	const rows = await db.execute(sql`
		SELECT (data->>'score')::int AS score
		FROM sensor_events
		WHERE user_id = ${userId}
		  AND data_type = 'relationship_checkin'
		  AND data->>'day' = ${day}
		ORDER BY timestamp DESC
		LIMIT 1
	`);

	const score = toNumber(rowsOf<{ score: number }>(rows)[0]?.score);
	const readiness = score <= 3 ? 'low' : score <= 5 ? 'medium' : score > 0 ? 'high' : 'medium';
	const severity: Severity = readiness === 'low' ? 'high' : readiness === 'medium' ? 'low' : 'info';

	await upsertDomainSignal({
		signalType: 'relationship_coordination_readiness_today',
		ownerDomain: 'relationship',
		userId,
		relatedUserId,
		valueText: readiness,
		valueNumber: score || null,
		severity,
		confidence: score > 0 ? 0.8 : 0.4,
		windowStart,
		windowEnd: now,
		observedAt: now,
		context: {
			day,
			score: score || null,
			readiness
		}
	});
}

async function produceRelationshipLogisticsStressIndex14d(
	userId: string,
	relatedUserId: string,
	now: Date,
	inputs: ProducedInputs
) {
	const pressureScore = inputs.budgetPressureSeverity === 'high'
		? 1
		: inputs.budgetPressureSeverity === 'medium'
			? 0.7
			: inputs.budgetPressureSeverity === 'low'
				? 0.4
				: 0.15;
	const overdueNorm = clamp01(inputs.overdueCount7d / 6);
	const reliabilityPenalty = clamp01((80 - inputs.planningReliability14d) / 80);
	const indexValue = (pressureScore * 0.4 + overdueNorm * 0.35 + reliabilityPenalty * 0.25) * 100;
	const severity: Severity = indexValue >= 70 ? 'high' : indexValue >= 45 ? 'medium' : indexValue >= 20 ? 'low' : 'info';
	const windowStart = daysAgo(now, 14);

	await upsertDomainSignal({
		signalType: 'relationship_logistics_stress_index_14d',
		ownerDomain: 'relationship',
		userId,
		relatedUserId,
		valueNumber: indexValue,
		valueText: severity,
		severity,
		confidence: 0.75,
		windowStart,
		windowEnd: now,
		observedAt: now,
		context: {
			budgetPressureSeverity: inputs.budgetPressureSeverity,
			overdueCount7d: inputs.overdueCount7d,
			planningReliability14d: inputs.planningReliability14d,
			indexValue
		}
	});
}

async function produceTrackingSeriesActivityPrWeekSignal(userId: string, now: Date) {
	const windowStart = startOfIsoWeekUtc(now);

	const goalRows = await db.execute(sql`
		SELECT id, metadata
		FROM goals
		WHERE user_id = ${userId}
		  AND status = 'active'
		  AND COALESCE(metadata->>'intentStatus', '') = 'parsed'
		  AND COALESCE(metadata->'parsedIntent'->>'signalType', '') = 'tracking_series_activity_pr_week'
		  AND COALESCE(metadata->'parsedIntent'->>'period', '') = 'week'
	`);

	const typedGoals = rowsOf<{
		id: string;
		metadata: Record<string, unknown> | null;
	}>(goalRows);

	if (typedGoals.length === 0) return null;

	let produced = 0;

	for (const goal of typedGoals) {
		const metadata = (goal.metadata ?? {}) as Record<string, unknown>;
		const parsedIntent = (metadata.parsedIntent ?? {}) as Record<string, unknown>;
		const activityType = String(parsedIntent.activityType ?? '');
		const threshold = toNumber(parsedIntent.threshold);
		if (!activityType || threshold < 1) continue;

		const countRows = await db.execute(sql`
			SELECT COUNT(*)::int AS value
			FROM sensor_events
			WHERE user_id = ${userId}
			  AND timestamp >= ${windowStart}
			  AND timestamp < ${now}
			  AND data->>'recordTypeKey' = ${activityType}
		`);
		const count = toNumber(rowsOf<{ value: number }>(countRows)[0]?.value);

		const met = count >= threshold;
		const evaluation = {
			signalType: 'tracking_series_activity_pr_week',
			activityType,
			window: 'week',
			windowStart: windowStart.toISOString(),
			windowEnd: now.toISOString(),
			currentValue: count,
			targetValue: threshold,
			comparator: '>=',
			met,
			lastEvaluatedAt: now.toISOString()
		};

		await db.execute(sql`
			UPDATE goals
			SET metadata = ${JSON.stringify({ ...metadata, intentEvaluation: evaluation })}::jsonb,
				updated_at = NOW()
			WHERE id = ${goal.id}
		`);

		await db.execute(sql`
			UPDATE tasks
			SET metadata = jsonb_set(
				COALESCE(metadata, '{}'::jsonb),
				'{intentEvaluation}',
				${JSON.stringify(evaluation)}::jsonb
			),
			updated_at = NOW()
			WHERE goal_id = ${goal.id}
			  AND status = 'active'
			  AND frequency = 'weekly'
		`);

		const completionRatio = threshold > 0 ? count / threshold : 0;
		const severity: Severity =
			completionRatio >= 1 ? 'info' : completionRatio >= 0.7 ? 'low' : completionRatio >= 0.4 ? 'medium' : 'high';
		const signalType = `tracking_series_activity_pr_week_${activityType}`;

		await ensureSignalContract({
			signalType,
			ownerDomain: 'health',
			allowedConsumerDomains: ['health'],
			description: `Weekly ${activityType} activity count vs goal (manual tracking).`
		});

		await upsertDomainSignal({
			signalType,
			ownerDomain: 'health',
			userId,
			valueNumber: count,
			valueBool: met,
			valueText: `${count}`,
			severity,
			confidence: 0.9,
			windowStart,
			windowEnd: now,
			observedAt: now,
			context: { activityType, count, threshold, completionRatio, met }
		});

		produced++;
	}

	return produced > 0 ? { produced } : null;
}

// ─── Family signal producers ─────────────────────────────────────

async function produceFamilyBirthdayUpcoming7d(userId: string, now: Date) {
	const rows = await db.execute(sql`
		SELECT id, name, birth_date, kind
		FROM persons
		WHERE user_id = ${userId}
		  AND archived = false
		  AND birth_date IS NOT NULL
	`);
	const persons = rowsOf<{ id: string; name: string; birth_date: string; kind: string }>(rows);

	for (const p of persons) {
		const bd = new Date(p.birth_date);
		if (Number.isNaN(bd.getTime())) continue;
		const next = new Date(now.getFullYear(), bd.getMonth(), bd.getDate());
		if (next < now) next.setFullYear(now.getFullYear() + 1);
		const days = Math.floor((next.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
		if (days < 0 || days > 7) continue;

		const severity: Severity = days <= 1 ? 'high' : days <= 3 ? 'medium' : 'low';
		await upsertDomainSignal({
			signalType: 'family_birthday_upcoming_7d',
			ownerDomain: 'family',
			userId,
			valueNumber: days,
			valueText: p.name,
			severity,
			confidence: 1,
			windowStart: now,
			windowEnd: next,
			observedAt: now,
			context: {
				personId: p.id,
				name: p.name,
				kind: p.kind,
				daysUntil: days
			}
		});
	}
}

async function produceFamilyRelationNeglect30d(userId: string, now: Date) {
	const rows = await db.execute(sql`
		SELECT
			p.id,
			p.name,
			p.kind,
			GREATEST(
				COALESCE((SELECT MAX(created_at) FROM memories WHERE person_id = p.id AND user_id = ${userId}), '1970-01-01'::timestamp),
				COALESCE((SELECT MAX(timestamp) FROM sensor_events WHERE person_id = p.id AND user_id = ${userId}), '1970-01-01'::timestamp)
			) AS last_touch
		FROM persons p
		WHERE p.user_id = ${userId}
		  AND p.archived = false
		  AND p.kind IN ('parent', 'in_law', 'extended_family', 'sibling', 'friend')
	`);

	const items = rowsOf<{ id: string; name: string; kind: string; last_touch: string }>(rows);
	const windowStart = daysAgo(now, 30);

	for (const it of items) {
		const last = new Date(it.last_touch);
		const daysSince = Math.floor((now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24));
		const severity: Severity = daysSince > 90 ? 'high' : daysSince > 60 ? 'medium' : daysSince > 30 ? 'low' : 'info';
		if (severity === 'info') continue;
		await upsertDomainSignal({
			signalType: 'family_relation_neglect_30d',
			ownerDomain: 'family',
			userId,
			valueNumber: daysSince,
			valueText: it.name,
			severity,
			confidence: 0.6,
			windowStart,
			windowEnd: now,
			observedAt: now,
			context: {
				personId: it.id,
				name: it.name,
				kind: it.kind,
				daysSince
			}
		});
	}
}

async function produceFamilyParentTimeLow7d(userId: string, now: Date) {
	const windowStart = daysAgo(now, 7);
	const rows = await db.execute(sql`
		SELECT
			ts.id AS series_id,
			ts.title,
			ts.theme_id,
			ts.task_id,
			COALESCE((
				SELECT SUM(COALESCE((data->>'value')::numeric, (data->>'duration')::numeric, 1))
				FROM sensor_events
				WHERE user_id = ${userId}
				  AND data->>'recordTypeKey' = 'parent_time'
				  AND data->>'trackingSeriesId' = ts.id::text
				  AND timestamp >= ${windowStart}
				  AND timestamp <= ${now}
			), 0) AS total_value
		FROM tracking_series ts
		WHERE ts.user_id = ${userId}
		  AND ts.status = 'active'
		  AND ts.title ILIKE 'foreldretid%'
	`);
	const seriesRows = rowsOf<{
		series_id: string;
		title: string;
		theme_id: string | null;
		task_id: string | null;
		total_value: string | number;
	}>(rows);
	for (const r of seriesRows) {
		const total = toNumber(r.total_value);
		const severity: Severity = total < 1 ? 'high' : total < 2 ? 'medium' : total < 4 ? 'low' : 'info';
		if (severity === 'info') continue;
		await upsertDomainSignal({
			signalType: 'family_parent_time_low_7d',
			ownerDomain: 'family',
			userId,
			valueNumber: total,
			valueText: r.title,
			severity,
			confidence: 0.7,
			windowStart,
			windowEnd: now,
			observedAt: now,
			context: {
				trackingSeriesId: r.series_id,
				totalValue: total
			}
		});
	}
}

/**
 * Powernaps siste 7 dager (detekterte + manuelle), hver koblet mot natten før.
 * Kontekstens `shortNightNaps` er konfrontasjonsmaterialet: naps etter netter
 * under 6,5t peker på søvnunderskudd som driver. Null uten søvndata.
 */
async function produceSleepPowernaps7d(userId: string, now: Date) {
	const windowStart = daysAgo(now, 7);

	await ensureSignalContract({
		signalType: 'sleep_powernaps_7d',
		ownerDomain: 'health',
		allowedConsumerDomains: ['health', 'home', 'relationship'],
		description:
			'Antall powernaps siste 7 dager (Withings-detekterte + manuelt registrerte), hver koblet mot søvntimer natten før. Mål-bevisst severity når et nap-mål (maxPerWeek) finnes.'
	});

	const naps = await collectNaps7d(userId, now);
	if (!naps.hasSleepData) return null;

	const severity = classifyNapLoad(naps.count, naps.maxPerWeek);
	const shortNightNaps = naps.withPriorNights.filter(
		(n) => n.priorNightHours !== null && n.priorNightHours < 6.5
	);

	await upsertDomainSignal({
		signalType: 'sleep_powernaps_7d',
		ownerDomain: 'health',
		userId,
		valueNumber: naps.count,
		valueText: naps.maxPerWeek !== null ? (naps.count <= naps.maxPerWeek ? 'within_goal' : 'over_goal') : null,
		valueBool: naps.maxPerWeek !== null ? naps.count <= naps.maxPerWeek : null,
		severity,
		confidence: 0.85,
		windowStart,
		windowEnd: now,
		observedAt: now,
		context: {
			napCount: naps.count,
			totalMinutes: naps.totalMinutes,
			maxPerWeek: naps.maxPerWeek,
			shortNightNapCount: shortNightNaps.length,
			naps: naps.withPriorNights.map((n) => ({
				start: n.start.toISOString(),
				durationMinutes: n.durationMinutes,
				priorNightHours: n.priorNightHours
			}))
		}
	});

	return naps.count;
}

/**
 * Gjennomføring siste 7 dager: dagsplan-punkter planlagt → fullført, med
 * snoozet/skippet eksplisitt talt — den observerte «gjort»-dimensjonen fra
 * egenfrekvens-pyramiden. Null uten planlagte punkter.
 */
async function produceActionFollowThrough7d(userId: string, now: Date) {
	const windowStart = daysAgo(now, 7);

	await ensureSignalContract({
		signalType: 'action_follow_through_7d',
		ownerDomain: 'home',
		allowedConsumerDomains: ['home', 'health', 'relationship'],
		description:
			'Andel planlagte dagsplan-punkter fullført siste 7 dager, med snoozet/skippet talt separat. Observert motstykke til egenfrekvens-pyramidens handlingsdimensjon (gjort).'
	});

	const counts = await collectFollowThrough7d(userId, now);
	const result = classifyFollowThrough(counts);
	if (result.pct === null) return null;

	await upsertDomainSignal({
		signalType: 'action_follow_through_7d',
		ownerDomain: 'home',
		userId,
		valueNumber: result.pct,
		valueText: result.band,
		severity: result.severity,
		confidence: counts.plannedItems >= 5 ? 0.85 : 0.55,
		windowStart,
		windowEnd: now,
		observedAt: now,
		context: {
			plannedItems: counts.plannedItems,
			checkedItems: counts.checkedItems,
			skippedItems: counts.skippedItems,
			snoozedItems: counts.snoozedItems,
			followThroughPct: result.pct
		}
	});

	return result.pct;
}

/**
 * Proaktivitet siste 7 dager: quick wins og fokusøkter — «tar tak»-vokabularet
 * observert. Events skrives allerede men ble ikke konsumert av noe signal.
 * Null når ingen av delene finnes i vinduet.
 */
async function produceProactiveActions7d(userId: string, now: Date) {
	const windowStart = daysAgo(now, 7);

	await ensureSignalContract({
		signalType: 'proactive_actions_7d',
		ownerDomain: 'home',
		allowedConsumerDomains: ['home', 'health', 'relationship'],
		description:
			'Quick wins og fokusøkter siste 7 dager (sensor_events quick_win/focus_session). Observert proaktivitet — egenfrekvens-pyramidens «tar tak»/«fullfører noe».'
	});

	const pro = await collectProactivity7d(userId, now);
	const total = pro.quickWins + pro.focusSessions;
	if (total === 0) return null;

	await upsertDomainSignal({
		signalType: 'proactive_actions_7d',
		ownerDomain: 'home',
		userId,
		valueNumber: total,
		valueText: `${pro.quickWins} quick wins, ${pro.focusSessions} fokusøkter`,
		severity: 'info',
		confidence: 0.9,
		windowStart,
		windowEnd: now,
		observedAt: now,
		context: {
			quickWins: pro.quickWins,
			focusSessions: pro.focusSessions,
			focusMinutes: pro.focusMinutes
		}
	});

	return total;
}

/**
 * Floke-stagnasjon: hodedump-floker uten bevegelse (steg gjort/lagt til).
 * VISION («Løkker, floker og knuter»): floker som ikke løses rolig blir knuter —
 * signalet fanger dem ved ≥14 dager (stillestående) og ≥28 dager (knute-risiko).
 * Null uten åpne floker.
 */
async function produceFlokeStagnation(userId: string, now: Date) {
	await ensureSignalContract({
		signalType: 'floke_stagnation',
		ownerDomain: 'home',
		allowedConsumerDomains: ['home', 'health', 'relationship'],
		description:
			'Hodedump-floker (prosjekter med source=hodedump) uten bevegelse: ≥14 dager = stillestående, ≥28 = knute-risiko. Antall stillestående som verdi, verste floke i konteksten.'
	});

	const floker = await collectFlokeStatus(userId, now);
	if (floker.length === 0) return null;

	const stagnant = floker.filter((f) => f.stage !== 'i_bevegelse');
	const severity = classifyFlokeLoad(floker);
	const verst = [...stagnant].sort((a, b) => b.daysSinceMovement - a.daysSinceMovement)[0] ?? null;

	await upsertDomainSignal({
		signalType: 'floke_stagnation',
		ownerDomain: 'home',
		userId,
		valueNumber: stagnant.length,
		valueText: verst ? `«${verst.title}»: ${verst.daysSinceMovement} dager uten bevegelse` : 'alle i bevegelse',
		valueBool: stagnant.length === 0,
		severity,
		confidence: 0.9,
		windowStart: daysAgo(now, 30),
		windowEnd: now,
		observedAt: now,
		context: {
			flokeCount: floker.length,
			stagnantCount: stagnant.length,
			floker: floker.map((f) => ({
				title: f.title,
				status: f.status,
				daysSinceMovement: f.daysSinceMovement,
				stage: f.stage
			}))
		}
	});

	return stagnant.length;
}

/**
 * Forhøyet hvilepuls: snittpuls under søvn siste 7 netter mot baseline
 * (nettene 8–28 dager tilbake). Varsler sykdom/overtrening/søvnunderskudd.
 * Null uten nok netter med puls i begge vinduer (≥3 hver).
 */
async function produceRestingHrElevated7d(userId: string, now: Date) {
	const windowStart = daysAgo(now, 7);
	const baselineStart = daysAgo(now, 28);

	await ensureSignalContract({
		signalType: 'resting_hr_elevated_7d',
		ownerDomain: 'health',
		allowedConsumerDomains: ['health', 'home', 'relationship'],
		description:
			'Snittpuls under søvn siste 7 netter mot baseline (nettene 8–28 dager tilbake). Positiv delta = forhøyet hvilepuls (sykdom/overtrening/søvnunderskudd).'
	});

	const rows = await db.execute(sql`
		SELECT timestamp, (data->>'hr_average')::numeric AS hr
		FROM sensor_events
		WHERE user_id = ${userId}
		  AND data_type = 'sleep'
		  AND data->>'hr_average' IS NOT NULL
		  AND timestamp >= ${baselineStart}
		  AND timestamp < ${now}
	`);
	const typed = rowsOf<{ timestamp: Date | string; hr: number }>(rows)
		.map((r) => ({ ts: new Date(r.timestamp), hr: toNumber(r.hr) }))
		.filter((r) => r.hr > 0);

	const recent = typed.filter((r) => r.ts >= windowStart).map((r) => r.hr);
	const baseline = typed.filter((r) => r.ts < windowStart).map((r) => r.hr);
	if (recent.length < 3 || baseline.length < 3) return null;

	const avg = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
	const recentAvg = Math.round(avg(recent) * 10) / 10;
	const baselineAvg = Math.round(avg(baseline) * 10) / 10;
	const delta = Math.round((recentAvg - baselineAvg) * 10) / 10;
	const severity = classifyRestingHrElevation(delta);

	await upsertDomainSignal({
		signalType: 'resting_hr_elevated_7d',
		ownerDomain: 'health',
		userId,
		valueNumber: delta,
		valueText: `${recentAvg} mot baseline ${baselineAvg}`,
		valueBool: delta >= 1.5,
		severity,
		confidence: recent.length >= 5 ? 0.85 : 0.6,
		windowStart,
		windowEnd: now,
		observedAt: now,
		context: {
			recentAvg,
			baselineAvg,
			delta,
			recentNights: recent.length,
			baselineNights: baseline.length
		}
	});

	return delta;
}

/**
 * Budsjettpress per kategori: for hvert aktivt category_spend-mål framskrives
 * månedsforbruket mot taket. Over taket = high, på vei over = medium. Ett signal
 * per kategori (window_end + signalType unikt — bruker kategorien i signalType).
 * Returnerer antall mål vurdert, eller null uten category_spend-mål.
 */
async function produceCategoryBudgetPressure(userId: string, now: Date) {
	const rows = await db.execute(sql`
		SELECT title, metadata
		FROM goals
		WHERE user_id = ${userId}
		  AND status = 'active'
		  AND metadata->>'metricId' = 'category_spend'
		  AND metadata->>'spendCategory' IS NOT NULL
		  AND metadata->'goalTrack'->>'targetValue' IS NOT NULL
	`);
	const goalRows = rowsOf<{ title: string; metadata: Record<string, unknown> }>(rows);
	if (goalRows.length === 0) return null;

	const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
	const dayOfMonth = now.getDate();
	let produced = 0;

	for (const row of goalRows) {
		const meta = row.metadata as {
			spendCategory?: string;
			goalTrack?: { targetValue?: number };
		};
		const category = meta.spendCategory;
		const cap = Number(meta.goalTrack?.targetValue);
		if (!category || !Number.isFinite(cap) || cap <= 0) continue;

		const spend = await readCategorySpend(userId, category, now);
		if (!spend) continue;

		const projection = projectBudget(spend.currentMonth, cap, dayOfMonth, daysInMonth);
		const severity = classifyBudgetPressure(projection);
		const label = CATEGORIES[category as keyof typeof CATEGORIES]?.label ?? category;
		const signalType = `category_budget_pressure_${category}`;

		await ensureSignalContract({
			signalType,
			ownerDomain: 'economics',
			allowedConsumerDomains: ['economics', 'home', 'relationship'],
			description: `Framskrevet månedsforbruk (${label}) mot category_spend-tak. Over = high, på vei over = medium, nær = low.`
		});

		await upsertDomainSignal({
			signalType,
			ownerDomain: 'economics',
			userId,
			valueNumber: projection.projected,
			valueText: `${label}: ${projection.spent} av ${cap} kr hittil, ligger an til ${projection.projected}`,
			valueBool: projection.exceeded || projection.onTrackToExceed,
			severity,
			confidence: dayOfMonth >= 7 ? 0.85 : 0.5,
			windowStart: new Date(now.getFullYear(), now.getMonth(), 1),
			windowEnd: now,
			observedAt: now,
			context: {
				category,
				categoryLabel: label,
				spent: projection.spent,
				cap,
				projected: projection.projected,
				exceeded: projection.exceeded,
				onTrackToExceed: projection.onTrackToExceed,
				dayOfMonth,
				daysInMonth
			}
		});
		produced += 1;
	}

	return produced;
}

/**
 * Husarbeid-balanse siste to uker mot 50/50-idealet. Teller chore_done-events
 * per part (meg/partner). Symmetrisk severity på avstand fra 50 % — både å
 * bære for mye og for lite er verdt å vite. Null under minimum loggede oppgaver.
 */
async function produceChoreBalance14d(userId: string, now: Date) {
	const balance = await readChoreBalance(userId, 14);
	if (!balance) return null;

	await ensureSignalContract({
		signalType: 'chore_balance_14d',
		ownerDomain: 'home',
		allowedConsumerDomains: ['home', 'relationship'],
		description:
			'Fordeling av loggede husarbeids-oppgaver (chore_done) mellom bruker og partner siste 14 dager, mot 50/50-idealet. Symmetrisk severity på avstand fra 50 %.'
	});

	const myShare = Math.round(balance.myShare * 100);
	const severity = classifyChoreBalance(balance);

	await upsertDomainSignal({
		signalType: 'chore_balance_14d',
		ownerDomain: 'home',
		userId,
		valueNumber: myShare,
		valueText: `du ${myShare} %, partner ${100 - myShare} % (${balance.total} oppgaver)`,
		valueBool: severity === 'info',
		severity,
		confidence: balance.total >= 8 ? 0.85 : 0.6,
		windowStart: daysAgo(now, 14),
		windowEnd: now,
		observedAt: now,
		context: {
			myCount: balance.myCount,
			otherCount: balance.otherCount,
			total: balance.total,
			myShare: balance.myShare,
			deviation: balance.deviation
		}
	});

	return myShare;
}

/**
 * Egenfrekvens-trend siste uke mot baseline (8–28 dager). Mental-helse-signal:
 * nedgang i selvrapportert nivå hever severity (asymmetrisk), lavt absolutt
 * nivå løfter minst til medium. Null uten nok checkins.
 */
async function produceEgenfrekvensTrend7d(userId: string, now: Date) {
	const trend = await readMoodTrend(userId, now);
	if (!trend) return null;

	await ensureSignalContract({
		signalType: 'egenfrekvens_trend_7d',
		ownerDomain: 'health',
		allowedConsumerDomains: ['health', 'home', 'relationship'],
		description:
			'Trend i egenfrekvens-nivå (1–5) siste uke mot baseline (8–28 dager). Nedgang = mental-helse-varsel; asymmetrisk severity, lavt absolutt nivå løfter minst til medium.'
	});

	const severity = classifyMoodTrend(trend);

	await upsertDomainSignal({
		signalType: 'egenfrekvens_trend_7d',
		ownerDomain: 'health',
		userId,
		valueNumber: trend.recentAvg,
		valueText: `${trend.direction}: ${trend.recentAvg} mot baseline ${trend.baselineAvg}`,
		valueBool: trend.direction === 'nedgang',
		severity,
		confidence: 0.75,
		windowStart: daysAgo(now, 7),
		windowEnd: now,
		observedAt: now,
		context: {
			recentAvg: trend.recentAvg,
			baselineAvg: trend.baselineAvg,
			delta: trend.delta,
			direction: trend.direction
		}
	});

	return trend.delta;
}

export async function runDomainSignalProducers(now: Date = new Date()) {
	const allUsers = await db.select({ id: users.id, partnerUserId: users.partnerUserId }).from(users);

	let processed = 0;
	let produced = 0;
	let failed = 0;
	const producerBreakdown = {
		activityRunWeekly: 0,
		taskCompletionWeekly: 0,
		trackingSeriesWeekly: 0,
		economicsBudgetPressure7d: 0,
		economicsGrocerySpendWeekly: 0,
		homeOverdueSharedTasks7d: 0,
		homePlanningReliability14d: 0,
		routineAdherence7d: 0,
		eveningScreenWork7d: 0,
		healthEffortVsThreshold: 0,
		trainingBalance: 0,
		nutritionProteinVsLoad: 0,
		relationshipCoordinationReadinessToday: 0,
		relationshipLogisticsStressIndex14d: 0,
		familyBirthdayUpcoming7d: 0,
		familyRelationNeglect30d: 0,
		familyParentTimeLow7d: 0,
		sleepPowernaps7d: 0,
		actionFollowThrough7d: 0,
		proactiveActions7d: 0,
		flokeStagnation: 0,
		restingHrElevated7d: 0,
		categoryBudgetPressure: 0,
		choreBalance14d: 0,
		egenfrekvensTrend7d: 0
	};
	const errors: Array<{ userId: string; error: string }> = [];

	for (const user of allUsers) {
		processed += 1;
		try {
			const runWeekly = await produceActivityRunPrWeekSignal(user.id, now);
			if (runWeekly) {
				produced += 1;
				producerBreakdown.activityRunWeekly += 1;
			}

			const taskWeekly = await produceTaskCompletionWeeklySignal(user.id, now);
			if (taskWeekly) {
				produced += 1;
				producerBreakdown.taskCompletionWeekly += 1;
			}

			const trackingWeekly = await produceTrackingSeriesActivityPrWeekSignal(user.id, now);
			if (trackingWeekly) {
				produced += trackingWeekly.produced;
				producerBreakdown.trackingSeriesWeekly += trackingWeekly.produced;
			}

			const budgetPressureSeverity = await produceEconomicsBudgetPressure7d(user.id, now);
			produced += 1;
			producerBreakdown.economicsBudgetPressure7d += 1;

			await produceEconomicsGrocerySpendWeekly(user.id, now);
			produced += 1;
			producerBreakdown.economicsGrocerySpendWeekly += 1;

			const overdueCount7d = await produceHomeOverdueSharedTasks7d(user.id, now);
			produced += 1;
			producerBreakdown.homeOverdueSharedTasks7d += 1;

			const planningReliability14d = await produceHomePlanningReliability14d(user.id, now);
			produced += 1;
			producerBreakdown.homePlanningReliability14d += 1;

			const routineAdherence7d = await produceRoutineAdherence7d(user.id, now);
			if (routineAdherence7d !== null) {
				produced += 1;
				producerBreakdown.routineAdherence7d += 1;
			}

			const eveningScreenWork7d = await produceEveningScreenWork7d(user.id, now);
			if (eveningScreenWork7d !== null) {
				produced += 1;
				producerBreakdown.eveningScreenWork7d += 1;
			}

			const sleepPowernaps7d = await produceSleepPowernaps7d(user.id, now);
			if (sleepPowernaps7d !== null) {
				produced += 1;
				producerBreakdown.sleepPowernaps7d += 1;
			}

			const actionFollowThrough7d = await produceActionFollowThrough7d(user.id, now);
			if (actionFollowThrough7d !== null) {
				produced += 1;
				producerBreakdown.actionFollowThrough7d += 1;
			}

			const proactiveActions7d = await produceProactiveActions7d(user.id, now);
			if (proactiveActions7d !== null) {
				produced += 1;
				producerBreakdown.proactiveActions7d += 1;
			}

			const flokeStagnation = await produceFlokeStagnation(user.id, now);
			if (flokeStagnation !== null) {
				produced += 1;
				producerBreakdown.flokeStagnation += 1;
			}

			const restingHrElevated7d = await produceRestingHrElevated7d(user.id, now);
			if (restingHrElevated7d !== null) {
				produced += 1;
				producerBreakdown.restingHrElevated7d += 1;
			}

			const categoryBudgetPressure = await produceCategoryBudgetPressure(user.id, now);
			if (categoryBudgetPressure !== null) {
				produced += categoryBudgetPressure;
				producerBreakdown.categoryBudgetPressure += categoryBudgetPressure;
			}

			const choreBalance14d = await produceChoreBalance14d(user.id, now);
			if (choreBalance14d !== null) {
				produced += 1;
				producerBreakdown.choreBalance14d += 1;
			}

			const egenfrekvensTrend7d = await produceEgenfrekvensTrend7d(user.id, now);
			if (egenfrekvensTrend7d !== null) {
				produced += 1;
				producerBreakdown.egenfrekvensTrend7d += 1;
			}

			const effortVsThreshold = await produceHealthEffortVsThreshold(user.id, now);
			if (effortVsThreshold !== null) {
				produced += 1;
				producerBreakdown.healthEffortVsThreshold += 1;
			}

			const trainingBalance = await produceTrainingBalance(user.id, now);
			if (trainingBalance !== null) {
				produced += 1;
				producerBreakdown.trainingBalance += 1;
			}

			const proteinVsLoad = await produceProteinVsLoad(user.id, now);
			if (proteinVsLoad !== null) {
				produced += 1;
				producerBreakdown.nutritionProteinVsLoad += 1;
			}

			if (user.partnerUserId) {
				await produceRelationshipCoordinationReadinessToday(user.id, user.partnerUserId, now);
				produced += 1;
				producerBreakdown.relationshipCoordinationReadinessToday += 1;
				await produceRelationshipLogisticsStressIndex14d(user.id, user.partnerUserId, now, {
					budgetPressureSeverity,
					overdueCount7d,
					planningReliability14d
				});
				produced += 1;
				producerBreakdown.relationshipLogisticsStressIndex14d += 1;
			}

			try {
				await produceFamilyBirthdayUpcoming7d(user.id, now);
				producerBreakdown.familyBirthdayUpcoming7d += 1;
				await produceFamilyRelationNeglect30d(user.id, now);
				producerBreakdown.familyRelationNeglect30d += 1;
				await produceFamilyParentTimeLow7d(user.id, now);
				producerBreakdown.familyParentTimeLow7d += 1;
				produced += 3;
			} catch (familyErr) {
				console.warn('family signal producer failed:', familyErr);
			}
		} catch (error) {
			failed += 1;
			errors.push({
				userId: user.id,
				error: error instanceof Error ? error.message : String(error)
			});
		}
	}

	return {
		timestamp: now.toISOString(),
		processedUsers: processed,
		producedSignals: produced,
		producerBreakdown,
		failedUsers: failed,
		errors
	};
}

export async function getDomainSignalObservability(signalType: string, hours = 24 * 7) {
	const safeHours = Math.max(1, Math.min(hours, 24 * 90));

	const summaryRows = await pgClient.unsafe<{
		total: number;
		users: number;
		truthy: number;
		falsy: number;
		avg_value_number: number | null;
	}[]>(`
		SELECT
			COUNT(*)::int AS total,
			COUNT(DISTINCT user_id)::int AS users,
			COUNT(*) FILTER (WHERE value_bool IS TRUE)::int AS truthy,
			COUNT(*) FILTER (WHERE value_bool IS FALSE)::int AS falsy,
			AVG(value_number)::float8 AS avg_value_number
		FROM domain_signals
		WHERE signal_type = $2
		  AND observed_at >= NOW() - ($1::int * INTERVAL '1 hour')
	`, [safeHours, signalType]);

	const severityRows = await pgClient.unsafe<{
		severity: string;
		count: number;
	}[]>(`
		SELECT
			severity,
			COUNT(*)::int AS count
		FROM domain_signals
		WHERE signal_type = $2
		  AND observed_at >= NOW() - ($1::int * INTERVAL '1 hour')
		GROUP BY severity
		ORDER BY count DESC
	`, [safeHours, signalType]);

	const latestRows = await pgClient.unsafe<{
		latest_observed_at: string | null;
	}[]>(`
		SELECT
			MAX(observed_at)::text AS latest_observed_at
		FROM domain_signals
		WHERE signal_type = $2
		  AND observed_at >= NOW() - ($1::int * INTERVAL '1 hour')
	`, [safeHours, signalType]);

	const summary = summaryRows[0] ?? {
		total: 0,
		users: 0,
		truthy: 0,
		falsy: 0,
		avg_value_number: null
	};

	return {
		signalType,
		hours: safeHours,
		total: Number(summary.total ?? 0),
		users: Number(summary.users ?? 0),
		outcomes: {
			truthy: Number(summary.truthy ?? 0),
			falsy: Number(summary.falsy ?? 0)
		},
		avgValueNumber:
			typeof summary.avg_value_number === 'number' && Number.isFinite(summary.avg_value_number)
				? Number(summary.avg_value_number.toFixed(2))
				: null,
		severity: severityRows.map((row) => ({
			severity: row.severity,
			count: Number(row.count ?? 0)
		})),
		latestObservedAt: latestRows[0]?.latest_observed_at ?? null
	};
}

export class SignalService {
	static async runProducers(now: Date = new Date()) {
		return runDomainSignalProducers(now);
	}

	static async getObservability(signalType: string, hours = 24 * 7) {
		return getDomainSignalObservability(signalType, hours);
	}
}