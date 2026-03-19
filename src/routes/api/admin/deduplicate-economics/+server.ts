import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sql } from 'drizzle-orm';

/**
 * POST /api/admin/deduplicate-economics
 * Removes duplicate bank_balance and bank_transaction events
 * Keeps the oldest entry for each unique combination
 */
export const POST: RequestHandler = async () => {
	try {
		console.log('🔍 Finding and removing duplicates...');

		// Remove duplicate balance events (same accountId + date)
		const balanceDuplicates = await db.execute(sql`
			WITH ranked AS (
				SELECT 
					id,
					ROW_NUMBER() OVER (
						PARTITION BY data->>'accountId', timestamp::date 
						ORDER BY timestamp ASC
					) as rn
				FROM sensor_events
				WHERE data_type = 'bank_balance'
			)
			DELETE FROM sensor_events
			WHERE id IN (
				SELECT id FROM ranked WHERE rn > 1
			)
			RETURNING id
		`);

		// Remove duplicate transactions (same transactionId)
		const transactionDuplicates = await db.execute(sql`
			WITH ranked AS (
				SELECT 
					id,
					ROW_NUMBER() OVER (
						PARTITION BY metadata->>'transactionId' 
						ORDER BY timestamp ASC
					) as rn
				FROM sensor_events
				WHERE data_type = 'bank_transaction'
				AND metadata->>'transactionId' IS NOT NULL
			)
			DELETE FROM sensor_events
			WHERE id IN (
				SELECT id FROM ranked WHERE rn > 1
			)
			RETURNING id
		`);

		const balanceCount = Array.isArray(balanceDuplicates) ? balanceDuplicates.length : 0;
		const transactionCount = Array.isArray(transactionDuplicates) ? transactionDuplicates.length : 0;

		console.log(`✅ Removed ${balanceCount} duplicate balance events and ${transactionCount} duplicate transactions`);

		return json({
			success: true,
			removed: {
				balanceEvents: balanceCount,
				transactionEvents: transactionCount,
				total: balanceCount + transactionCount
			},
			message: `Slettet ${balanceCount + transactionCount} duplikater`
		});
	} catch (err) {
		console.error('Deduplicate error:', err);
		return json({ error: String(err) }, { status: 500 });
	}
};
