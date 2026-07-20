import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { suggestLunchboxComponents } from '$lib/server/services/lunchbox-suggest-service';
import type { ComponentKind } from '$lib/domains/food/lunchbox';

const VALID_KINDS = ['palegg', 'brod', 'frukt', 'gront', 'notter', 'annet'];

// POST /api/food/lunchbox/suggest-components — AI-forslag til nye komponenter
// (familiens preferanser, biblioteket de har, og hva som kommer i retur).
// Lagrer ingenting. Body: { kind?, instruction? }
export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	const body = await request.json().catch(() => ({}));

	const kind = typeof body.kind === 'string' && VALID_KINDS.includes(body.kind) ? (body.kind as ComponentKind) : null;

	const result = await suggestLunchboxComponents(userId, {
		kind,
		instruction: typeof body.instruction === 'string' ? body.instruction : null
	});

	if (!result.ok) return json({ error: result.error }, { status: result.status });
	return json({ suggestions: result.suggestions });
};
