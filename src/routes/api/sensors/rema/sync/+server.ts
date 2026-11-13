import { json, error } from '@sveltejs/kit';
import { syncRemaForUser } from '$lib/server/integrations/rema-sync';
import type { RequestHandler } from './$types';

/**
 * POST /api/sensors/rema/sync — henter nye kvitteringer nå (samme tak per
 * kjøring som cron, så en førstegangssynk tar noen trykk eller noen timer).
 */
export const POST: RequestHandler = async ({ locals }) => {
	const userId = locals.userId;
	if (!userId) throw error(401, 'Ikke innlogget');

	try {
		const r = await syncRemaForUser(userId);
		const parts = [`Hentet ${r.imported} nye kvitteringer (${r.linesImported} varelinjer).`];
		if (r.remaining > 0) parts.push(`${r.remaining} eldre står igjen og hentes ved neste synk.`);
		if (r.failed > 0) parts.push(`${r.failed} kunne ikke hentes nå og prøves igjen.`);
		return json({ success: true, message: parts.join(' '), ...r });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error('[rema] manuell synk feilet:', msg);
		throw error(502, msg);
	}
};
