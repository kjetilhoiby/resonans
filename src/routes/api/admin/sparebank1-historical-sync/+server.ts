import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-auth';
import { enqueueBackgroundJob } from '$lib/server/background-jobs';
import type { RequestHandler } from './$types';

export const config = { maxDuration: 30 };

/**
 * Historical sync for SpareBank 1 — queues an async job.
 * POST /api/admin/sparebank1-historical-sync
 * Body: { fromDate: "2025-01-01" }  (optional, defaults to 2025-01-01)
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		await requireAdmin(locals.userId);
		const body = await request.json().catch(() => ({}));
		const fromDateStr: string = body.fromDate ?? '2025-01-01';
		const replaceAll = body.replaceAll !== false;
		const fromDate = new Date(fromDateStr);

		if (isNaN(fromDate.getTime())) {
			return json({ error: `Invalid fromDate: ${fromDateStr}` }, { status: 400 });
		}

		const userId = locals.userId;
		const job = await enqueueBackgroundJob({
			userId,
			type: 'sparebank1_historical_sync',
			payload: { fromDate: fromDateStr, replaceAll },
			priority: 10,
			maxAttempts: 3
		});

		return json(
			{
				success: true,
				queued: true,
				job,
				message: `Historisk synk er lagt i kø fra ${fromDateStr}${replaceAll ? ' (erstatter eksisterende data)' : ''}.`
			},
			{ status: 202 }
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('[SB1 historical sync] Error:', message);
		return json({ success: false, error: message }, { status: 500 });
	}
};
