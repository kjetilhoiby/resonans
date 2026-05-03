/**
 * MetricDefinitionService
 *
 * Søkbart register over alle tilgjengelige metrikker for widgets.
 * Innebygde metrikker er code-first (generert fra CATEGORIES/SUBCATEGORIES).
 * DB-tabellen metric_definitions brukes kun for bruker-definerte overstyringer.
 */

import { CATEGORIES, SUBCATEGORIES } from '$lib/integrations/transaction-categories-client';
import { db } from '$lib/db';
import { metricAggregateCache } from '$lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';

export type MetricDomain = 'health' | 'spending' | 'income';

export interface MetricDefinition {
	key: string;
	domain: MetricDomain;
	label: string;
	description?: string;
	filterCategory?: string;
	filterSubcategory?: string;
	dataType: string;
	defaultAggregation: 'sum' | 'avg' | 'count' | 'latest';
	defaultPeriod: 'day' | 'week' | 'month';
	defaultRange: string;
	defaultUnit: string;
	direction: 'higher_is_better' | 'lower_is_better';
	searchAliases: string[];
	bucketAggregation?: string;
	outerAggregation?: string;
}

export interface MetricSearchResult {
	key: string;
	label: string;
	description?: string;
	domain: MetricDomain;
	defaultAggregation: string;
	defaultPeriod: string;
	defaultRange: string;
	defaultUnit: string;
	filterCategory?: string;
	filterSubcategory?: string;
	direction: 'higher_is_better' | 'lower_is_better';
	score: number;
}

// --- Søkenøkkel-aliaser for forbrukskategorier ---
const SPENDING_ALIASES: Record<string, string[]> = {
	spending_bil_og_transport:                       ['transport', 'bil', 'bom', 'parkering', 'drivstoff', 'elbil', 'lading', 'buss', 'tog', 'trikk', 't-bane', 'fly'],
	spending_bil_og_transport_drivstoff:             ['drivstoff', 'bensin', 'diesel', 'elbil lading', 'ev charging', 'circle k', 'shell', 'uno-x', 'recharge', 'mer charging', 'tesla lading'],
	spending_bil_og_transport_bom:                   ['bom', 'bomring', 'fjellinjen', 'autopass'],
	spending_bil_og_transport_parkering:             ['parkering', 'parkeringshus', 'getbybus'],
	spending_bil_og_transport_kollektivtransport:    ['kollektivtransport', 'ruter', 'buss', 'tog', 'vy', 'nettbuss', 'flybuss', 'trikk', 't-bane', 'metro'],
	spending_bil_og_transport_taxi:                  ['taxi', 'uber', 'bolt'],
	spending_dagligvarer:                            ['dagligvarer', 'mat', 'matvarer', 'grocery', 'rema', 'kiwi', 'meny', 'coop', 'spar', 'joker', 'bunnpris'],
	spending_kafe_og_restaurant:                     ['restaurant', 'kafe', 'café', 'mat ute', 'lunsj', 'middag ute', 'foodora', 'wolt', 'just eat'],
	spending_kafe_og_restaurant_fastfood:            ['fastfood', 'mcdonalds', 'burger king', 'kfc', 'subway'],
	spending_faste_boutgifter:                       ['husleie', 'felleskost', 'strøm', 'internett', 'bolig', 'boutgifter'],
	spending_faste_boutgifter_stroem:                ['strøm', 'strømleverandør', 'fjordkraft', 'tibber', 'hafslund'],
	spending_faste_boutgifter_internett:             ['internett', 'bredbånd', 'telenor', 'telia', 'ice'],
	spending_faste_boutgifter_mobiltelefon:          ['mobil', 'mobilabonnement', 'telenor', 'telia', 'ice'],
	spending_helse_og_velvaere:                      ['helse', 'apotek', 'lege', 'tannlege', 'fysioterapi', 'velvære'],
	spending_medier_og_underholdning:                ['spotify', 'netflix', 'hbo', 'viaplay', 'youtube', 'apple', 'streaming', 'abonnement'],
	spending_hobby_og_fritid:                        ['hobby', 'fritid', 'trening', 'kino', 'sport', 'sats', 'gym'],
	spending_hobby_og_fritid_trening:                ['trening', 'gym', 'sats', 'evo fitness', 'crossfit'],
	spending_hjem_og_hage:                           ['ikea', 'byggvare', 'clas ohlson', 'jula', 'interiør', 'møbler'],
	spending_klaer_og_utstyr:                        ['klær', 'sko', 'shopping', 'zalando', 'h&m', 'hm', 'cubus'],
	spending_reise:                                  ['reise', 'fly', 'hotell', 'airbnb', 'booking', 'sas', 'norwegian'],
	spending_forsikring:                             ['forsikring', 'gjensidige', 'if', 'tryg'],
	spending_sparing:                                ['sparing', 'fond', 'aksjer', 'nordnet', 'dnb markets'],
};

// --- Innebygd katalog (code-first) ---

const HEALTH_DEFINITIONS: MetricDefinition[] = [
	{
		key: 'health_weight',
		domain: 'health',
		label: 'Kroppsvekt',
		description: 'Gjennomsnittlig kroppsvekt',
		dataType: 'weight',
		defaultAggregation: 'avg',
		defaultPeriod: 'day',
		defaultRange: 'last7',
		defaultUnit: 'kg',
		direction: 'lower_is_better',
		searchAliases: ['vekt', 'weight', 'kg', 'kroppsvekt'],
	},
	{
		key: 'health_sleep',
		domain: 'health',
		label: 'Søvn',
		description: 'Gjennomsnittlig søvnlengde',
		dataType: 'sleep',
		defaultAggregation: 'avg',
		defaultPeriod: 'day',
		defaultRange: 'last7',
		defaultUnit: 'timer',
		direction: 'higher_is_better',
		searchAliases: ['søvn', 'sleep', 'sove', 'timer', 'natt'],
	},
	{
		key: 'health_steps',
		domain: 'health',
		label: 'Skritt',
		description: 'Gjennomsnittlig daglig skritt',
		dataType: 'activity',
		defaultAggregation: 'avg',
		defaultPeriod: 'day',
		defaultRange: 'last7',
		defaultUnit: 'steg',
		direction: 'higher_is_better',
		bucketAggregation: 'MAX',
		outerAggregation: 'AVG',
		searchAliases: ['skritt', 'steg', 'steps', 'gå', 'aktivitet'],
	},
	{
		key: 'health_distance',
		domain: 'health',
		label: 'Løpedistanse',
		description: 'Total løpe- og treningsdistanse',
		dataType: 'workout',
		defaultAggregation: 'sum',
		defaultPeriod: 'week',
		defaultRange: 'last30',
		defaultUnit: 'km',
		direction: 'higher_is_better',
		searchAliases: ['distanse', 'løp', 'løping', 'running', 'distance', 'km'],
	},
	{
		key: 'health_workouts',
		domain: 'health',
		label: 'Treningsøkter',
		description: 'Antall treningsøkter',
		dataType: 'workout',
		defaultAggregation: 'count',
		defaultPeriod: 'week',
		defaultRange: 'last30',
		defaultUnit: 'økter',
		direction: 'higher_is_better',
		searchAliases: ['trening', 'treningsøkter', 'workout', 'økt', 'gym'],
	},
	{
		key: 'health_heartrate',
		domain: 'health',
		label: 'Hvilepuls',
		description: 'Gjennomsnittlig hvilepuls',
		dataType: 'heart_rate',
		defaultAggregation: 'avg',
		defaultPeriod: 'day',
		defaultRange: 'last7',
		defaultUnit: 'bpm',
		direction: 'lower_is_better',
		searchAliases: ['puls', 'hjerte', 'bpm', 'heartrate', 'hvilepuls'],
	},
	{
		key: 'health_mood',
		domain: 'health',
		label: 'Humør',
		description: 'Gjennomsnittlig humørscore',
		dataType: 'mood',
		defaultAggregation: 'avg',
		defaultPeriod: 'day',
		defaultRange: 'last7',
		defaultUnit: 'score',
		direction: 'higher_is_better',
		searchAliases: ['humør', 'mood', 'stemning', 'score'],
	},
	{
		key: 'health_screen_time',
		domain: 'health',
		label: 'Skjermtid',
		description: 'Daglig skjermtid',
		dataType: 'screen_time',
		defaultAggregation: 'avg',
		defaultPeriod: 'day',
		defaultRange: 'last7',
		defaultUnit: 'min',
		direction: 'lower_is_better',
		searchAliases: ['skjermtid', 'screen time', 'telefon', 'skjerm'],
	},
];

// Generer forbruksmetrikker fra CATEGORIES + SUBCATEGORIES
function buildSpendingDefinitions(): MetricDefinition[] {
	const defs: MetricDefinition[] = [];

	// Totalforbruk
	defs.push({
		key: 'spending_total',
		domain: 'spending',
		label: 'Totalt forbruk',
		description: 'Sum av alle utgifter',
		dataType: 'bank_transaction',
		defaultAggregation: 'sum',
		defaultPeriod: 'day',
		defaultRange: 'current_month',
		defaultUnit: 'kr',
		direction: 'lower_is_better',
		searchAliases: ['forbruk', 'utgifter', 'total', 'alt', 'penger brukt'],
	});

	for (const [catId, cat] of Object.entries(CATEGORIES)) {
		// Hopp over income-kategorier og ukategorisert på toppnivå
		if (catId === 'innskudd') continue;

		const catKey = `spending_${catId}`;
		defs.push({
			key: catKey,
			domain: 'spending',
			label: cat.label,
			description: `Forbruk – ${cat.label}`,
			filterCategory: catId,
			dataType: 'bank_transaction',
			defaultAggregation: 'sum',
			defaultPeriod: 'day',
			defaultRange: 'current_month',
			defaultUnit: 'kr',
			direction: 'lower_is_better',
			searchAliases: SPENDING_ALIASES[catKey] ?? [catId.replace(/_/g, ' '), cat.label.toLowerCase()],
		});

		const subcats = SUBCATEGORIES[catId as keyof typeof SUBCATEGORIES] ?? [];
		for (const sub of subcats) {
			const subKey = `spending_${catId}_${sub.key}`;
			defs.push({
				key: subKey,
				domain: 'spending',
				label: `${sub.label} (${cat.label})`,
				description: `Forbruk – ${sub.label} under ${cat.label}`,
				filterCategory: catId,
				filterSubcategory: sub.key,
				dataType: 'bank_transaction',
				defaultAggregation: 'sum',
				defaultPeriod: 'day',
				defaultRange: 'current_month',
				defaultUnit: 'kr',
				direction: 'lower_is_better',
				searchAliases: SPENDING_ALIASES[subKey] ?? [sub.key.replace(/_/g, ' '), sub.label.toLowerCase()],
			});
		}
	}

	// Inntekt
	defs.push({
		key: 'income_total',
		domain: 'income',
		label: 'Totale inntekter',
		description: 'Sum av alle innbetalinger og lønn',
		filterCategory: 'innskudd',
		dataType: 'bank_transaction',
		defaultAggregation: 'sum',
		defaultPeriod: 'day',
		defaultRange: 'current_month',
		defaultUnit: 'kr',
		direction: 'higher_is_better',
		searchAliases: ['inntekt', 'lønn', 'salary', 'innskudd', 'utbetaling'],
	});

	return defs;
}

// Lastes én gang ved module-init
const BUILTIN_CATALOG: MetricDefinition[] = [...HEALTH_DEFINITIONS, ...buildSpendingDefinitions()];
const CATALOG_BY_KEY = new Map<string, MetricDefinition>(BUILTIN_CATALOG.map((d) => [d.key, d]));

// --- Normalisering for søk ---
function normalize(s: string): string {
	return s
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function scoreMatch(def: MetricDefinition, queryTokens: string[]): number {
	let score = 0;
	const keyNorm = normalize(def.key);
	const labelNorm = normalize(def.label);
	const descNorm = normalize(def.description ?? '');
	const aliasesNorm = def.searchAliases.map(normalize);

	for (const token of queryTokens) {
		if (keyNorm === token || labelNorm === token) { score += 1.0; continue; }
		if (keyNorm.includes(token) || labelNorm.includes(token)) { score += 0.7; continue; }
		if (aliasesNorm.some((a) => a === token)) { score += 0.9; continue; }
		if (aliasesNorm.some((a) => a.includes(token))) { score += 0.5; continue; }
		if (descNorm.includes(token)) { score += 0.3; }
	}

	return queryTokens.length > 0 ? score / queryTokens.length : 0;
}

// --- Public API ---

export function getMetricByKey(key: string): MetricDefinition | undefined {
	return CATALOG_BY_KEY.get(key);
}

export function getAllMetrics(domain?: MetricDomain): MetricDefinition[] {
	if (!domain) return BUILTIN_CATALOG;
	return BUILTIN_CATALOG.filter((d) => d.domain === domain);
}

export function searchMetrics(
	query: string,
	domain?: MetricDomain,
	limit = 8,
): MetricSearchResult[] {
	const tokens = normalize(query).split(' ').filter(Boolean);
	if (tokens.length === 0) return [];

	const candidates = domain ? BUILTIN_CATALOG.filter((d) => d.domain === domain) : BUILTIN_CATALOG;

	return candidates
		.map((def) => ({ def, score: scoreMatch(def, tokens) }))
		.filter(({ score }) => score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, limit)
		.map(({ def, score }) => ({
			key: def.key,
			label: def.label,
			description: def.description,
			domain: def.domain,
			defaultAggregation: def.defaultAggregation,
			defaultPeriod: def.defaultPeriod,
			defaultRange: def.defaultRange,
			defaultUnit: def.defaultUnit,
			filterCategory: def.filterCategory,
			filterSubcategory: def.filterSubcategory,
			direction: def.direction,
			score: Math.round(score * 100) / 100,
		}));
}

/** Avled metricKey fra legacy widget-parametere (bakoverkompatibilitet). */
export function deriveMetricKey(
	metricType: string,
	filterCategory?: string | null,
	filterSubcategory?: string | null,
): string {
	if (metricType !== 'amount') return `health_${metricType}`;
	if (!filterCategory) return 'spending_total';
	const base = `spending_${filterCategory}`;
	if (!filterSubcategory) return base;
	return `${base}_${filterSubcategory}`;
}

/** Slett utdaterte cache-poster for en bruker (eldre enn maxAgeDays). */
export async function pruneMetricCache(userId: string, maxAgeDays = 400): Promise<void> {
	const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);
	await db
		.delete(metricAggregateCache)
		.where(and(eq(metricAggregateCache.userId, userId), sql`${metricAggregateCache.endDate}::timestamp < ${cutoff.toISOString()}`));
}
