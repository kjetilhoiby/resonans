/**
 * GET /api/widget-data/[id]
 *
 * Beregner live data for ett widget basert på konfig fra DB.
 * Returnerer:
 * {
 *   current: number | null     — siste verdi (etter aggregering)
 *   sparkline: number[]        — [eldst→nyest], maks 8 punkter
 *   unit: string
 *   delta: number              — endring vs forrige periode
 *   pct: number | null         — 0–100 hvis goal er satt
 * }
 */
import { json, error } from '@sveltejs/kit';
import { db, pgClient } from '$lib/db';
import { userWidgets } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { getKeywordsForCategory } from '$lib/server/integrations/transaction-categories';
import type { RequestHandler } from './$types';

// Støttede metrikk-typer og hvilken dataType/felt de henter fra
// bucketAggregation: overstyrer aggregering innad i hver tidsbøtte (brukes for data med duplikater/kumulative totaler)
// outerAggregation: overstyrer aggregering over bøttene i fetchSingleValue (uavhengig av widget.aggregation)
const METRIC_CONFIG: Record<string, { dataType: string; field: string; countStar?: boolean; bucketAggregation?: string; outerAggregation?: string }> = {
	weight:        { dataType: 'weight',           field: "data->>'weight'" },
	sleepDuration: { dataType: 'sleep',             field: "(data->>'sleepDuration')::numeric / 60" },  // minutter → timer
	// Withings sender kumulative dagstotaler + duplikater ved re-sync → MAX per dag, AVG over dager = riktig snitt
	steps:         { dataType: 'activity',          field: "data->>'steps'", bucketAggregation: 'MAX', outerAggregation: 'AVG' },
	distance:      { dataType: 'workout',           field: "data->>'distance'" },
	workoutCount:  { dataType: 'workout',           field: '1', countStar: true },
	heartrate:     { dataType: 'heart_rate',        field: "data->>'hr_average'" },
	mood:          { dataType: 'mood',              field: "data->>'rating'" },
	screenTime:    { dataType: 'screen_time',       field: "data->>'totalMinutes'" },
	amount:        { dataType: 'bank_transaction',  field: "ABS((data->>'amount')::numeric)" },
};

function getRangeDate(range: string): { from: Date; to: Date } {
	const now = new Date();
	const to = new Date(now);

	switch (range) {
		case 'last7': {
			const from = new Date(now);
			from.setDate(from.getDate() - 7);
			return { from, to };
		}
		case 'last14': {
			const from = new Date(now);
			from.setDate(from.getDate() - 14);
			return { from, to };
		}
		case 'last30': {
			const from = new Date(now);
			from.setDate(from.getDate() - 30);
			return { from, to };
		}
		case 'current_week': {
			const from = new Date(now);
			const day = from.getDay() || 7;
			from.setDate(from.getDate() - day + 1);
			from.setHours(0, 0, 0, 0);
			return { from, to };
		}
		case 'current_month': {
			const from = new Date(now.getFullYear(), now.getMonth(), 1);
			return { from, to };
		}
		case 'current_year': {
			const from = new Date(now.getFullYear(), 0, 1);
			return { from, to };
		}
		default: {
			const from = new Date(now);
			from.setDate(from.getDate() - 7);
			return { from, to };
		}
	}
}

/** Returnerer start på forrige periode av samme lengde (for delta-beregning) */
function getPreviousRange(range: string): { from: Date; to: Date } {
	const current = getRangeDate(range);
	const durationMs = current.to.getTime() - current.from.getTime();
	return {
		from: new Date(current.from.getTime() - durationMs),
		to: current.from,
	};
}

/**
 * Builds a SQL WHERE clause fragment that filters bank_transaction rows
 * to only the given spending category using keyword matching on description.
 * Returns '' (empty string) when no filter applies.
 */
function buildCategoryFilter(dataType: string, filterCategory?: string | null): string {
	if (dataType !== 'bank_transaction' || !filterCategory) return '';
	const keywords = getKeywordsForCategory(filterCategory);
	if (!keywords || keywords.length === 0) return '';
	// Build ILIKE ANY(ARRAY[...]) — safe because keywords come from a static config file
	const escaped = keywords.map((k) => `'%${k.replace(/'/g, "''")}%'`).join(', ');
	return `AND (data->>'description') ILIKE ANY(ARRAY[${escaped}])`;
}

/** Henter tidsseriedata gruppert per periode */
async function fetchTimeSeries(
	userId: string,
	metricConf: { dataType: string; field: string; countStar?: boolean; bucketAggregation?: string },
	aggregation: string,
	period: string,
	from: Date,
	to: Date,
	filterCategory?: string | null,
): Promise<{ bucket: string; value: number }[]> {
	const pgTrunc = period === 'day' ? 'day' : period === 'week' ? 'week' : 'month';
	// bucketAggregation overstyrer brukerens aggregation-valg for data som trenger spesiell håndtering (f.eks. skrittduplisering)
	const userAggFn = aggregation === 'sum' ? 'SUM' : aggregation === 'count' ? 'COUNT' : aggregation === 'latest' ? 'MAX' : 'AVG';
	const aggFn = metricConf.bucketAggregation ?? userAggFn;
	const valueExpr = metricConf.countStar ? 'COUNT(*)' : `${aggFn}((${metricConf.field})::numeric)`;
	const nullCheck = metricConf.countStar ? '' : `AND (${metricConf.field})::numeric IS NOT NULL`;
	const amountFilter = metricConf.dataType === 'bank_transaction' ? `AND (data->>'amount')::numeric < 0` : '';
	const categoryFilter = buildCategoryFilter(metricConf.dataType, filterCategory);

	const query = `
		SELECT date_trunc('${pgTrunc}', timestamp)::text AS bucket, ${valueExpr} AS value
		FROM sensor_events
		WHERE user_id = $1
		  AND data_type = $2
		  AND timestamp >= $3
		  AND timestamp <= $4
		  ${nullCheck}
		  ${amountFilter}
		  ${categoryFilter}
		GROUP BY 1
		ORDER BY 1 ASC
	`;

	const rows = await pgClient.unsafe(query, [userId, metricConf.dataType, from.toISOString(), to.toISOString()]);
	return (rows as unknown as { bucket: string; value: string }[]).map((r) => ({
		bucket: r.bucket,
		value: parseFloat(r.value) || 0,
	}));
}

/** Aggregerer hele perioden til én enkelt verdi */
async function fetchSingleValue(
	userId: string,
	metricConf: { dataType: string; field: string; countStar?: boolean; bucketAggregation?: string; outerAggregation?: string },
	aggregation: string,
	from: Date,
	to: Date,
	filterCategory?: string | null,
): Promise<number | null> {
	const userAggFn = aggregation === 'sum' ? 'SUM' : aggregation === 'count' ? 'COUNT' : aggregation === 'latest' ? 'MAX' : 'AVG';
	const nullCheck = metricConf.countStar ? '' : `AND (${metricConf.field})::numeric IS NOT NULL`;
	const amountFilter = metricConf.dataType === 'bank_transaction' ? `AND (data->>'amount')::numeric < 0` : '';
	const categoryFilter = buildCategoryFilter(metricConf.dataType, filterCategory);

	let query: string;
	if (metricConf.bucketAggregation && !metricConf.countStar) {
		// For metrics med bucketAggregation (f.eks. steps): aggreger per dag først, deretter over dagene
		// outerAggregation overstyrer widget.aggregation (steps skal alltid vises som daglig snitt, ikke sum)
		const outerAggFn = metricConf.outerAggregation ?? userAggFn;
		query = `
			SELECT ${outerAggFn}(daily_val) AS value
			FROM (
				SELECT ${metricConf.bucketAggregation}((${metricConf.field})::numeric) AS daily_val
				FROM sensor_events
				WHERE user_id = $1
				  AND data_type = $2
				  AND timestamp >= $3
				  AND timestamp <= $4
				  ${nullCheck}
				  ${amountFilter}
				  ${categoryFilter}
				GROUP BY date_trunc('day', timestamp)
			) t
		`;
	} else {
		const valueExpr = metricConf.countStar ? 'COUNT(*)' : `${userAggFn}((${metricConf.field})::numeric)`;
		query = `
			SELECT ${valueExpr} AS value
			FROM sensor_events
			WHERE user_id = $1
			  AND data_type = $2
			  AND timestamp >= $3
			  AND timestamp <= $4
			  ${nullCheck}
			  ${amountFilter}
			  ${categoryFilter}
		`;
	}

	const rows = await pgClient.unsafe(query, [userId, metricConf.dataType, from.toISOString(), to.toISOString()]);
	const val = rows[0]?.value;
	return val !== null && val !== undefined ? parseFloat(val) : null;
}

function roundVal(v: number | null, metric: string): number | null {
	if (v === null) return null;
	// Søvn i timer → 1 desimal, vekt → 1 desimal, resten heltall
	if (metric === 'sleepDuration' || metric === 'weight') return Math.round(v * 10) / 10;
	if (metric === 'distance') return Math.round(v / 1000 * 10) / 10; // meter → km
	return Math.round(v);
}

/**
 * Beregner visuell state basert på terskler.
 * Retning utledes automatisk: successNum > warnNum = høyere er bedre (skritt, søvn)
 *                             successNum < warnNum = lavere er bedre (vekt, forbruk)
 */
function computeState(
	current: number | null,
	warnNum: number | null,
	successNum: number | null,
): 'success' | 'warn' | 'normal' {
	if (current === null) return 'normal';
	if (successNum !== null && warnNum !== null) {
		const higherIsBetter = successNum > warnNum;
		if (higherIsBetter) {
			if (current >= successNum) return 'success';
			if (current < warnNum) return 'warn';
		} else {
			if (current <= successNum) return 'success';
			if (current > warnNum) return 'warn';
		}
	} else if (successNum !== null) {
		if (current >= successNum) return 'success';
	} else if (warnNum !== null) {
		if (current < warnNum) return 'warn';
	}
	return 'normal';
}

export const GET: RequestHandler = async ({ params, locals }) => {
	const widgetId = params.id;
	const userId = locals.userId;

	const widget = await db.query.userWidgets.findFirst({
		where: and(
			eq(userWidgets.id, widgetId),
			eq(userWidgets.userId, userId)
		)
	});

	if (!widget) throw error(404, 'Widget ikke funnet');

	const metricConf = METRIC_CONFIG[widget.metricType];
	if (!metricConf) throw error(400, `Ukjent metrikk-type: ${widget.metricType}`);

	const { from, to } = getRangeDate(widget.range);
	const prev = getPreviousRange(widget.range);

	// Hent tidsserie (for sparkline), periodeaggregat (for current) og forrige periode (for delta) i parallell
	const filterCategory = widget.filterCategory ?? null;
	const [series, currentValue, prevValue] = await Promise.all([
		fetchTimeSeries(userId, metricConf, widget.aggregation, widget.period, from, to, filterCategory),
		// For avg/sum: bruk periodeaggregat som current (mer representativt enn kun siste dag)
		// For latest: siste bøtteverdi er riktigst (peker på nyeste måling)
		widget.aggregation !== 'latest'
			? fetchSingleValue(userId, metricConf, widget.aggregation, from, to, filterCategory)
			: Promise.resolve(null),
		fetchSingleValue(userId, metricConf, widget.aggregation, prev.from, prev.to, filterCategory),
	]);

	const sparkline = series.map((r) => roundVal(r.value, widget.metricType) ?? 0);
	// current: periodeaggregat for avg/sum, siste sparkline-punkt for latest
	const rawCurrent = widget.aggregation === 'latest'
		? (series.at(-1)?.value ?? null)
		: currentValue;
	const current = roundVal(rawCurrent, widget.metricType);
	const prev_ = roundVal(prevValue, widget.metricType);
	const delta = current !== null && prev_ !== null ? Math.round((current - prev_) * 10) / 10 : 0;

	const goalNum = widget.goal ? parseFloat(String(widget.goal)) : null;
	const warnNum = widget.thresholdWarn ? parseFloat(String(widget.thresholdWarn)) : null;
	const successNum = widget.thresholdSuccess ? parseFloat(String(widget.thresholdSuccess)) : null;

	let pct: number | null = null;
	if (current !== null && goalNum !== null && goalNum > 0) {
		// For vekt: lavere er bedre → inverter
		if (widget.metricType === 'weight') {
			pct = Math.max(0, Math.min(100, Math.round((1 - (current - goalNum) / goalNum) * 100)));
		} else {
			pct = Math.max(0, Math.min(100, Math.round((current / goalNum) * 100)));
		}
	}

	return json({ current, sparkline, unit: widget.unit, delta, pct, state: computeState(current, warnNum, successNum) });
};
