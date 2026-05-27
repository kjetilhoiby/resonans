import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { programSessions, programTestResults } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { completePlannedSession } from '$lib/server/programs/repository';
import { applyProgression } from '$lib/server/programs/progression';
import { maybeRecalibrate } from '$lib/server/programs/recalibration';
import { isProgramTestType, type ProgramTestType } from '$lib/server/programs/types';

interface CompleteBody {
	plannedSessionId?: unknown;
	sensorEventId?: unknown;
	completedAt?: unknown;
	/** For test-økter: brukerens målte resultat. Kreves når session.isTest=true. */
	testResult?: {
		cooper12minMeters?: number;
		time5kSeconds?: number;
		time10kSeconds?: number;
		amrapReps?: number;
		holdSeconds?: number;
	};
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

	// Sjekk om dette er en test-økt — i så fall: lagre testResult, kjør rekalibrering
	const sessionRow = await db.query.programSessions.findFirst({
		where: eq(programSessions.id, plannedSessionId),
		columns: { isTest: true, testType: true }
	});
	const isTest = sessionRow?.isTest === true && isProgramTestType(sessionRow.testType);

	let recalibration: { applied: boolean; deviation?: number; summary: string[] } | undefined;
	if (isTest && body.testResult) {
		const testType = sessionRow!.testType as ProgramTestType;
		await db.insert(programTestResults).values({
			userId,
			programId: params.id,
			sessionId: plannedSessionId,
			sensorEventId,
			testType,
			recordedAt: completedAt ?? new Date(),
			result: body.testResult
		});
		const outcome = await maybeRecalibrate({
			programId: params.id,
			plannedSessionId,
			test: { testType, result: body.testResult }
		});
		recalibration = {
			applied: outcome.applied,
			deviation: outcome.deviation,
			summary: outcome.summary
		};
	}

	const progressionSummary = !isTest
		? await applyProgression({
				programId: params.id,
				plannedSessionId,
				completion: result.completion
			})
		: [];

	return json({
		ok: true,
		completion: result.completion,
		plannedSession: result.plannedSession,
		progression: {
			applied: progressionSummary.length > 0,
			summary: progressionSummary
		},
		recalibration
	});
};
