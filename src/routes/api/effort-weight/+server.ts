import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildEffortWeightInputs, EFFORT_WEIGHT_MAX_WEEKS } from '$lib/server/health/effort-weight-data';
import { fitBestEffortWeightModel, predictDeltaKg } from '$lib/util/effort-weight-model';

/**
 * Effort→vekt-detaljdata: ukespar (snitt-effort over modellens vindu,
 * vektendring), fittet modell og nå-tilstand. Modellen prøver flere
 * trailing-vinduer (kumulativ/lag-effekt) og velger det med sterkest
 * korrelasjon. Data hentes direkte fra sensor_events/canonical_workouts
 * (se effort-weight-data.ts) og fittes live.
 *
 * NB: ruten ligger bevisst UTENFOR /api/health/* — det prefikset er offentlig
 * i hooks.server.ts og får aldri locals.userId satt.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const userId = locals.userId;
	if (!userId) {
		return json({ error: 'Ikke autentisert' }, { status: 401 });
	}

	// Default: hele historikken (opp mot 10 år)
	const weeksParam = Number(url.searchParams.get('weeks'));
	const weeksBack =
		Number.isFinite(weeksParam) && weeksParam >= 8 && weeksParam <= EFFORT_WEIGHT_MAX_WEEKS
			? weeksParam
			: EFFORT_WEIGHT_MAX_WEEKS;

	const { weeks: inputs, rolling7dEffort } = await buildEffortWeightInputs(userId, weeksBack);

	const { model, windowWeeks, pairs, bins, binThreshold, effectiveThreshold, thresholdSource } =
		fitBestEffortWeightModel(inputs);

	// Scatter viser modellens x (snitt over vinduet) så punkter og linje hører sammen
	const rawByWeek = new Map(inputs.map((w) => [w.weekKey, w]));
	const weeks = pairs.map((p) => {
		const raw = rawByWeek.get(p.weekKey);
		return {
			weekKey: p.weekKey,
			effort: Math.round(p.effort),
			rawEffort: raw ? Math.round(raw.effort) : null,
			weightAvg: raw?.weightAvg != null ? Math.round(raw.weightAvg * 10) / 10 : null,
			deltaKg: p.weightDeltaKg,
			weighInCount: raw?.weighInCount ?? 0
		};
	});

	// Nå-tilstand måles i samme enhet som modellens x: snitt-effort siste L uker
	const lastWindow = inputs.slice(-windowWeeks);
	const currentEffortAvg =
		lastWindow.length > 0
			? Math.round(lastWindow.reduce((sum, w) => sum + w.effort, 0) / lastWindow.length)
			: 0;

	const hasThreshold = effectiveThreshold != null && effectiveThreshold > 0;
	const ratio = hasThreshold ? Math.round((currentEffortAvg / effectiveThreshold) * 100) / 100 : null;

	// Prediksjon: OLS-linjen når regresjonen er kilden; ved bins-kilde er det
	// ærligste estimatet topp-binnets snitt (gjelder når man ligger over terskelen).
	const predictedWeeklyDeltaKg =
		thresholdSource === 'regresjon'
			? predictDeltaKg(model, currentEffortAvg)
			: thresholdSource === 'bins' && binThreshold != null && currentEffortAvg >= (effectiveThreshold ?? Infinity)
				? binThreshold.topBinMeanDeltaKg
				: null;

	return json({
		weeks,
		bins,
		model: {
			slope: model.slope,
			intercept: model.intercept,
			r: model.r,
			nWeeks: model.nWeeks,
			quality: model.quality,
			thresholdEffort: model.thresholdEffort,
			binThreshold,
			effectiveThreshold,
			thresholdSource,
			extrapolated: model.extrapolated,
			windowWeeks
		},
		current: {
			currentEffortAvg,
			rolling7dEffort,
			ratio,
			pctVsThreshold: ratio != null ? Math.round((ratio - 1) * 100) : null,
			predictedWeeklyDeltaKg
		}
	});
};
