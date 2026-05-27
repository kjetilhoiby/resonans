import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { programSessions, programWeeks, trainingPrograms } from '$lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { isProgramTestType, type ProgramTestType } from '$lib/server/programs/types';

interface InsertTestBody {
	testType?: unknown;
	weekNumber?: unknown;
	dayNumber?: unknown;
}

/**
 * POST /api/apps/programs/:id/insert-test
 *
 * Setter inn en test-økt i en eksisterende uke. Brukes når brukeren vil
 * teste seg manuelt midt i et program — f.eks. for å fange en uventet
 * fremgang og rekalibrere resterende uker.
 *
 * Krav: dayNumber må være ledig i uken (test erstatter ikke en planlagt økt).
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	let body: InsertTestBody;
	try {
		body = (await request.json()) as InsertTestBody;
	} catch {
		throw error(400, 'Invalid JSON body');
	}

	if (!isProgramTestType(body.testType)) {
		throw error(400, 'Ugyldig eller manglende testType');
	}
	const testType = body.testType as ProgramTestType;

	const weekNumber = typeof body.weekNumber === 'number' ? Math.round(body.weekNumber) : null;
	const dayNumber = typeof body.dayNumber === 'number' ? Math.round(body.dayNumber) : null;
	if (!weekNumber || weekNumber < 1 || !dayNumber || dayNumber < 1 || dayNumber > 7) {
		throw error(400, 'Ugyldig weekNumber/dayNumber');
	}

	const program = await db.query.trainingPrograms.findFirst({
		where: and(eq(trainingPrograms.id, params.id), eq(trainingPrograms.userId, userId)),
		columns: { id: true, durationWeeks: true }
	});
	if (!program) return json({ error: 'Program not found', code: 'program_not_found' }, { status: 404 });
	if (weekNumber > program.durationWeeks) {
		throw error(400, `Ukenummer ${weekNumber} er utenfor programmets ${program.durationWeeks} uker`);
	}

	const week = await db.query.programWeeks.findFirst({
		where: and(eq(programWeeks.programId, params.id), eq(programWeeks.weekNumber, weekNumber)),
		columns: { id: true }
	});
	if (!week) return json({ error: 'Week not found', code: 'week_not_found' }, { status: 404 });

	// Krev ledig dayNumber
	const existing = await db.query.programSessions.findFirst({
		where: and(eq(programSessions.weekId, week.id), eq(programSessions.dayNumber, dayNumber)),
		columns: { id: true }
	});
	if (existing) {
		throw error(409, `Dag ${dayNumber} i uke ${weekNumber} har allerede en planlagt økt`);
	}

	const runTests = ['cooper_12min', 'time_5k', 'time_10k'];
	const kind = runTests.includes(testType) ? 'run' : 'strength';

	const sessionInsert = {
		weekId: week.id,
		programId: params.id,
		dayNumber,
		kind,
		name: testNameFromType(testType),
		isTest: true,
		testType,
		plannedRun:
			kind === 'run'
				? testType === 'cooper_12min'
					? { runType: 'tempo' as const, targetDurationSeconds: 12 * 60, warmupSeconds: 600, cooldownSeconds: 300 }
					: testType === 'time_5k'
						? { runType: 'tempo' as const, targetDistanceMeters: 5000, warmupSeconds: 600, cooldownSeconds: 300 }
						: { runType: 'long' as const, targetDistanceMeters: 10000, warmupSeconds: 600, cooldownSeconds: 300 }
				: null
	};
	const [newSession] = await db.insert(programSessions).values(sessionInsert).returning({ id: programSessions.id });

	if (kind === 'strength') {
		const { programExercises } = await import('$lib/db/schema');
		const exerciseName = strengthExerciseFromTest(testType);
		if (exerciseName) {
			await db.insert(programExercises).values({
				sessionId: newSession.id,
				order: 1,
				exerciseName,
				sets: 1,
				repsTarget: exerciseName !== 'Planke' ? 1 : null,
				durationSecondsTarget: exerciseName === 'Planke' ? 1 : null,
				notes: 'AMRAP/max-test — gjør så mye som mulig på ett sett'
			});
		}
	}

	return json({ ok: true, sessionId: newSession.id, kind, testType });
};

function testNameFromType(testType: ProgramTestType): string {
	switch (testType) {
		case 'cooper_12min':
			return 'Test: Cooper 12 min';
		case 'time_5k':
			return 'Test: 5 km tempo';
		case 'time_10k':
			return 'Test: 10 km tempo';
		case 'amrap_utfall':
			return 'Test: AMRAP Utfall';
		case 'amrap_armhevinger':
			return 'Test: AMRAP Armhevinger';
		case 'amrap_taahevinger':
			return 'Test: AMRAP Tåhevinger';
		case 'max_planke':
			return 'Test: Max Planke';
	}
}

function strengthExerciseFromTest(testType: ProgramTestType): string | null {
	switch (testType) {
		case 'amrap_utfall':
			return 'Utfall';
		case 'amrap_armhevinger':
			return 'Armhevinger';
		case 'amrap_taahevinger':
			return 'Tåhevinger';
		case 'max_planke':
			return 'Planke';
		default:
			return null;
	}
}
