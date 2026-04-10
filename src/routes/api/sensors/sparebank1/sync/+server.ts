import { json } from '@sveltejs/kit';
import { syncAllSparebank1Data } from '$lib/server/integrations/sparebank1-sync';
import type { RequestHandler } from './$types';

/**
 * POST /api/sensors/sparebank1/sync
 * Manually trigger SpareBank1 data synchronization
 * Query params:
 * - from2020=true: sync from 2020-01-01
 * - days=1..365: sync last N days
 * - fullHistory=true: legacy alias for from2020=true
 */
export const POST: RequestHandler = async ({ url, locals }) => {
	try {
		const userId = locals.userId;
		const fullHistoryLegacy = url.searchParams.get('fullHistory') === 'true';
		const from2020 = fullHistoryLegacy || url.searchParams.get('from2020') === 'true';
		const daysParam = url.searchParams.get('days');

		let fromDate: Date | undefined;
		let modeLabel = 'Siste synk';

		if (from2020) {
			fromDate = new Date('2020-01-01T00:00:00.000Z');
			modeLabel = 'Fra 2020';
		} else if (daysParam !== null) {
			const days = Number.parseInt(daysParam, 10);
			if (!Number.isFinite(days) || days < 1 || days > 365) {
				return json({ success: false, error: 'days må være et heltall mellom 1 og 365' }, { status: 400 });
			}

			fromDate = new Date();
			fromDate.setDate(fromDate.getDate() - days);
			modeLabel = `Siste ${days} dager`;
		}

		const options = {
			includeDebug: true,
			...(fromDate ? { fromDate } : {})
		};

		const synced = await syncAllSparebank1Data(userId, options);

		return json({
			success: true,
			synced,
			from2020,
			days: daysParam ? Number.parseInt(daysParam, 10) : null,
			message: `${modeLabel}: Synkronisert ${synced.accounts} kontoer og ${synced.transactionEvents} transaksjoner`
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('SpareBank1 sync error:', message);
		return json({ success: false, error: message }, { status: 500 });
	}
};
