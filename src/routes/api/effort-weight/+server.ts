import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildEffortWeightInputs } from '$lib/server/health/effort-weight-data';
import {
	buildWeeklyPairs,
	fitEffortWeightModel,
	predictDeltaKg
} from '$lib/util/effort-weight-model';

/**
 * Effort→vekt-detaljdata: ukespar (ukeseffort, vektendring), fittet modell og
 * nå-tilstand (rullende 7-dagers effort mot terskelen). Data hentes direkte
 * fra sensor_events/canonical_workouts (se effort-weight-data.ts) og fittes
 * live — billig.
 *
 * NB: ruten ligger bevisst UTENFOR /api/health/* — det prefikset er offentlig
 * i hooks.server.ts og får aldri locals.userId satt.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const userId = locals.userId;
	if (!userId) {
		return json({ error: 'Ikke autentisert' }, { status: 401 });
	}

	const weeksParam = Number(url.searchParams.get('weeks'));
	const weeksBack = Number.isFinite(weeksParam) && weeksParam >= 8 && weeksParam <= 104 ? weeksParam : 26;

	const { weeks: inputs, rolling7dEffort } = await buildEffortWeightInputs(userId, weeksBack);

	const pairs = buildWeeklyPairs(inputs);
	const model = fitEffortWeightModel(pairs);

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
