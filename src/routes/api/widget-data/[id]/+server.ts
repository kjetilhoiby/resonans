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
import { readTransactions } from '$lib/server/economics/transactions';
import { loadTransactionMatchingRules } from '$lib/server/classification-overrides';
import { getMetricByKey, deriveMetricKey } from '$lib/server/services/metric-definition-service';
import { minutesInWindow, normalizeHourWindow, type HourBucket, type HourWindow } from '$lib/server/services/screen-time-window';
import { readScreenTimeSettings } from '$lib/server/health/screen-time-settings';
import { buildAttentionDays } from '$lib/domain/health/screen-time-attention';
import {
	categoryHourlyFromBuckets,
	hourlyArrayFromBuckets,
	toISODate
} from '$lib/utils/screen-time-series';
import { aggregateSingleMetric } from '$lib/server/integrations/aggregation';
import { runInBackground } from '$lib/server/run-in-background';
import { readDeduplicatedWorkouts } from '$lib/server/workouts/deduplicated-workouts';
import { workoutMetricRows } from '$lib/domain/health/workout-metric-rows';
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
	// Workout-metrikker leses aldri fra sensor_events direkte — se workoutMetricRows()
	distance:      { dataType: 'workout',           field: "data->>'distance'" },
	workoutCount:  { dataType: 'workout',           field: '1', countStar: true },
	heartrate:     { dataType: 'heart_rate',        field: "data->>'hr_average'" },
	sleepHeartRate:{ dataType: 'sleep',             field: "data->>'hr_average'" },
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
	filterCategory?: string | null,
	filterSubcategory?: string | null,
): Promise<Array<{ timestamp: Date; value: number }>> {
	// Gjennom den delte leseren, som flaten og chatten. Fram til august 2026 leste denne
	// `categorized_events` med et keyword-filter i SQL som fallback — altså en TREDJE
	// kategoriseringsvei, uten merchant-mappings og uten brukerens manuelle overstyringer.
	// En forbruksdings kunne derfor vise et annet tall enn forbrukskortet for samme kategori.
	// Se `docs/changelog/2026-08-11-okonomi-tillitsgjennomgang.md`.
	const wanted = filterCategory ? normalizeCategoryId(filterCategory) : null;

	const { transactions } = await readTransactions({
		userId,
		from,
		to: new Date(to.getTime() + 1),
		excludeInternalTransfers: true
	});

	return transactions
		.filter((tx) => tx.amount < 0)
		.filter((tx) => !wanted || tx.category === wanted)
		.filter((tx) => !filterSubcategory || tx.subcategory === filterSubcategory)
		.map((tx) => ({ timestamp: tx.timestamp, value: Math.abs(tx.amount) }));
}

/**
 * Henter skjermtid per dag — filtrert for passive timer og ignorerte apper, samme
 * beregning som Skjermtid-flaten og chatten bruker.
 *
 * Denne stien finnes fordi den generiske SQL-stien aggregerer
 * `data->>'totalMinutes'` rått i basen: en widget på hjemskjermen ville da vist
 * iOS' 13t 24m ved siden av en flate som sier 7t 24m for samme dag, og begge
 * ville sett riktige ut. Filtreringen kan ikke gjøres i SQL — den leser
 * timeprofilen og skjøter rekker over midnatt — så radene leses ut og bøttes med
 * den samme `bucketRows`-maskineriet de andre særtilfellene bruker.
 *
 * Med `window` gjelder vinduet den FILTRERTE timeprofilen. Dager uten
 * `hourly`-oppløsning utelates da (som før) i stedet for å telle som 0; uten
 * vindu teller de med, men er ufiltrerte — de kan ikke filtreres.
 */
async function fetchScreenTimeRows(
	userId: string,
	from: Date,
	to: Date,
	window: HourWindow | null,
): Promise<Array<{ timestamp: Date; value: number }>> {
	const settings = await readScreenTimeSettings(userId);
	// Ett døgn ekstra i hver ende: nattas rekke skjøtes over midnatt, så dagen
	// utenfor kanten må være lest for at kantdagen skal filtreres riktig.
	const margin = 86400000;
	const rows = await sql(
		`
		SELECT timestamp, data->>'totalMinutes' AS total, data->'hourly' AS hourly,
		       data->'apps' AS apps, data->'categories' AS categories
		FROM sensor_events
		WHERE user_id = $1
		  AND data_type = 'screen_time'
		  AND timestamp >= $2
		  AND timestamp <= $3
		  ${window ? "AND data ? 'hourly'" : ''}
		ORDER BY timestamp ASC
		`,
		[userId, new Date(from.getTime() - margin).toISOString(), new Date(to.getTime() + margin).toISOString()]
	) as unknown as Array<{
		timestamp: Date;
		total: string | null;
		hourly: Array<{ hour: number; totalMinutes: number; categories?: Record<string, number> }> | null;
		apps: Record<string, number> | null;
		categories: Record<string, number> | null;
	}>;

	const stamps = new Map<string, Date>();
	const inputs = rows.map((row) => {
		const ts = new Date(row.timestamp);
		const dateISO = toISODate(ts);
		stamps.set(dateISO, ts);
		return {
			dateISO,
			totalMinutes: Number(row.total) || 0,
			socialMinutes: Number(row.categories?.social) || 0,
			hourly: hourlyArrayFromBuckets(row.hourly),
			socialHourly: categoryHourlyFromBuckets(row.hourly, 'social'),
			apps: row.apps ?? undefined
		};
	});

	const result: Array<{ timestamp: Date; value: number }> = [];
	for (const day of buildAttentionDays(inputs, settings)) {
		const ts = stamps.get(day.dateISO);
		if (!ts || ts < from || ts > to) continue;
		if (window) {
			const buckets: HourBucket[] | undefined = day.attentionHourly?.map((minutes, hour) => ({
				hour,
				totalMinutes: minutes
			}));
			const value = minutesInWindow(buckets, window);
			if (value !== null) result.push({ timestamp: ts, value });
		} else {
			result.push({ timestamp: ts, value: day.attentionMinutes });
		}
	}
	return result;
}

/**
 * Diagnose for «hvorfor treffer ikke kategorifilteret mitt».
 *
 * Leser gjennom den delte leseren, samme kilde widgeten selv bruker. Fram til august 2026
 * rapporterte den på `categorized_events` mens widgeten leste rå `sensor_events` med et
 * keyword-filter — så diagnosen beskrev en annen sti enn den som produserte tallet, og
 * kunne si «alt ser bra ut» om et filter som ikke virket.
 *
 * `sensorEventsTxCount` beholdes som kryssjekk: spriket mot `totalSpendTxCountInRange` er
 * duplikatene i den rå strømmen, og det er nyttig å se.
 */
async function collectAmountFilterDebug(
	userId: string,
	from: Date,
	to: Date,
	filterCategory: string,
	filterSubcategory?: string | null,
): Promise<AmountFilterDebug> {
	const wantedCategory = normalizeCategoryId(filterCategory);

	const { transactions } = await readTransactions({
		userId,
		from,
		to: new Date(to.getTime() + 1),
		excludeInternalTransfers: true
	});

	const spending = transactions.filter((tx) => tx.amount < 0);

	const byCategory = new Map<string, number>();
	for (const tx of spending) {
		byCategory.set(tx.category, (byCategory.get(tx.category) ?? 0) + 1);
	}

	const totalSpendTxCountInRange = spending.length;
	const matches = spending
		.filter((tx) => tx.category === wantedCategory)
		.filter((tx) => !filterSubcategory || tx.subcategory === filterSubcategory);

	const topClassifiedCategories = [...byCategory.entries()]
		.map(([category, count]) => ({ category, count }))
		.sort((a, b) => b.count - a.count)
		.slice(0, 5);

	const sampleMatches = matches.slice(0, 6).map((tx) => ({
		date: tx.date,
		description: tx.description || 'Ukjent',
		amount: Math.abs(tx.amount),
	}));

	const keywordRows = await fetchKeywordFilteredAmountRows(userId, from, to, filterCategory);

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
		categorizedMatchCount: matches.length,
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

/** Grupperer rå (timestamp, value)-rader i tidsbøtter og aggregerer per bøtte */
function bucketRows(
	rows: Array<{ timestamp: Date; value: number }>,
	period: string,
	aggregation: string,
): { bucket: string; value: number }[] {
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

/** Aggregerer verdier til ett tall, eller null når ingenting ble målt */
function aggregateOrNull(values: number[], aggregation: string): number | null {
	if (values.length === 0) return null;
	return aggregateValues(values, aggregation);
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
	hourWindow?: HourWindow | null,
): Promise<{ bucket: string; value: number }[]> {
	// Gjelder også UTEN kategorifilter: den generiske SQL-stien under leser rå
	// sensor_events, som er ~3,8x duplisert.
	if (metricConf.dataType === 'bank_transaction') {
		const rows = await fetchCategorizedAmountRows(userId, from, to, filterCategory, filterSubcategory);
		return bucketRows(rows, period, aggregation);
	}

	if (metricConf.dataType === 'screen_time') {
		const rows = await fetchScreenTimeRows(userId, from, to, hourWindow ?? null);
		return bucketRows(rows, period, aggregation);
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
	hourWindow?: HourWindow | null,
): Promise<number | null> {
	if (metricConf.dataType === 'bank_transaction') {
		const rows = await fetchCategorizedAmountRows(userId, from, to, filterCategory, filterSubcategory);
		if (rows.length === 0) return null;
		return aggregateValues(rows.map((row) => row.value), aggregation);
	}

	if (metricConf.dataType === 'screen_time') {
		const rows = await fetchScreenTimeRows(userId, from, to, hourWindow ?? null);
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

// ─── effortBalance ────────────────────────────────────────────────────────────

/**
 * Widget-data for effortBalance: rullerende 7-dagers effort mot estimert
 * vekt-terskel, lest fra siste health_effort_vs_threshold-signal (cachen
 * produseres av domain-signals-cronen). GoalRing viser andel av terskelen.
 */
async function fetchEffortBalanceData(userId: string, unit: string | null) {
	const rows = (await sql(
		`SELECT value_number, context
		 FROM domain_signals
		 WHERE user_id = $1
		   AND signal_type = 'health_effort_vs_threshold'
		 ORDER BY observed_at DESC
		 LIMIT 1`,
		[userId]
	)) as Array<{ value_number: string | number | null; context: Record<string, unknown> | null }>;
	const row = rows[0];

	if (!row) {
		return { current: null, sparkline: [], unit: unit ?? 'effort', delta: 0, pct: null, state: 'normal' };
	}

	const context = (row.context ?? {}) as Record<string, unknown>;
	// currentEffortAvg (snitt over modellens lag-vindu) foretrekkes; eldre
	// signal-rader har bare rolling7dEffort.
	const rolling7dEffort =
		typeof context.currentEffortAvg === 'number'
			? Math.round(context.currentEffortAvg)
			: typeof context.rolling7dEffort === 'number'
				? Math.round(context.rolling7dEffort)
				: null;
	const ratio = row.value_number != null ? Number(row.value_number) : null;
	const quality = typeof context.quality === 'string' ? context.quality : 'insufficient';
	const thresholdSource = typeof context.thresholdSource === 'string' ? context.thresholdSource : null;
	const sparkline = Array.isArray(context.weeklyEffortLast8)
		? (context.weeklyEffortLast8 as unknown[]).filter((v): v is number => typeof v === 'number')
		: [];

	const hasThreshold =
		ratio != null &&
		Number.isFinite(ratio) &&
		(quality === 'ok' || quality === 'good' || thresholdSource === 'bins');
	const pct = hasThreshold ? Math.max(0, Math.min(100, Math.round(ratio * 100))) : null;
	const state: 'success' | 'warn' | 'normal' = !hasThreshold
		? 'normal'
		: ratio >= 1
			? 'success'
			: ratio < 0.85
				? 'warn'
				: 'normal';

	const last = sparkline.length > 0 ? sparkline[sparkline.length - 1] : null;
	const prev = sparkline.length > 1 ? sparkline[sparkline.length - 2] : null;
	const delta = last != null && prev != null ? Math.round(last - prev) : 0;

	return {
		current: rolling7dEffort,
		sparkline,
		unit: unit ?? 'effort',
		delta,
		pct,
		state,
	};
}

/**
 * Widget-data for trainingBalance: siste balanse-score (0–100) fra
 * training_balance-signalet (cachen produseres av domain-signals-cronen).
 * GoalRing viser scoren; nudge-teksten følger med som label.
 */
async function fetchTrainingBalanceData(userId: string, unit: string | null) {
	const rows = (await sql(
		`SELECT value_number, value_text, context
		 FROM domain_signals
		 WHERE user_id = $1
		   AND signal_type = 'training_balance'
		 ORDER BY observed_at DESC
		 LIMIT 1`,
		[userId]
	)) as Array<{
		value_number: string | number | null;
		value_text: string | null;
		context: Record<string, unknown> | null;
	}>;
	const row = rows[0];

	if (!row || row.value_number == null) {
		return { current: null, sparkline: [], unit: unit ?? 'score', delta: 0, pct: null, state: 'normal' };
	}

	const score = Math.round(Number(row.value_number));
	const context = (row.context ?? {}) as Record<string, unknown>;
	const nudge = (context.nudge ?? null) as { message?: string } | null;
	const label = nudge?.message ?? 'Fin variasjon';
	// Høyere score = bedre balanse.
	const state: 'success' | 'warn' | 'normal' = score >= 70 ? 'success' : score < 45 ? 'warn' : 'normal';

	return {
		current: score,
		sparkline: [],
		unit: unit ?? 'score',
		delta: 0,
		pct: Math.max(0, Math.min(100, score)),
		state,
		label,
	};
}

/**
 * Widget-data for effortDaily: snitt effort per dag siste 30 dager, direkte
 * fra canonical_workouts. Sparkline = snitt/dag per uke siste 8 uker — viser
 * om nivået holder seg stabilt over «siste fire uker». Delta mot forrige
 * 30-dagersperiode.
 */
async function fetchEffortDailyData(
	userId: string,
	widget: { unit: string | null; goal: string | null; thresholdWarn: string | null; thresholdSuccess: string | null }
) {
	const rows = (await sql(
		`SELECT start_time::date::text AS day, effort_score AS effort
		 FROM canonical_workouts
		 WHERE user_id = $1
		   AND effort_score IS NOT NULL
		   AND start_time >= now() - interval '60 days'`,
		[userId]
	)) as Array<{ day: string; effort: string | number }>;

	const now = new Date();
	const iso = (daysAgo: number) => {
		const d = new Date(now.getTime() - daysAgo * 24 * 3600_000);
		return d.toISOString().slice(0, 10);
	};
	const cut30 = iso(29);
	const cut60 = iso(59);

	let sum30 = 0;
	let sumPrev30 = 0;
	const byWeekMonday = new Map<string, number>();
	for (const row of rows) {
		const effort = Number(row.effort);
		if (!Number.isFinite(effort) || effort <= 0) continue;
		if (row.day >= cut30) sum30 += effort;
		else if (row.day >= cut60) sumPrev30 += effort;

		const d = new Date(`${row.day}T00:00:00Z`);
		const weekday = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
		d.setUTCDate(d.getUTCDate() - (weekday - 1));
		const monday = d.toISOString().slice(0, 10);
		byWeekMonday.set(monday, (byWeekMonday.get(monday) ?? 0) + effort);
	}

	const current = Math.round((sum30 / 30) * 10) / 10;
	const prev = Math.round((sumPrev30 / 30) * 10) / 10;

	// Sparkline: snitt/dag per uke, siste 8 uker (eldst → nyest)
	const sparkline: number[] = [];
	for (let w = 7; w >= 0; w--) {
		const d = new Date(now.getTime() - w * 7 * 24 * 3600_000);
		const weekday = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
		d.setUTCDate(d.getUTCDate() - (weekday - 1));
		const monday = d.toISOString().slice(0, 10);
		sparkline.push(Math.round(((byWeekMonday.get(monday) ?? 0) / 7) * 10) / 10);
	}

	const goalNum = widget.goal ? parseFloat(String(widget.goal)) : null;
	const warnNum = widget.thresholdWarn ? parseFloat(String(widget.thresholdWarn)) : null;
	const successNum = widget.thresholdSuccess ? parseFloat(String(widget.thresholdSuccess)) : null;
	let pct: number | null = null;
	if (goalNum !== null && goalNum > 0) {
		pct = Math.max(0, Math.min(100, Math.round((current / goalNum) * 100)));
	}

	return {
		current,
		sparkline,
		unit: widget.unit ?? 'effort/dag',
		delta: Math.round((current - prev) * 10) / 10,
		pct,
		state: computeState(current, warnNum, successNum)
	};
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
		runInBackground(aggregateSingleMetric(userId, widget.metricKey));
	}
	// ─────────────────────────────────────────────────────────────────────────

	// ─── effortBalance: rullerende 7d effort mot vekt-terskel (fra domain_signals) ───
	if (widget.metricType === 'effortBalance') {
		return json(await fetchEffortBalanceData(userId, widget.unit));
	}

	// ─── effortDaily: snitt effort per dag siste 30 dager (stabilitet over 4 uker) ───
	if (widget.metricType === 'effortDaily') {
		return json(await fetchEffortDailyData(userId, widget));
	}

	// ─── trainingBalance: balanse-score fra training_balance-signalet ───
	if (widget.metricType === 'trainingBalance') {
		return json(await fetchTrainingBalanceData(userId, widget.unit));
	}

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
	// Timevindu (kun screenTime): ugyldig/manglende par → hele døgnet
	const hourWindow = widget.metricType === 'screenTime'
		? normalizeHourWindow(widget.filterHourFrom, widget.filterHourTo)
		: null;
	// Treningsøkter leses deduplisert én gang for både nåværende og forrige periode
	const workouts = metricConf.dataType === 'workout'
		? await readDeduplicatedWorkouts(userId, prev.from, to)
		: null;

	let series: { bucket: string; value: number }[];
	let currentValue: number | null;
	let prevValue: number | null;

	if (workouts) {
		const currentRows = workoutMetricRows(workouts, widget.metricType, from, to, filterSubcategory);
		const prevRows = workoutMetricRows(workouts, widget.metricType, prev.from, prev.to, filterSubcategory);
		series = bucketRows(currentRows, widget.period, widget.aggregation);
		// For latest brukes siste bøtteverdi lenger ned, som for de andre metrikkene
		currentValue = widget.aggregation !== 'latest'
			? aggregateOrNull(currentRows.map((row) => row.value), widget.aggregation)
			: null;
		prevValue = aggregateOrNull(prevRows.map((row) => row.value), widget.aggregation);
	} else {
		[series, currentValue, prevValue] = await Promise.all([
			fetchTimeSeries(userId, metricConf, widget.aggregation, widget.period, from, to, filterCategory, filterSubcategory, hourWindow),
			// For avg/sum: bruk periodeaggregat som current (mer representativt enn kun siste dag)
			// For latest: siste bøtteverdi er riktigst (peker på nyeste måling)
			widget.aggregation !== 'latest'
				? fetchSingleValue(userId, metricConf, widget.aggregation, from, to, filterCategory, filterSubcategory, hourWindow)
				: Promise.resolve(null),
			fetchSingleValue(userId, metricConf, widget.aggregation, prev.from, prev.to, filterCategory, filterSubcategory, hourWindow),
		]);
	}

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
		// For vekt og skjermtid: lavere er bedre → inverter
		if (widget.metricType === 'weight' || widget.metricType === 'screenTime') {
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
					hourWindow,
					effectiveRange,
					usedRangeFallback,
					from: from.toISOString(),
					to: to.toISOString(),
					debugFrom: debugFrom.toISOString(),
					debugTo: debugTo.toISOString(),
					seriesBuckets: series.length,
					amountFilter: amountFilterDebug,
					// Deduplikerte økter i vinduet — sammenlign med sensor_events-antallet
					// når et treningstall ikke stemmer med Perioder-tabellen
					workouts: workouts
						? {
							deduplicatedInWindow: workouts.filter(
								(w) => w.timestamp >= from && w.timestamp <= to
							).length,
							matchingFilter: workoutMetricRows(workouts, widget.metricType, from, to, filterSubcategory).length,
							sportTypes: [...new Set(workouts.map((w) => w.sportType))],
						}
						: null,
				}
			}
			: {})
	});
};
