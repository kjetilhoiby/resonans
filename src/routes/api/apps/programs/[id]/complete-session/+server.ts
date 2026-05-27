import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { completePlannedSession } from '$lib/server/programs/repository';
import { applyProgression } from '$lib/server/programs/progression';

interface CompleteBody {
	plannedSessionId?: unknown;
	sensorEventId?: unknown;
	completedAt?: unknown;
}

export const POST: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	let body: CompleteBody;
	try {
		body = (await request.json()) as CompleteBody;
	} catch {
		throw error(400, 'Invalid JSON body');
	}

	const plannedSessionId = typeof body.plannedSessionId === 'string' ? body.plannedSessionId : null;
	if (!plannedSessionId) throw error(400, 'Missing "plannedSessionId"');

	const sensorEventId = typeof body.sensorEventId === 'string' ? body.sensorEventId : null;
	let completedAt: Date | undefined;
	if (typeof body.completedAt === 'string') {
		const parsed = new Date(body.completedAt);
		if (!isNaN(parsed.getTime())) completedAt = parsed;
	}

	const result = await completePlannedSession({
		userId,
		programId: params.id,
		plannedSessionId,
		sensorEventId,
		completedAt
	});

	if (!result) {
		return json({ error: 'Planned session not found', code: 'session_not_found' }, { status: 404 });
	}

	const progressionSummary = await applyProgression({
		programId: params.id,
		plannedSessionId,
		completion: result.completion
	});

	return json({
		ok: true,
		completion: result.completion,
		plannedSession: result.plannedSession,
		progression: {
			applied: progressionSummary.length > 0,
			summary: progressionSummary
		}
	});
};
