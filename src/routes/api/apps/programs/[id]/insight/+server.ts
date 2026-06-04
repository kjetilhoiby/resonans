import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildProgramInsight, type ProgramInsightScope } from '$lib/server/programs/insight';

const VALID_SCOPES: ProgramInsightScope[] = ['week', 'progression'];

/**
 * POST /api/apps/programs/:id/insight
 *
 * Strukturert programinnsikt for Ekko-klienten («Innsikt»-arket).
 * Body (camelCase): { scope: "week" | "progression", weekNumber?: number | null }
 * Respons: { ok, scope, title?, summary, highlights? } — `summary` er alltid satt.
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	let body: { scope?: unknown; weekNumber?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const scope = body.scope;
	if (typeof scope !== 'string' || !VALID_SCOPES.includes(scope as ProgramInsightScope)) {
		return json(
			{ error: 'Invalid scope — must be "week" or "progression"', code: 'invalid_scope' },
			{ status: 400 }
		);
	}

	let weekNumber: number | null = null;
	if (body.weekNumber != null) {
		const n = Number(body.weekNumber);
		if (!Number.isInteger(n) || n < 1) {
			return json({ error: 'weekNumber must be a positive integer' }, { status: 400 });
		}
		weekNumber = n;
	}

	const result = await buildProgramInsight(userId, params.id, scope as ProgramInsightScope, weekNumber);
	if (!result) {
		return json({ error: 'Program not found', code: 'program_not_found' }, { status: 404 });
	}

	return json({
		ok: true,
		scope: result.scope,
		title: result.title,
		summary: result.summary,
		highlights: result.highlights
	});
};
