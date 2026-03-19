import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sql } from 'drizzle-orm';

/**
 * DELETE /api/admin/reset-economics
 * Deletes ALL bank_balance and bank_transaction events
 * Used to start fresh with a re-import
 */
export const DELETE: RequestHandler = async () => {
	try {
		console.log('🗑️  Resetting economics data (deleting all bank events)...');

		// Count before deletion
		const beforeCount = await db.execute(sql`
			SELECT count(*)::int as count
			FROM sensor_events
			WHERE data_type IN ('bank_balance', 'bank_transaction')
		`);

		const count = Array.isArray(beforeCount) ? beforeCount[0]?.count : 0;

		// Delete all bank events using raw SQL
		await db.execute(sql`
			DELETE FROM sensor_events
			WHERE data_type IN ('bank_balance', 'bank_transaction')
		`);

		console.log(`✅ Deleted ${count} economics events`);

		return json({
			success: true,
			deletedCount: count,
			message: 'All bank data deleted. Ready for fresh import.'
		});
	} catch (err) {
		console.error('Reset economics error:', err);
		return json({ error: String(err) }, { status: 500 });
	}
};
