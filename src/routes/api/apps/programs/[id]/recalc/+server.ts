import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runWeeklyAdaptation } from '$lib/server/programs/adaptive-service';

/**
 * POST /api/apps/programs/[id]/recalc
 * Kjør den adaptive justeringen umiddelbart (samme logikk som den ukentlige
 * cron-jobben), i stedet for å vente til søndag. Evaluerer inneværende
 * kalenderuke så langt og justerer neste uke. Krever at programmet er aktivt
 * og i adaptiv modus — ellers returneres `skipped` uten endringer.
 */
export const POST: RequestHandler = async ({ locals, params, url }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const result = await runWeeklyAdaptation({
		userId,
		programId: params.id,
		appUrl: url.origin
	});

	if (!result) return json({ error: 'Program not found', code: 'program_not_found' }, { status: 404 });

	return json({
		ok: true,
		evaluatedWeek: result.evaluatedWeek,
		adjustedWeek: result.adjustedWeek,
		adaptations: result.adaptations,
		notified: result.notified ?? null,
		skipped: result.skipped ?? null
	});
};
