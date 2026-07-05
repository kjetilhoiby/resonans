import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sql } from 'drizzle-orm';
import { db, rowsOf } from '$lib/db';
import {
	buildWeeklyPairs,
	fitEffortWeightModel,
	predictDeltaKg,
	type WeeklyEffortWeightInput
} from '$lib/util/effort-weight-model';

/**
 * Effort→vekt-detaljdata: ukespar (ukeseffort, vektendring), fittet modell og
 * nå-tilstand (rullende 7-dagers effort mot terskelen). Fitter live — billig
 * (~30 aggregat-rader).
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const userId = locals.userId;
	if (!userId) {
		return json({ error: 'Ikke autentisert' }, { status: 401 });
	}

	const weeksParam = Number(url.searchParams.get('weeks'));
	const weeksBack = Number.isFinite(weeksParam) && weeksParam >= 8 && weeksParam <= 104 ? weeksParam : 26;
	const now = new Date();
	const windowStart = new Date(now.getTime() - weeksBack * 7 * 24 * 3600_000);

	const weekRows = await db.execute(sql`
		SELECT period_key, metrics
		FROM sensor_aggregates
		WHERE user_id = ${userId}
		  AND period = 'week'
		  AND start_date >= ${windowStart}
		  AND start_date <= ${now}
		ORDER BY start_date ASC
	`);
	const weekAggregates = rowsOf<{ period_key: string; metrics: Record<string, unknown> | null }>(weekRows);

	const inputs: WeeklyEffortWeightInput[] = weekAggregates.map((row) => {
		const metrics = (row.metrics ?? {}) as Record<string, unknown>;
		const weight = (metrics.weight ?? {}) as Record<string, unknown>;
		const weeklyEffort = (metrics.weeklyEffort ?? {}) as Record<string, unknown>;
		const values = Array.isArray(weight.values) ? weight.values : [];
		const effortTotal = typeof weeklyEffort.total === 'number' ? weeklyEffort.total : 0;
		return {
			weekKey: row.period_key,
			weightAvg: typeof weight.avg === 'number' ? weight.avg : null,
			weighInCount: values.length,
			effort: effortTotal
		};
	});

	const pairs = buildWeeklyPairs(inputs);
	const model = fitEffortWeightModel(pairs);

	const dayRows = await db.execute(sql`
		SELECT metrics
		FROM sensor_aggregates
		WHERE user_id = ${userId}
		  AND period = 'day'
		  AND start_date >= ${new Date(now.getTime() - 7 * 24 * 3600_000)}
		  AND start_date <= ${now}
	`);
	const rolling7dEffort = Math.round(
		rowsOf<{ metrics: Record<string, unknown> | null }>(dayRows).reduce((sum, row) => {
			const daily = ((row.metrics ?? {}) as Record<string, unknown>).dailyEffort as
				| Record<string, unknown>
				| undefined;
			const total = daily && typeof daily.total === 'number' ? daily.total : 0;
			return sum + total;
		}, 0)
	);

	const deltaByWeek = new Map(pairs.map((p) => [p.weekKey, p.weightDeltaKg]));
	const weeks = inputs.map((w) => ({
		weekKey: w.weekKey,
		effort: Math.round(w.effort),
		weightAvg: w.weightAvg != null ? Math.round(w.weightAvg * 10) / 10 : null,
		deltaKg: deltaByWeek.get(w.weekKey) ?? null,
		weighInCount: w.weighInCount
	}));

	const threshold = model.thresholdEffort;
	const hasThreshold = threshold != null && threshold > 0;
	const ratio = hasThreshold ? Math.round((rolling7dEffort / threshold) * 100) / 100 : null;

	return json({
		weeks,
		model: {
			slope: model.slope,
			intercept: model.intercept,
			r: model.r,
			nWeeks: model.nWeeks,
			quality: model.quality,
			thresholdEffort: model.thresholdEffort,
			extrapolated: model.extrapolated
		},
		current: {
			rolling7dEffort,
			ratio,
			pctVsThreshold: ratio != null ? Math.round((ratio - 1) * 100) : null,
			predictedWeeklyDeltaKg: predictDeltaKg(model, rolling7dEffort)
		}
	});
};
