import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { loadClassificationOverrides, loadTransactionMatchingRules } from '$lib/server/classification-overrides';
import { loadMerchantMappings } from '$lib/server/integrations/spending-analyzer';
import { categorizeTransaction } from '$lib/server/integrations/transaction-categories';
import { and, eq, sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals }) => {
	const userId = locals.userId;

	// Load caches
	const [merchantMappings, overrides, transactionRules] = await Promise.all([
		loadMerchantMappings(userId),
		loadClassificationOverrides(userId, 'transaction'),
		loadTransactionMatchingRules()
	]);

	// Fetch all user's transactions from sensorEvents
	const txRows = await db
		.select({
			id: sensorEvents.id,
			timestamp: sensorEvents.timestamp,
			amount: sql<number>`(data->>'amount')::numeric`,
			description: sql<string>`data->>'description'`,
			typeText: sql<string>`data->>'category'`,
			currentCategory: sql<string>`data->>'correctedCategory'`
		})
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'bank_transaction')
			)
		);

	let updated = 0;

	// Recategorize each transaction
	for (const tx of txRows) {
		const description = tx.description ?? '';
		const typeText = tx.typeText ?? '';
		const amount = Number(tx.amount) || 0;

		const newCategory = categorizeTransaction(
			description,
			typeText,
			amount,
			merchantMappings,
			overrides,
			transactionRules
		);

		if (newCategory.category !== tx.currentCategory) {
			await db
				.update(sensorEvents)
				.set({
					data: sql`jsonb_set(data, '{correctedCategory}', ${JSON.stringify(newCategory.category)})`
				})
				.where(eq(sensorEvents.id, tx.id));
			updated++;
		}
	}

	return json({
		processed: txRows.length,
		updated
	});
};
