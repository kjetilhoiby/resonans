import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-auth';
import { buildSalaryProfileFromTransaction, nextPayday } from '$lib/server/integrations/salary-profile';

/**
 * POST /api/admin/salary-profile/from-transaction
 * Body: { transactionId: string }
 *
 * Builds a salary profile anchored to a single hand-picked transaction.
 * Use when automated detection picks the wrong transaction.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	await requireAdmin(locals.userId);

	const body = await request.json().catch(() => ({}));
	const { transactionId } = body as Record<string, unknown>;

	if (typeof transactionId !== 'string' || !transactionId.trim()) {
		return json({ error: 'transactionId er påkrevd' }, { status: 400 });
	}

	const profile = await buildSalaryProfileFromTransaction(locals.userId, transactionId.trim());
	if (!profile) {
		return json(
			{ error: 'Fant ikke transaksjonen eller tilgang nektet.' },
			{ status: 404 }
		);
	}

	const predictedNextPayday = nextPayday(profile).toISOString().split('T')[0];
	return json({ success: true, profile, predictedNextPayday });
};
