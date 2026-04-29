import { db } from '$lib/db';
import { classificationOverrides, taskClassificationRules, transactionMatchingRules } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';

const OVERRIDES_CACHE_TTL_MS = 60 * 1000;
const RULES_CACHE_TTL_MS = 5 * 60 * 1000;

export type ClassificationDomain = 'transaction' | 'task';

export type ClassificationOverride = {
	correctedCategory: string;
	correctedSubcategory: string | null;
	weight: number;
};

export type ClassificationOverrideCache = Map<string, ClassificationOverride>;

export type TaskClassificationRule = {
	category: string;
	keywords: string[];
	priority: number;
};

export type TransactionMatchingRule = {
	category: string;
	keywords: string[];
	fixed: boolean | null;
};

const overridesCache = new Map<
	string,
	{
		cachedAt: number;
		data: ClassificationOverrideCache;
	}
>();

let taskRulesCache: { cachedAt: number; data: TaskClassificationRule[] } | null = null;
let transactionRulesCache: { cachedAt: number; data: TransactionMatchingRule[] } | null = null;

function normalizeText(value: string | null | undefined): string {
	return (value ?? '').trim().toLowerCase();
}

export function buildTransactionFingerprint(
	description: string | null,
	typeText: string | null,
	amount: number
): string {
	const merchantKey = normalizeText(description) || normalizeText(typeText) || 'ukjent';
	const direction = amount >= 0 ? 'in' : 'out';
	return `${merchantKey}|${direction}`;
}

export function buildTaskFingerprint(
	activityType: string,
	metrics: Array<{ unit?: string }>
): string {
	const normalizedType = normalizeText(activityType);
	const units = [...new Set(metrics.map((metric) => normalizeText(metric.unit)).filter(Boolean))]
		.sort()
		.join(',');
	return `${normalizedType}|units:${units || 'none'}`;
}

export async function loadClassificationOverrides(
	userId: string,
	domain: ClassificationDomain
): Promise<ClassificationOverrideCache> {
	const cacheKey = `${userId}:${domain}`;
	const cached = overridesCache.get(cacheKey);
	if (cached && Date.now() - cached.cachedAt < OVERRIDES_CACHE_TTL_MS) {
		return new Map(cached.data);
	}

	const rows = await db.query.classificationOverrides.findMany({
		where: and(eq(classificationOverrides.userId, userId), eq(classificationOverrides.domain, domain)),
		columns: {
			fingerprint: true,
			correctedCategory: true,
			correctedSubcategory: true,
			weight: true
		}
	});

	const mapped = new Map(
		rows.map((row) => [row.fingerprint, { correctedCategory: row.correctedCategory, correctedSubcategory: row.correctedSubcategory ?? null, weight: row.weight }])
	);

	overridesCache.set(cacheKey, {
		cachedAt: Date.now(),
		data: mapped
	});

	return new Map(mapped);
}

export function getOverrideCategory(
	cache: ClassificationOverrideCache | undefined,
	fingerprint: string
): string | null {
	if (!cache) return null;
	return cache.get(fingerprint)?.correctedCategory ?? null;
}

export function getOverrideSubcategory(
	cache: ClassificationOverrideCache | undefined,
	fingerprint: string
): string | null {
	if (!cache) return null;
	return cache.get(fingerprint)?.correctedSubcategory ?? null;
}

export async function upsertClassificationOverride(params: {
	userId: string;
	domain: ClassificationDomain;
	fingerprint: string;
	correctedCategory: string;
	correctedSubcategory?: string | null;
	source?: string;
}) {
	const existing = await db.query.classificationOverrides.findFirst({
		where: and(
			eq(classificationOverrides.userId, params.userId),
			eq(classificationOverrides.domain, params.domain),
			eq(classificationOverrides.fingerprint, params.fingerprint)
		)
	});

	if (existing) {
		const incrementWeight = existing.correctedCategory === params.correctedCategory;
		const [updated] = await db
			.update(classificationOverrides)
			.set({
				correctedCategory: params.correctedCategory,
				correctedSubcategory: params.correctedSubcategory ?? null,
				weight: incrementWeight ? existing.weight + 1 : 1,
				source: params.source ?? existing.source,
				updatedAt: new Date()
			})
			.where(eq(classificationOverrides.id, existing.id))
			.returning();
		overridesCache.delete(`${params.userId}:${params.domain}`);
		return updated;
	}

	const [created] = await db
		.insert(classificationOverrides)
		.values({
			userId: params.userId,
			domain: params.domain,
			fingerprint: params.fingerprint,
			correctedCategory: params.correctedCategory,
			correctedSubcategory: params.correctedSubcategory ?? null,
			source: params.source ?? 'manual_ui'
		})
		.returning();

	overridesCache.delete(`${params.userId}:${params.domain}`);

	return created;
}

/**
 * Load active task classification rules from database
 */
export async function loadTaskClassificationRules(): Promise<TaskClassificationRule[]> {
	if (taskRulesCache && Date.now() - taskRulesCache.cachedAt < RULES_CACHE_TTL_MS) {
		return taskRulesCache.data;
	}

	const rows = await db.query.taskClassificationRules.findMany({
		where: eq(taskClassificationRules.active, true),
		columns: {
			category: true,
			keywords: true,
			priority: true
		}
	});

	const mapped = rows.map((row) => ({
		category: row.category,
		keywords: row.keywords || [],
		priority: row.priority
	}));

	taskRulesCache = {
		cachedAt: Date.now(),
		data: mapped
	};

	return mapped;
}

/**
 * Load active transaction matching rules from database
 */
export async function loadTransactionMatchingRules(): Promise<TransactionMatchingRule[]> {
	if (transactionRulesCache && Date.now() - transactionRulesCache.cachedAt < RULES_CACHE_TTL_MS) {
		return transactionRulesCache.data;
	}

	const rows = await db.query.transactionMatchingRules.findMany({
		where: eq(transactionMatchingRules.active, true),
		columns: {
			category: true,
			keywords: true,
			fixed: true
		},
		orderBy: (table, { asc }) => [asc(table.displayOrder)]
	});

	const mapped = rows.map((row) => ({
		category: row.category,
		keywords: row.keywords || [],
		fixed: row.fixed
	}));

	transactionRulesCache = {
		cachedAt: Date.now(),
		data: mapped
	};

	return mapped;
}
