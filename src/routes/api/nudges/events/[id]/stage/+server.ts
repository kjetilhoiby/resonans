import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { markNudgeFlowCompleted, markNudgeFlowStarted } from '$lib/server/nudge-events';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const userId = locals.userId;
	if (!userId) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json().catch(() => ({}))) as { stage?: string };
	const stage = body.stage;

	if (stage === 'flow_started') {
		await markNudgeFlowStarted(params.id, userId);
		return json({ ok: true });
	}

	if (stage === 'flow_completed') {
		await markNudgeFlowCompleted(params.id, userId);
		return json({ ok: true });
	}

	return json({ error: 'Invalid stage' }, { status: 400 });
};
