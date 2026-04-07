import { db } from '$lib/db';
import { categorizedEvents, sensorEvents } from '$lib/db/schema';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { loadClassificationOverrides, loadTransactionMatchingRules } from '$lib/server/classification-overrides';
import { loadMerchantMappings } from '$lib/server/integrations/spending-analyzer';
import { categorizeTransaction } from '$lib/server/integrations/transaction-categories';
import { normalizeCategoryId } from '$lib/integrations/transaction-categories-client';

const CLASSIFIER_VERSION = 3;
const UPSERT_CHUNK_SIZE = 500;

type EnsureRangeArgs = {
	userId: string;
	from: Date;
	to: Date;
};

type QueryCategorizedArgs = {
	userId: string;
	from: Date;
	to: Date;
	accountId?: string;
	category?: string;
	spendingOnly?: boolean;
	limit?: number;
	sortBy?: 'date' | 'amount';
};

export type CategorizedEventRow = {
	sensorEventId: string;
	timestamp: Date;
	accountId: string | null;
	amount: number;
	description: string | null;
	typeText: string | null;
	resolvedCategory: string;
	resolvedLabel: string | null;
	resolvedEmoji: string | null;
	isFixed: boolean;
};

export async function ensureCategorizedEventsForRange({ userId, from, to }: EnsureRangeArgs): Promise<void> {
	const rawCountRows = await db
		.select({ count: sql<number>`COUNT(*)` })
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'bank_transaction'),
				sql`${sensorEvents.timestamp} >= ${from.toISOString()}`,
				sql`${sensorEvents.timestamp} < ${to.toISOString()}`
			)
		);

	const rawCount = Number(rawCountRows[0]?.count ?? 0);
	if (rawCount === 0) return;

	const categorizedCountRows = await db
		.select({ count: sql<number>`COUNT(*)` })
		.from(categorizedEvents)
		.where(
			and(
				eq(categorizedEvents.userId, userId),
				sql`${categorizedEvents.timestamp} >= ${from.toISOString()}`,
				sql`${categorizedEvents.timestamp} < ${to.toISOString()}`
			)
		);

	const categorizedCount = Number(categorizedCountRows[0]?.count ?? 0);

	const staleCountRows = await db
		.select({ count: sql<number>`COUNT(*)` })
		.from(categorizedEvents)
		.where(
			and(
				eq(categorizedEvents.userId, userId),
				sql`${categorizedEvents.timestamp} >= ${from.toISOString()}`,
				sql`${categorizedEvents.timestamp} < ${to.toISOString()}`,
				sql`(${categorizedEvents.classifierVersion} < ${CLASSIFIER_VERSION} OR ${categorizedEvents.source} <> 'pipeline')`
			)
		);

	const staleCount = Number(staleCountRows[0]?.count ?? 0);

	if (categorizedCount < rawCount || staleCount > 0) {
		await syncCategorizedEventsForRange({ userId, from, to });
	}
}

export async function syncAllCategorizedEvents(userId: string): Promise<{ processed: number; synced: number }> {
	const bounds = await db
		.select({
			start: sql<Date>`MIN(${sensorEvents.timestamp})`,
			end: sql<Date>`MAX(${sensorEvents.timestamp})`,
			count: sql<number>`COUNT(*)`
		})
		.from(sensorEvents)
		.where(and(eq(sensorEvents.userId, userId), eq(sensorEvents.dataType, 'bank_transaction')));

	const count = Number(bounds[0]?.count ?? 0);
	if (count === 0 || !bounds[0]?.start || !bounds[0]?.end) {
		return { processed: 0, synced: 0 };
	}

	const from = new Date(bounds[0].start);
	const to = new Date(bounds[0].end);
	to.setDate(to.getDate() + 1);

	const synced = await syncCategorizedEventsForRange({ userId, from, to });
	return { processed: count, synced };
}

export async function syncCategorizedEventsForRange({ userId, from, to }: EnsureRangeArgs): Promise<number> {
	const rows = await db
		.select({
			sensorEventId: sensorEvents.id,
			timestamp: sensorEvents.timestamp,
			accountId: sql<string>`data->>'accountId'`,
			amount: sql<number>`(data->>'amount')::numeric`,
			description: sql<string>`data->>'description'`,
			typeText: sql<string>`COALESCE(data->>'typeText', data->>'category')`
		})
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'bank_transaction'),
				sql`${sensorEvents.timestamp} >= ${from.toISOString()}`,
				sql`${sensorEvents.timestamp} < ${to.toISOString()}`
			)
		)
		.orderBy(asc(sensorEvents.timestamp));

	if (rows.length === 0) return 0;

	const [merchantMappingCache, transactionOverrideCache, transactionRules] = await Promise.all([
		loadMerchantMappings(userId),
		loadClassificationOverrides(userId, 'transaction'),
		loadTransactionMatchingRules()
	]);

	let synced = 0;
	for (let i = 0; i < rows.length; i += UPSERT_CHUNK_SIZE) {
		const chunk = rows.slice(i, i + UPSERT_CHUNK_SIZE);
		const now = new Date();

		await db
			.insert(categorizedEvents)
			.values(
				chunk.map((row) => {
					const amount = Number(row.amount) || 0;
					const classified = categorizeTransaction(
						row.description,
						row.typeText,
						amount,
						merchantMappingCache,
						transactionOverrideCache,
						transactionRules
					);

					return {
						userId,
						sensorEventId: row.sensorEventId,
						timestamp: row.timestamp,
						accountId: row.accountId,
						amount: amount.toString(),
						description: row.description,
						typeText: row.typeText,
						resolvedCategory: classified.category,
						resolvedLabel: classified.label,
						resolvedEmoji: classified.emoji,
						isFixed: classified.isFixed,
						source: 'pipeline',
						classifierVersion: CLASSIFIER_VERSION,
						categorizedAt: now,
						updatedAt: now
					};
				})
			)
			.onConflictDoUpdate({
				target: [categorizedEvents.sensorEventId],
				set: {
					timestamp: sql`excluded.timestamp`,
					accountId: sql`excluded.account_id`,
					amount: sql`excluded.amount`,
					description: sql`excluded.description`,
					typeText: sql`excluded.type_text`,
					resolvedCategory: sql`excluded.resolved_category`,
					resolvedLabel: sql`excluded.resolved_label`,
					resolvedEmoji: sql`excluded.resolved_emoji`,
					isFixed: sql`excluded.is_fixed`,
					source: sql`excluded.source`,
					classifierVersion: sql`excluded.classifier_version`,
					categorizedAt: sql`excluded.categorized_at`,
					updatedAt: sql`excluded.updated_at`
				}
			});

		synced += chunk.length;
	}

	return synced;
}

export async function queryCategorizedEvents({
	userId,
	from,
	to,
	accountId,
	category,
	spendingOnly = false,
	limit,
	sortBy = 'date'
}: QueryCategorizedArgs): Promise<CategorizedEventRow[]> {
	const normalizedCategory = category ? normalizeCategoryId(category) : undefined;
	const baseQuery = db
		.select({
			sensorEventId: categorizedEvents.sensorEventId,
			timestamp: categorizedEvents.timestamp,
			accountId: categorizedEvents.accountId,
			amount: categorizedEvents.amount,
			description: categorizedEvents.description,
			typeText: categorizedEvents.typeText,
			resolvedCategory: categorizedEvents.resolvedCategory,
			resolvedLabel: categorizedEvents.resolvedLabel,
			resolvedEmoji: categorizedEvents.resolvedEmoji,
			isFixed: categorizedEvents.isFixed
		})
		.from(categorizedEvents)
		.where(
			and(
				eq(categorizedEvents.userId, userId),
				sql`${categorizedEvents.timestamp} >= ${from.toISOString()}`,
				sql`${categorizedEvents.timestamp} < ${to.toISOString()}`,
				...(accountId ? [eq(categorizedEvents.accountId, accountId)] : []),
				...(normalizedCategory ? [eq(categorizedEvents.resolvedCategory, normalizedCategory)] : []),
				...(spendingOnly ? [sql`${categorizedEvents.amount} < 0`] : [])
			)
		);

	const orderedQuery = sortBy === 'amount'
		? baseQuery.orderBy(desc(categorizedEvents.amount))
		: baseQuery.orderBy(desc(categorizedEvents.timestamp));

	const rows = limit && limit > 0
		? await orderedQuery.limit(limit)
		: await orderedQuery;

	return rows.map((row) => ({
		...row,
		amount: Number(row.amount) || 0
	}));
}
