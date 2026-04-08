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
import { ensureCategorizedEventsForRange } from '$lib/server/integrations/categorized-events';
import { loadTransactionMatchingRules } from '$lib/server/classification-overrides';
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
function buildCategoryFilter(dataType: string, filterCategory?: string | null, rules?: import('$lib/server/classification-overrides').TransactionMatchingRule[]): string {
	if (dataType !== 'bank_transaction' || !filterCategory) return '';
	if (!rules || rules.length === 0) return '';
	const normalized = normalizeCategoryId(filterCategory);
	const keywords = rules
		.filter((r) => normalizeCategoryId(r.category) === normalized)
		.flatMap((r) => r.keywords);
	if (keywords.length === 0) return '';
	// Build ILIKE ANY(ARRAY[...]) — safe because keywords come from DB rules (no user input)
	const escaped = keywords.map((k) => `'%${k.replace(/'/g, "''")}%'`).join(', ');
	return `AND (data->>'description') ILIKE ANY(ARRAY[${escaped}])`;
}

function getKeywordsForCategory(filterCategory: string): string[] {
	const key = normalizeCategoryId(filterCategory);
	if (!key) return [];

	const CATEGORY_KEYWORDS: Record<string, string[]> = {
		dagligvarer: ['rema', 'kiwi', 'meny', 'coop', 'spar', 'joker', 'bunnpris', 'matbutikk', 'dagligvarer'],
		kafe_og_restaurant: ['restaurant', 'cafe', 'kafe', 'espresso', 'bar', 'take away', 'foodora', 'wolt', 'justeat'],
		bil_og_transport: ['bompenger', 'bom', 'drivstoff', 'shell', 'circle k', 'st1', 'uno-x', 'parkering', 'ruter', 'vy', 'taxi'],
		reise: ['fly', 'sas', 'norwegian', 'hotell', 'airbnb', 'booking', 'reise'],
		faste_boutgifter: ['husleie', 'felleskost', 'strom', 'strøm', 'internett', 'mobil', 'telenor', 'telia', 'fjordkraft'],
		helse_og_velvaere: ['apotek', 'vitusapotek', 'boots', 'lege', 'tannlege', 'helse', 'fysioterapi', 'sats', 'fresh fitness'],
		medier_og_underholdning: ['spotify', 'netflix', 'hbo', 'viaplay', 'youtube', 'apple.com/bill', 'google play', 'steam'],
		hobby_og_fritid: ['kino', 'ticketmaster', 'sport', 'fritid', 'hobby', 'xxl', 'inter sport'],
		hjem_og_hage: ['ikea', 'byggmakker', 'obs bygg', 'jula', 'clas ohlson', 'plantasjen'],
		klaer_og_utstyr: ['zalando', 'hm', 'h&m', 'cubus', 'bik bok', 'dressmann', 'nike', 'adidas'],
		barn: ['barn', 'babyshop', 'lekia', 'br leker'],
		barnehage_og_sfo: ['barnehage', 'sfo'],
		forsikring: ['forsikring', 'gjensidige', 'if skadeforsikring', 'tryg'],
		bilforsikring_og_billan: ['billan', 'billån', 'bilforsikring', 'toyota finans'],
		sparing: ['sparing', 'aksje', 'fond', 'nordnet', 'dnb markets'],
		diverse: ['vipps', 'overforing', 'overføring', 'gebyr', 'renter', 'bank'],
		innskudd: ['lonn', 'lønn', 'utbetaling', 'refund', 'innskudd']
	};

	return CATEGORY_KEYWORDS[key] ?? [];
}

function normalizeCategoryId(categoryId: string | null | undefined): string | null {
	if (!categoryId) return null;
	const normalized = categoryId
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.trim();

	return normalized;
}

type AmountFilterDebug = {
	filterCategory: string;
	filterCategoryNormalized: string | null;
	totalSpendTxCountInRange: number;
	categorizedMatchCount: number;
	keywordMatchCount: number;
	projectionCoveragePct: number;
	topClassifiedCategories: Array<{ category: string; count: number }>;
	sampleMatches: Array<{ date: string; description: string; amount: number }>;
};

async function fetchKeywordFilteredAmountRows(
	userId: string,
	from: Date,
	to: Date,
	filterCategory: string,
	rules?: import('$lib/server/classification-overrides').TransactionMatchingRule[],
): Promise<Array<{ timestamp: Date; value: number }>> {
	const loadedRules = rules ?? await loadTransactionMatchingRules();
	const categoryFilter = buildCategoryFilter('bank_transaction', filterCategory, loadedRules);
	if (!categoryFilter) return [];

	const rows = await pgClient.unsafe(
		`
		SELECT
			timestamp,
			ABS((data->>'amount')::numeric) AS value
		FROM sensor_events
		WHERE user_id = $1
		  AND data_type = 'bank_transaction'
		  AND timestamp >= $2
		  AND timestamp <= $3
		  AND (data->>'amount')::numeric < 0
		  ${categoryFilter}
		ORDER BY timestamp ASC
		`,
		[userId, from.toISOString(), to.toISOString()]
	) as unknown as Array<{ timestamp: Date; value: string | number }>;

	return rows.map((row) => ({
		timestamp: new Date(row.timestamp),
		value: Math.abs(Number(row.value) || 0),
	}));
}

async function fetchCategorizedAmountRows(
	userId: string,
	from: Date,
	to: Date,
	filterCategory: string,
): Promise<Array<{ timestamp: Date; value: number }>> {
	await ensureCategorizedEventsForRange({ userId, from, to: new Date(to.getTime() + 1) });

	const wantedCategory = normalizeCategoryId(filterCategory);
	if (!wantedCategory) return [];

	const rows = await pgClient.unsafe(
		`
		SELECT
			timestamp,
			ABS(amount::numeric) AS value
		FROM categorized_events
		WHERE user_id = $1
		  AND resolved_category = $4
		  AND timestamp >= $2
		  AND timestamp <= $3
		  AND amount::numeric < 0
		ORDER BY timestamp ASC
		`,
		[userId, from.toISOString(), to.toISOString(), wantedCategory]
	) as unknown as Array<{ timestamp: Date; value: string | number }>;

	const categorizedRows = rows.map((tx) => ({
		timestamp: new Date(tx.timestamp),
		value: Math.abs(Number(tx.value) || 0),
	}));

	if (categorizedRows.length > 0) {
		return categorizedRows;
	}

	// Fallback: hvis mapping/kategorisering ikke treffer ennå, bruk keyword-filter
	return fetchKeywordFilteredAmountRows(userId, from, to, filterCategory);
}

async function collectAmountFilterDebug(
	userId: string,
	from: Date,
	to: Date,
	filterCategory: string,
): Promise<AmountFilterDebug> {
	await ensureCategorizedEventsForRange({ userId, from, to: new Date(to.getTime() + 1) });

	const wantedCategory = normalizeCategoryId(filterCategory);

	const rows = await pgClient.unsafe(
		`
		SELECT
			resolved_category AS category,
			COUNT(*)::int AS count
		FROM categorized_events
		WHERE user_id = $1
		  AND timestamp >= $2
		  AND timestamp <= $3
		  AND amount::numeric < 0
		GROUP BY resolved_category
		ORDER BY count DESC
		`,
		[userId, from.toISOString(), to.toISOString()]
	) as unknown as Array<{ category: string | null; count: number }>;

	const totalSpendTxCountInRange = rows.reduce((sum, row) => sum + Number(row.count || 0), 0);
	const categorizedMatchCount = rows
		.filter((row) => normalizeCategoryId(row.category) === wantedCategory)
		.reduce((sum, row) => sum + Number(row.count || 0), 0);

	const keywordRows = await fetchKeywordFilteredAmountRows(userId, from, to, filterCategory);
	const topClassifiedCategories = rows.slice(0, 5).map((row) => ({
		category: row.category ?? 'ukategorisert',
		count: Number(row.count || 0)
	}));

	const sampleRows = await pgClient.unsafe(
		`
		SELECT
			timestamp,
			description,
			amount::numeric AS amount
		FROM categorized_events
		WHERE user_id = $1
		  AND timestamp >= $2
		  AND timestamp <= $3
		  AND amount::numeric < 0
		  AND resolved_category = $4
		ORDER BY timestamp DESC
		LIMIT 6
		`,
		[userId, from.toISOString(), to.toISOString(), wantedCategory]
	) as unknown as Array<{ timestamp: Date; description: string | null; amount: string | number }>;

	const sampleMatches = sampleRows
		.slice(0, 6)
		.map((tx) => ({
			date: new Date(tx.timestamp).toISOString().slice(0, 10),
			description: tx.description ?? 'Ukjent',
			amount: Math.abs(Number(tx.amount) || 0),
		}));

	return {
		filterCategory,
		filterCategoryNormalized: wantedCategory,
		totalSpendTxCountInRange,
		categorizedMatchCount,
		keywordMatchCount: keywordRows.length,
		projectionCoveragePct: totalSpendTxCountInRange === 0
			? 100
			: Math.round((totalSpendTxCountInRange / Math.max(totalSpendTxCountInRange, keywordRows.length)) * 100),
		topClassifiedCategories,
		sampleMatches,
	};
}

function getBucketKey(timestamp: Date, period: string): string {
	const d = new Date(timestamp);
	if (period === 'month') {
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
	}
	if (period === 'week') {
		const day = (d.getDay() + 6) % 7;
		d.setDate(d.getDate() - day);
		d.setHours(0, 0, 0, 0);
		return `${d.getFullYear()}-W${String(Math.ceil((((d.getTime() - new Date(d.getFullYear(), 0, 1).getTime()) / 86400000) + 1) / 7)).padStart(2, '0')}`;
	}
	d.setHours(0, 0, 0, 0);
	return d.toISOString().slice(0, 10);
}

function aggregateValues(values: number[], aggregation: string): number {
	if (values.length === 0) return 0;
	if (aggregation === 'count') return values.length;
	if (aggregation === 'latest') return values[values.length - 1] ?? 0;
	if (aggregation === 'avg') return values.reduce((sum, v) => sum + v, 0) / values.length;
	return values.reduce((sum, v) => sum + v, 0);
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
	if (metricConf.dataType === 'bank_transaction' && filterCategory) {
		const rows = await fetchCategorizedAmountRows(userId, from, to, filterCategory);
		const byBucket = new Map<string, number[]>();

		for (const row of rows) {
			const key = getBucketKey(row.timestamp, period);
			const list = byBucket.get(key) ?? [];
			list.push(row.value);
			byBucket.set(key, list);
		}

		return [...byBucket.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([bucket, values]) => ({
				bucket,
				value: aggregateValues(values, aggregation),
			}));
	}

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
	if (metricConf.dataType === 'bank_transaction' && filterCategory) {
		const rows = await fetchCategorizedAmountRows(userId, from, to, filterCategory);
		if (rows.length === 0) return null;
		return aggregateValues(rows.map((row) => row.value), aggregation);
	}

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

export const GET: RequestHandler = async ({ params, locals, url }) => {
	const widgetId = params.id;
	const userId = locals.userId;
	const debugEnabled = url.searchParams.get('debug') === '1';
	const filterCategoryOverride = url.searchParams.get('filterCategory');

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
	let effectiveRange = widget.range;
	let usedRangeFallback = false;

	// Hent tidsserie (for sparkline), periodeaggregat (for current) og forrige periode (for delta) i parallell
	const filterCategory = filterCategoryOverride !== null
		? (filterCategoryOverride.trim() || null)
		: (widget.filterCategory ?? null);
	let [series, currentValue, prevValue] = await Promise.all([
		fetchTimeSeries(userId, metricConf, widget.aggregation, widget.period, from, to, filterCategory),
		// For avg/sum: bruk periodeaggregat som current (mer representativt enn kun siste dag)
		// For latest: siste bøtteverdi er riktigst (peker på nyeste måling)
		widget.aggregation !== 'latest'
			? fetchSingleValue(userId, metricConf, widget.aggregation, from, to, filterCategory)
			: Promise.resolve(null),
		fetchSingleValue(userId, metricConf, widget.aggregation, prev.from, prev.to, filterCategory),
	]);

	if (
		widget.metricType === 'amount' &&
		filterCategory &&
		widget.range === 'current_month' &&
		series.length === 0
	) {
		const fallbackFromTo = getRangeDate('last30');
		const fallbackPrev = getPreviousRange('last30');
		const [fallbackSeries, fallbackCurrentValue, fallbackPrevValue] = await Promise.all([
			fetchTimeSeries(
				userId,
				metricConf,
				widget.aggregation,
				widget.period,
				fallbackFromTo.from,
				fallbackFromTo.to,
				filterCategory
			),
			widget.aggregation !== 'latest'
				? fetchSingleValue(
					userId,
					metricConf,
					widget.aggregation,
					fallbackFromTo.from,
					fallbackFromTo.to,
					filterCategory
				)
				: Promise.resolve(null),
			fetchSingleValue(
				userId,
				metricConf,
				widget.aggregation,
				fallbackPrev.from,
				fallbackPrev.to,
				filterCategory
			)
		]);

		if (fallbackSeries.length > 0) {
			series = fallbackSeries;
			currentValue = fallbackCurrentValue;
			prevValue = fallbackPrevValue;
			effectiveRange = 'last30';
			usedRangeFallback = true;
		}
	}

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

	const amountFilterDebug =
		debugEnabled && widget.metricType === 'amount' && filterCategory
			? await collectAmountFilterDebug(userId, from, to, filterCategory)
			: null;

	return json({
		current,
		sparkline,
		unit: widget.unit,
		delta,
		pct,
		state: computeState(current, warnNum, successNum),
		...(debugEnabled
			? {
				debug: {
					widgetId,
					metricType: widget.metricType,
					aggregation: widget.aggregation,
					period: widget.period,
					range: widget.range,
					filterCategory,
					effectiveRange,
					usedRangeFallback,
					from: from.toISOString(),
					to: to.toISOString(),
					seriesBuckets: series.length,
					amountFilter: amountFilterDebug,
				}
			}
			: {})
	});
};
