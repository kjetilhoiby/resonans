import { sql } from 'drizzle-orm';
import { db, pgClient } from '$lib/db';
import { users } from '$lib/db/schema';

type Severity = 'info' | 'low' | 'medium' | 'high';

type UpsertDomainSignalInput = {
	signalType: string;
	ownerDomain: 'health' | 'economics' | 'home' | 'relationship';
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
			${input.allowedConsumerDomains},
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

	const runCountRows = await db.execute(sql`
		SELECT COUNT(*)::int AS value
		FROM sensor_events
		WHERE user_id = ${userId}
		  AND data_type = 'workout'
		  AND timestamp >= ${windowStart}
		  AND timestamp < ${now}
		  AND LOWER(COALESCE(data->>'sportType', '')) LIKE '%running%'
	`);
	const runCount = toNumber((runCountRows as unknown as Array<{ value: number }>)[0]?.value);

	const goalRows = await db.execute(sql`
		SELECT id, metadata
		FROM goals
		WHERE user_id = ${userId}
		  AND status = 'active'
		  AND COALESCE(metadata->>'intentStatus', '') = 'parsed'
		  AND COALESCE(metadata->'parsedIntent'->>'signalType', '') = 'activity_run_pr_week'
		  AND COALESCE(metadata->'parsedIntent'->>'period', '') = 'week'
	`);

	const typedGoals = goalRows as unknown as Array<{
		id: string;
		metadata: Record<string, unknown> | null;
	}>;

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

	const tasksWeekly = rows as unknown as Array<{
		id: string;
		target_value: number;
		current_value: number;
	}>;

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

	const spend7d = toNumber((spend7dRows as unknown as Array<{ value: number }>)[0]?.value);
	const baseline30d = toNumber((baselineRows as unknown as Array<{ value: number }>)[0]?.value);
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

	const overdueCount = toNumber((rows as unknown as Array<{ value: number }>)[0]?.value);
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

	const typedRows = rows as unknown as Array<{ id: string; item_count: number; unchecked_count: number }>;
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

	const score = toNumber((rows as unknown as Array<{ score: number }>)[0]?.score);
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

	const typedGoals = goalRows as unknown as Array<{
		id: string;
		metadata: Record<string, unknown> | null;
	}>;

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
		const count = toNumber((countRows as unknown as Array<{ value: number }>)[0]?.value);

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

		// Also stamp intentEvaluation onto all active weekly tasks for this goal
		// so ukeplan can render the evaluation badge from task.metadata
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
		homeOverdueSharedTasks7d: 0,
		homePlanningReliability14d: 0,
		relationshipCoordinationReadinessToday: 0,
		relationshipLogisticsStressIndex14d: 0
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

			const overdueCount7d = await produceHomeOverdueSharedTasks7d(user.id, now);
			produced += 1;
			producerBreakdown.homeOverdueSharedTasks7d += 1;

			const planningReliability14d = await produceHomePlanningReliability14d(user.id, now);
			produced += 1;
			producerBreakdown.homePlanningReliability14d += 1;

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
