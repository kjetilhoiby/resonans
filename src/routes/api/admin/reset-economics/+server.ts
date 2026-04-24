import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { requireAdmin } from '$lib/server/admin-auth';
import { sql } from 'drizzle-orm';

/**
 * DELETE /api/admin/reset-economics
 * Deletes ALL bank_balance and bank_transaction events
 * Used to start fresh with a re-import
 */
export const DELETE: RequestHandler = async ({ locals }) => {
	try {
		await requireAdmin(locals.userId);
		console.log('🗑️  Resetting economics data (full wipe for current user)...');

		const resultRows = await db.execute(sql`
			WITH deleted_categorized AS (
				DELETE FROM categorized_events
				WHERE user_id = ${locals.userId}
				RETURNING id
			), deleted_aliases AS (
				DELETE FROM canonical_bank_transaction_aliases a
				USING canonical_bank_transactions c
				WHERE a.canonical_id = c.id
				  AND c.user_id = ${locals.userId}
				RETURNING a.id
			), deleted_raw AS (
				DELETE FROM raw_bank_transaction_versions
				WHERE user_id = ${locals.userId}
				RETURNING id
			), deleted_canonical AS (
				DELETE FROM canonical_bank_transactions
				WHERE user_id = ${locals.userId}
				RETURNING id
			), deleted_sensor AS (
				DELETE FROM sensor_events
				WHERE user_id = ${locals.userId}
				  AND data_type IN ('bank_balance', 'bank_transaction')
				RETURNING id
			)
			SELECT
				(SELECT COUNT(*)::int FROM deleted_categorized) AS categorized_count,
				(SELECT COUNT(*)::int FROM deleted_aliases) AS alias_count,
				(SELECT COUNT(*)::int FROM deleted_raw) AS raw_count,
				(SELECT COUNT(*)::int FROM deleted_canonical) AS canonical_count,
				(SELECT COUNT(*)::int FROM deleted_sensor) AS sensor_count
		`);

		const row = Array.isArray(resultRows) ? resultRows[0] as {
			categorized_count?: number;
			alias_count?: number;
			raw_count?: number;
			canonical_count?: number;
			sensor_count?: number;
		} : {};

		const deleted = {
			categorizedEvents: Number(row?.categorized_count ?? 0),
			canonicalAliases: Number(row?.alias_count ?? 0),
			rawBankTransactionVersions: Number(row?.raw_count ?? 0),
			canonicalBankTransactions: Number(row?.canonical_count ?? 0),
			sensorEvents: Number(row?.sensor_count ?? 0)
		};

		const total =
			deleted.categorizedEvents +
			deleted.canonicalAliases +
			deleted.rawBankTransactionVersions +
			deleted.canonicalBankTransactions +
			deleted.sensorEvents;

		console.log('✅ Economics reset completed', { userId: locals.userId, deleted, total });

		return json({
			success: true,
			deleted,
			deletedCount: total,
			message: 'All economics data deleted. Ready for fresh import.'
		});
	} catch (err) {
		console.error('Reset economics error:', err);
		return json({ error: String(err) }, { status: 500 });
	}
};
