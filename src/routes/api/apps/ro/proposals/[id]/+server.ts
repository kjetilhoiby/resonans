import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { answerSessionProposal } from '$lib/server/ro/ro-service';

/**
 * POST /api/apps/ro/proposals/{noteId} — ja eller nei til en foreslått hypotese.
 *
 * Body: { accept: boolean }
 *
 * En hypotese blir bare en del av profilen når brukeren har sagt ja. Et nei lagres
 * også, så den samme lesningen ikke foreslås igjen neste uke.
 */
export const POST: RequestHandler = async ({ locals, request, params }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	let body: { accept?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	if (typeof body.accept !== 'boolean') {
		return json({ error: 'accept must be a boolean', code: 'missing_accept' }, { status: 400 });
	}
	const ok = await answerSessionProposal(userId, params.id, body.accept);
	if (!ok) return json({ error: 'Proposal not found', code: 'proposal_not_found' }, { status: 404 });
	return json({ ok: true });
};
