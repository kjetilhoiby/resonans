import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-auth';
import { buildSalaryProfile } from '$lib/server/integrations/salary-profile';

/**
 * POST /api/admin/salary-profile/rebuild
 * Rebuilds the salary profile from historical transaction data.
 * Use this after a full re-import or if the employer has changed.
 */
export const POST: RequestHandler = async ({ locals }) => {
	await requireAdmin(locals.userId);

	try {
		const profile = await buildSalaryProfile(locals.userId);
		if (!profile) {
			return json(
				{ error: 'Ikke nok historikk til å bygge lønnsprofile. Kjør historisk synk først.' },
				{ status: 422 }
			);
		}
		return json({ success: true, profile });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Ukjent feil';
		return json({ error: message }, { status: 500 });
	}
};
