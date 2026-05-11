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
import { db, sql } from '$lib/db';
import { userWidgets, metricAggregateCache } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { ensureCategorizedEventsForRange } from '$lib/server/integrations/categorized-events';
import { loadTransactionMatchingRules } from '$lib/server/classification-overrides';
import { getMetricByKey, deriveMetricKey } from '$lib/server/services/metric-definition-service';
import { aggregateSingleMetric } from '$lib/server/integrations/aggregation';
import type { RequestHandler } from './$types';

// Støttede metrikk-typer og hvilken dataType/felt de henter fra
// bucketAggregation: overstyrer aggregering innad i hver tidsbøtte (brukes for data med duplikater/kumulative totaler)
// outerAggregation: overstyrer aggregering over bøttene i fetchSingleValue (uavhengig av widget.aggregation)
const METRIC_CONFIG: Record<string, { dataType: string; field: string; countStar?: boolean; bucketAggregation?: string; outerAggregation?: string }> = {
	weight:        { dataType: 'weight',           field: "data->>'weight'" },
	sleepDuration: { dataType: 'sleep',             field: "(data->>'sleepDuration')::numeric / 60" },  // minutter → timer
	// Withings sender kumulative dagstotaler + duplikater ved re-sync → MAX per dag, AVG over dager = riktig snitt
	steps:         { dataType: 'activity',          field: "data->>'steps'", bucketAggregation: 'MAX', outerAggregation: 'AVG' },
	// intense + moderate er i sekunder fra Withings → divider på 60 for minutter
	activeMinutes: { dataType: 'activity',          field: "(COALESCE((data->>'intense')::numeric, 0) + COALESCE((data->>'moderate')::numeric, 0)) / 60", bucketAggregation: 'MAX', outerAggregation: 'AVG' },
	distance:      { dataType: 'workout',           field: "data->>'distance'" },
	workoutCount:  { dataType: 'workout',           field: '1', countStar: true },
	heartrate:     { dataType: 'heart_rate',        field: "data->>'hr_average'" },
	mood:          { dataType: 'mood',              field: "data->>'rating'" },
	screenTime:    { dataType: 'screen_time',       field: "data->>'totalMinutes'" },
	amount:        { dataType: 'bank_transaction',  field: "ABS((data->>'amount')::numeric)" },
};

const SUPPORTED_RANGES = new Set([
	'last7',
	'last14',
	'last30',
	'last90',
	'last365',
	'current_week',
	'current_month',
	'current_year',
]);

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
		case 'last90': {
			const from = new Date(now);
			from.setDate(from.getDate() - 90);
			return { from, to };
		}
		case 'last365': {
			const from = new Date(now);
			from.setDate(from.getDate() - 365);
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
	sensorEventsTxCount: number;
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

	const rows = await sql(
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
	filterSubcategory?: string | null,
): Promise<Array<{ timestamp: Date; value: number }>> {
	await ensureCategorizedEventsForRange({ userId, from, to: new Date(to.getTime() + 1) });

	const wantedCategory = normalizeCategoryId(filterCategory);
	if (!wantedCategory) return [];

	const subcatClause = filterSubcategory ? `AND resolved_subcategory = $5` : '';
	const params: unknown[] = [userId, from.toISOString(), to.toISOString(), wantedCategory];
	if (filterSubcategory) params.push(filterSubcategory);

	const rows = await sql(
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
		  ${subcatClause}
		ORDER BY timestamp ASC
		`,
		params
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
	filterSubcategory?: string | null,
): Promise<AmountFilterDebug> {
	await ensureCategorizedEventsForRange({ userId, from, to: new Date(to.getTime() + 1) });

	const wantedCategory = normalizeCategoryId(filterCategory);

	const rows = await sql(
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

	const sampleSubcatClause = filterSubcategory ? `AND resolved_subcategory = $5` : '';
	const sampleParams: unknown[] = [userId, from.toISOString(), to.toISOString(), wantedCategory];
	if (filterSubcategory) sampleParams.push(filterSubcategory);

	const sampleRows = await sql(
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
		  ${sampleSubcatClause}
		ORDER BY timestamp DESC
		LIMIT 6
		`,
		sampleParams
	) as unknown as Array<{ timestamp: Date; description: string | null; amount: string | number }>;

	const sampleMatches = sampleRows
		.slice(0, 6)
		.map((tx) => ({
			date: new Date(tx.timestamp).toISOString().slice(0, 10),
			description: tx.description ?? 'Ukjent',
			amount: Math.abs(Number(tx.amount) || 0),
		}));

	const sensorCountRows = await sql(
		`SELECT COUNT(*)::int AS count FROM sensor_events
		 WHERE user_id = $1 AND data_type = 'bank_transaction'
		 AND timestamp >= $2 AND timestamp <= $3
		 AND (data->>'amount')::numeric < 0`,
		[userId, from.toISOString(), to.toISOString()]
	) as unknown as Array<{ count: number }>;
	const sensorEventsTxCount = Number(sensorCountRows[0]?.count || 0);

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
		sensorEventsTxCount,
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
	if (aggregation === 'delta') return (values[values.length - 1] ?? 0) - (values[0] ?? 0);
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
	filterSubcategory?: string | null,
): Promise<{ bucket: string; value: number }[]> {
	if (metricConf.dataType === 'bank_transaction' && filterCategory) {
		const rows = await fetchCategorizedAmountRows(userId, from, to, filterCategory, filterSubcategory);
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
	const sportTypeFilter = metricConf.dataType === 'workout' && filterSubcategory
		? `AND data->>'sportType' = '${filterSubcategory.replace(/'/g, "''")}'`
		: '';

	// Workout-data kan lagres fra flere sensorer (Withings + e-post/GPX) med litt ulike tidsstempler.
	// Grupper events innen 5 minutter av hverandre og ta MAX(distance) per cluster for å unngå dobbelttelling.
	const isWorkout = metricConf.dataType === 'workout';
	let query: string;
	if (isWorkout) {
		query = `
			SELECT date_trunc('${pgTrunc}', timestamp)::text AS bucket, ${aggFn}(best_val) AS value
			FROM (
				SELECT
					date_trunc('hour', timestamp) + INTERVAL '5 minutes' * FLOOR(EXTRACT(EPOCH FROM (timestamp - date_trunc('hour', timestamp))) / 300) AS cluster,
					MAX((${metricConf.field})::numeric) AS best_val,
					MIN(timestamp) AS timestamp
				FROM sensor_events
				WHERE user_id = $1
				  AND data_type = $2
				  AND timestamp >= $3
				  AND timestamp <= $4
				  ${nullCheck}
				  ${sportTypeFilter}
				GROUP BY cluster
			) deduped
			GROUP BY 1
			ORDER BY 1 ASC
		`;
	} else {
		query = `
			SELECT date_trunc('${pgTrunc}', timestamp)::text AS bucket, ${valueExpr} AS value
			FROM sensor_events
			WHERE user_id = $1
			  AND data_type = $2
			  AND timestamp >= $3
			  AND timestamp <= $4
			  ${nullCheck}
			  ${amountFilter}
			  ${categoryFilter}
			  ${sportTypeFilter}
			GROUP BY 1
			ORDER BY 1 ASC
		`;
	}

	const rows = await sql(query, [userId, metricConf.dataType, from.toISOString(), to.toISOString()]);
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
	filterSubcategory?: string | null,
): Promise<number | null> {
	if (metricConf.dataType === 'bank_transaction' && filterCategory) {
		const rows = await fetchCategorizedAmountRows(userId, from, to, filterCategory, filterSubcategory);
		if (rows.length === 0) return null;
		return aggregateValues(rows.map((row) => row.value), aggregation);
	}

	if (aggregation === 'delta' && !metricConf.countStar) {
		// Endring i perioden: siste måling minus første måling
		const nullCheck = `AND (${metricConf.field})::numeric IS NOT NULL`;
		const query = `
			SELECT (
				SELECT (${metricConf.field})::numeric
				FROM sensor_events
				WHERE user_id = $1 AND data_type = $2 AND timestamp >= $3 AND timestamp <= $4 ${nullCheck}
				ORDER BY timestamp DESC LIMIT 1
			) - (
				SELECT (${metricConf.field})::numeric
				FROM sensor_events
				WHERE user_id = $1 AND data_type = $2 AND timestamp >= $3 AND timestamp <= $4 ${nullCheck}
				ORDER BY timestamp ASC LIMIT 1
			) AS value
		`;
		const rows = await sql(query, [userId, metricConf.dataType, from.toISOString(), to.toISOString()]);
		const val = rows[0]?.value;
		return val !== null && val !== undefined ? parseFloat(String(val)) : null;
	}

	const userAggFn = aggregation === 'sum' ? 'SUM' : aggregation === 'count' ? 'COUNT' : aggregation === 'latest' ? 'MAX' : 'AVG';
	const nullCheck = metricConf.countStar ? '' : `AND (${metricConf.field})::numeric IS NOT NULL`;
	const amountFilter = metricConf.dataType === 'bank_transaction' ? `AND (data->>'amount')::numeric < 0` : '';
	const categoryFilter = buildCategoryFilter(metricConf.dataType, filterCategory);
	const sportTypeFilter = metricConf.dataType === 'workout' && filterSubcategory
		? `AND data->>'sportType' = '${filterSubcategory.replace(/'/g, "''")}'`
		: '';

	const isWorkout = metricConf.dataType === 'workout';
	let query: string;
	if (isWorkout) {
		// Workout-data kan lagres fra flere sensorer (Withings + e-post/GPX) med litt ulike tidsstempler.
		// Grupper events innen 5 minutter og ta MAX(distance) per cluster for å unngå dobbelttelling.
		const valueExpr = metricConf.countStar ? 'COUNT(*)' : `${userAggFn}(best_val)`;
		query = `
			SELECT ${valueExpr} AS value
			FROM (
				SELECT MAX((${metricConf.field})::numeric) AS best_val
				FROM sensor_events
				WHERE user_id = $1
				  AND data_type = $2
				  AND timestamp >= $3
				  AND timestamp <= $4
				  ${nullCheck}
				  ${sportTypeFilter}
				GROUP BY date_trunc('hour', timestamp) + INTERVAL '5 minutes' * FLOOR(EXTRACT(EPOCH FROM (timestamp - date_trunc('hour', timestamp))) / 300)
			) deduped
		`;
	} else if (metricConf.bucketAggregation && !metricConf.countStar) {
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
				  ${sportTypeFilter}
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
			  ${sportTypeFilter}
		`;
	}

	const rows = await sql(query, [userId, metricConf.dataType, from.toISOString(), to.toISOString()]);
	const val = rows[0]?.value;
	return val !== null && val !== undefined ? parseFloat(String(val)) : null;
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

// ─── Cache-helpers ────────────────────────────────────────────────────────────

/** Konverter widget.range til (period, periodKey) for cache-oppslag. Returnerer null for rullende vinduer. */
function rangeToCachePeriod(range: string): { period: string; periodKey: string } | null {
	const now = new Date();
	if (range === 'current_month') {
		const y = now.getFullYear();
		const m = now.getMonth() + 1;
		return { period: 'month', periodKey: `${y}M${String(m).padStart(2, '0')}` };
	}
	if (range === 'current_year') {
		return { period: 'year', periodKey: String(now.getFullYear()) };
	}
	if (range === 'current_week') {
		// ISO uke
		const d = new Date(now);
		d.setHours(0, 0, 0, 0);
		d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
		const week1 = new Date(d.getFullYear(), 0, 4);
		const weekNum = Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7) + 1;
		return { period: 'week', periodKey: `${d.getFullYear()}W${String(weekNum).padStart(2, '0')}` };
	}
	// last7/last14/last30 → rullende, ingen cache
	return null;
}

interface CacheResult {
	current: number | null;
	sparkline: number[];
	prevCurrent: number | null;
}

/** Forsøk å hente data fra metric_aggregate_cache. Returnerer null ved cache-miss. */
async function tryReadFromCache(
	userId: string,
	metricKey: string,
	range: string,
	aggregation: string,
): Promise<CacheResult | null> {
	if (aggregation === 'delta') return null; // cache har ikke valueDelta-kolonne
	const cachePeriod = rangeToCachePeriod(range);
	if (!cachePeriod) return null;

	const row = await db.query.metricAggregateCache.findFirst({
		where: and(
			eq(metricAggregateCache.userId, userId),
			eq(metricAggregateCache.metricKey, metricKey),
			eq(metricAggregateCache.period, cachePeriod.period),
			eq(metricAggregateCache.periodKey, cachePeriod.periodKey),
		),
	});

	if (!row) return null;

	const current =
		aggregation === 'sum' ? parseFloat(String(row.valueSum ?? '0')) :
		aggregation === 'avg' ? parseFloat(String(row.valueAvg ?? '0')) :
		aggregation === 'count' ? (row.valueCount ?? 0) :
		parseFloat(String(row.valueLatest ?? '0'));

	const sparkline = (row.dailyBuckets ?? []).map((b) => b.value);

	// Forrige periode: enkel heuristikk — finn periodKey for forrige periode
	const prevPeriodKey = getPrevPeriodKey(cachePeriod.period, cachePeriod.periodKey);
	let prevCurrent: number | null = null;
	if (prevPeriodKey) {
		const prevRow = await db.query.metricAggregateCache.findFirst({
			where: and(
				eq(metricAggregateCache.userId, userId),
				eq(metricAggregateCache.metricKey, metricKey),
				eq(metricAggregateCache.period, cachePeriod.period),
				eq(metricAggregateCache.periodKey, prevPeriodKey),
			),
		});
		if (prevRow) {
			prevCurrent =
				aggregation === 'sum' ? parseFloat(String(prevRow.valueSum ?? '0')) :
				aggregation === 'avg' ? parseFloat(String(prevRow.valueAvg ?? '0')) :
				aggregation === 'count' ? (prevRow.valueCount ?? 0) :
				parseFloat(String(prevRow.valueLatest ?? '0'));
		}
	}

	return { current, sparkline, prevCurrent };
}

function getPrevPeriodKey(period: string, periodKey: string): string | null {
	if (period === 'month') {
		const y = parseInt(periodKey.slice(0, 4));
		const m = parseInt(periodKey.slice(5));
		if (m === 1) return `${y - 1}M12`;
		return `${y}M${String(m - 1).padStart(2, '0')}`;
	}
	if (period === 'year') {
		return String(parseInt(periodKey) - 1);
	}
	if (period === 'week') {
		// Enklest: retur null, la delta-beregning falle tilbake til 0
		return null;
	}
	return null;
}

export const GET: RequestHandler = async ({ params, locals, url }) => {
	const widgetId = params.id;
	const userId = locals.userId;
	const debugEnabled = url.searchParams.get('debug') === '1';
	const filterCategoryOverride = url.searchParams.get('filterCategory');
	const rangeOverrideParam = url.searchParams.get('range');
	const rangeOverride =
		rangeOverrideParam && SUPPORTED_RANGES.has(rangeOverrideParam) ? rangeOverrideParam : null;

	const widget = await db.query.userWidgets.findFirst({
		where: and(
			eq(userWidgets.id, widgetId),
			eq(userWidgets.userId, userId)
		)
	});

	if (!widget) throw error(404, 'Widget ikke funnet');

	const activeRange = rangeOverride ?? widget.range;

	// ─── Cache-first path for metricKey-baserte widgets ───────────────────────
	const effectiveMetricKey = widget.metricKey
		?? (widget.metricType === 'amount' || widget.filterCategory
			? deriveMetricKey(widget.metricType, widget.filterCategory, widget.filterSubcategory)
			: null);

	if (widget.metricKey && !debugEnabled) {
		const cached = await tryReadFromCache(userId, widget.metricKey, activeRange, widget.aggregation);
		if (cached) {
			const goalNum = widget.goal ? parseFloat(String(widget.goal)) : null;
			const warnNum = widget.thresholdWarn ? parseFloat(String(widget.thresholdWarn)) : null;
			const successNum = widget.thresholdSuccess ? parseFloat(String(widget.thresholdSuccess)) : null;
			const current = cached.current !== null ? Math.round(cached.current * 10) / 10 : null;
			const prev_ = cached.prevCurrent !== null ? Math.round(cached.prevCurrent * 10) / 10 : null;
			const delta = current !== null && prev_ !== null ? Math.round((current - prev_) * 10) / 10 : 0;
			let pct: number | null = null;
			if (current !== null && goalNum !== null && goalNum > 0) {
				pct = Math.max(0, Math.min(100, Math.round((current / goalNum) * 100)));
			}
			return json({
				current,
				sparkline: cached.sparkline.map((v) => Math.round(v * 10) / 10),
				unit: widget.unit,
				delta,
				pct,
				state: computeState(current, warnNum, successNum),
				_source: 'cache',
			});
		}

		// Cache-miss: aggreger i bakgrunnen og fortsett med live-query
		void aggregateSingleMetric(userId, widget.metricKey).catch(() => { /* ignorer feil */ });
	}
	// ─────────────────────────────────────────────────────────────────────────

	const metricConf = METRIC_CONFIG[widget.metricType];
	if (!metricConf) throw error(400, `Ukjent metrikk-type: ${widget.metricType}`);

	const { from, to } = getRangeDate(activeRange);
	const prev = getPreviousRange(activeRange);
	let effectiveRange = activeRange;
	let usedRangeFallback = false;
	let effectiveFrom = from;
	let effectiveTo = to;

	// Hent tidsserie (for sparkline), periodeaggregat (for current) og forrige periode (for delta) i parallell
	const filterCategory = filterCategoryOverride !== null
		? (filterCategoryOverride.trim() || null)
		: (widget.filterCategory ?? null);
	const filterSubcategoryOverride = url.searchParams.get('filterSubcategory');
	const filterSubcategory = filterSubcategoryOverride !== null
		? (filterSubcategoryOverride.trim() || null)
		: (widget.filterSubcategory ?? null);
	let [series, currentValue, prevValue] = await Promise.all([
		fetchTimeSeries(userId, metricConf, widget.aggregation, widget.period, from, to, filterCategory, filterSubcategory),
		// For avg/sum: bruk periodeaggregat som current (mer representativt enn kun siste dag)
		// For latest: siste bøtteverdi er riktigst (peker på nyeste måling)
		widget.aggregation !== 'latest'
			? fetchSingleValue(userId, metricConf, widget.aggregation, from, to, filterCategory, filterSubcategory)
			: Promise.resolve(null),
		fetchSingleValue(userId, metricConf, widget.aggregation, prev.from, prev.to, filterCategory, filterSubcategory),
	]);

	if (
		widget.metricType === 'amount' &&
		filterCategory &&
		activeRange === 'current_month' &&
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
				filterCategory,
				filterSubcategory
			),
			widget.aggregation !== 'latest'
				? fetchSingleValue(
					userId,
					metricConf,
					widget.aggregation,
					fallbackFromTo.from,
					fallbackFromTo.to,
					filterCategory,
					filterSubcategory
				)
				: Promise.resolve(null),
			fetchSingleValue(
				userId,
				metricConf,
				widget.aggregation,
				fallbackPrev.from,
				fallbackPrev.to,
				filterCategory,
				filterSubcategory
			)
		]);

		if (fallbackSeries.length > 0) {
			series = fallbackSeries;
			currentValue = fallbackCurrentValue;
			prevValue = fallbackPrevValue;
			effectiveRange = 'last30';
			usedRangeFallback = true;
			effectiveFrom = fallbackFromTo.from;
			effectiveTo = fallbackFromTo.to;
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

	const debugRangeOverride = debugEnabled ? url.searchParams.get('range') : null;
	const { from: debugFrom, to: debugTo } = debugRangeOverride
		? getRangeDate(debugRangeOverride)
		: { from: effectiveFrom, to: effectiveTo };

	const amountFilterDebug =
		debugEnabled && widget.metricType === 'amount' && filterCategory
			? await collectAmountFilterDebug(userId, debugFrom, debugTo, filterCategory, filterSubcategory)
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
					range: activeRange,
					storedRange: widget.range,
					filterCategory,
					filterSubcategory,
					effectiveRange,
					usedRangeFallback,
					from: from.toISOString(),
					to: to.toISOString(),
					debugFrom: debugFrom.toISOString(),
					debugTo: debugTo.toISOString(),
					seriesBuckets: series.length,
					amountFilter: amountFilterDebug,
				}
			}
			: {})
	});
};
