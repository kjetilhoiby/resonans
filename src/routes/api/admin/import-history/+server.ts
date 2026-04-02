import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { requireAdmin } from '$lib/server/admin-auth';
import { sql } from 'drizzle-orm';

export const GET: RequestHandler = async ({ locals }) => {
	try {
		await requireAdmin(locals.userId);
		// Check if we have ANY events with metadata->source field
		const sourceCounts = await db.execute(sql`
			SELECT 
				metadata->>'source' as source,
				data_type,
				count(*)::int as count,
				min(timestamp::date)::text as "minDate",
				max(timestamp::date)::text as "maxDate"
			FROM sensor_events
			WHERE data_type IN ('bank_balance', 'bank_transaction')
			AND user_id = ${locals.userId}
			GROUP BY metadata->>'source', data_type
			ORDER BY count DESC
		`);

		// Check total events by data_type
		const totalCounts = await db.execute(sql`
			SELECT 
				data_type,
				count(*)::int as total,
				min(timestamp::date)::text as "minDate",
				max(timestamp::date)::text as "maxDate"
			FROM sensor_events
			WHERE data_type IN ('bank_balance', 'bank_transaction')
			AND user_id = ${locals.userId}
			GROUP BY data_type
		`);

		// Check if metadata column exists and has any data
		const metadataCheck = await db.execute(sql`
			SELECT 
				count(*) FILTER (WHERE metadata IS NOT NULL)::int as "withMetadata",
				count(*) FILTER (WHERE metadata IS NULL)::int as "withoutMetadata",
				count(*) FILTER (WHERE metadata->>'source' IS NOT NULL)::int as "withSource"
			FROM sensor_events
			WHERE data_type IN ('bank_balance', 'bank_transaction')
			AND user_id = ${locals.userId}
		`);

		return json({
			sourceCounts,
			totalCounts,
			metadataCheck,
			message: 'If all source values are null, PDF import may never have run or metadata was not saved'
		});
	} catch (err) {
		console.error('import-history error:', err);
		return json({ error: String(err) }, { status: 500 });
	}
};
