import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createDefaultPlan } from '$lib/server/tracks/repository';
import { getTrackFullProgram } from '$lib/server/tracks/adapter';

interface GenerateBody {
	goal?: unknown;
}

/**
 * POST /api/apps/programs/generate
 *
 * Treningsløp-modellen: «generering» er nå bootstrap av brukerens plan med to
 * progresjonsløp (styrke + utholdenhet) — intet LLM-kall, ingen pre-generert
 * øktstruktur. Idempotent: eksisterende aktiv plan returneres. Response-shape
 * er den samme som den gamle LLM-genereringen ({ok, programId, model, program}),
 * så Ekko trenger ingen endringer. Legacy-programmer forblir lesbare via de
 * andre endepunktene.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	let body: GenerateBody;
	try {
		body = (await request.json()) as GenerateBody;
	} catch {
		throw error(400, 'Invalid JSON body');
	}

	const goal = typeof body.goal === 'string' ? body.goal.trim() : '';
	if (!goal) throw error(400, 'Missing "goal" field');

	const { plan } = await createDefaultPlan(userId, {});
	const full = await getTrackFullProgram(userId, plan);

	return json({
		ok: true,
		programId: plan.id,
		model: 'tracks-v1',
		program: full,
		snapshot: null
	});
};
