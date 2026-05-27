import { db } from '$lib/db';
import {
	programExercises,
	programSessionCompletions,
	programSessions,
	programWeeks,
	sensorEvents,
	trainingPrograms
} from '$lib/db/schema';
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import type {
	PlannedExerciseDTO,
	PlannedRunDTO,
	ProgramActuals,
	ProgramDTO,
	ProgramSessionDTO,
	ProgramSummaryDTO,
	ProgramWeekDTO,
	SessionCompletionDTO
} from './types';
import {
	STRENGTH_EXERCISE_NAMES,
	isProgramStatus,
	type ProgramStatus
} from './constants';

function todayISODate(): string {
	return new Date().toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
	const d = new Date(iso + 'T00:00:00Z');
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

/**
 * Returnerer ISO-dato for en planlagt økt (basert på programmets startDate).
 * Antar mandag som dag 1 i programmet, og uke 1 starter på startDate.
 */
export function sessionPlannedDate(programStartDate: string, weekNumber: number, dayNumber: number): string {
	const offset = (weekNumber - 1) * 7 + (dayNumber - 1);
	return addDays(programStartDate, offset);
}

export async function saveGeneratedProgram(
	userId: string,
	program: ProgramDTO
): Promise<string> {
	const [createdProgram] = await db
		.insert(trainingPrograms)
		.values({
			userId,
			name: program.name,
			goal: program.goal,
			durationWeeks: program.durationWeeks,
			sessionsPerWeek: program.sessionsPerWeek,
			status: program.status,
			includeStrength: program.includeStrength,
			includeRunning: program.includeRunning,
			startDate: program.startDate,
			generatedWith: program.generatedWith ?? null
		})
		.returning({ id: trainingPrograms.id });

	const programId = createdProgram.id;

	for (const week of program.weeks) {
		const [createdWeek] = await db
			.insert(programWeeks)
			.values({
				programId,
				weekNumber: week.weekNumber,
				deload: week.deload,
				notes: week.notes ?? null
			})
			.returning({ id: programWeeks.id });

		for (const session of week.sessions) {
			const [createdSession] = await db
				.insert(programSessions)
				.values({
					weekId: createdWeek.id,
					programId,
					dayNumber: session.dayNumber,
					kind: session.kind,
					name: session.name,
					restSeconds: session.restSeconds ?? null,
					plannedRun: session.plannedRun ?? null,
					notes: session.notes ?? null
				})
				.returning({ id: programSessions.id });

			if (session.kind === 'strength' && session.plannedExercises?.length) {
				await db.insert(programExercises).values(
					session.plannedExercises.map((ex) => ({
						sessionId: createdSession.id,
						order: ex.order,
						exerciseName: ex.exerciseName,
						sets: ex.sets,
						repsTarget: ex.repsTarget ?? null,
						durationSecondsTarget: ex.durationSecondsTarget ?? null,
						weightHint: ex.weightHint ?? null,
						notes: ex.notes ?? null
					}))
				);
			}
		}
	}

	return programId;
}

export async function getProgramSummaries(userId: string): Promise<ProgramSummaryDTO[]> {
	const rows = await db.query.trainingPrograms.findMany({
		where: eq(trainingPrograms.userId, userId),
		orderBy: [desc(trainingPrograms.createdAt)]
	});

	if (rows.length === 0) return [];

	const programIds = rows.map((r) => r.id);

	// Total sessions per program
	const totals = await db
		.select({
			programId: programSessions.programId,
			total: count()
		})
		.from(programSessions)
		.where(sql`${programSessions.programId} IN ${programIds}`)
		.groupBy(programSessions.programId);

	const completed = await db
		.select({
			programId: programSessionCompletions.programId,
			completed: count()
		})
		.from(programSessionCompletions)
		.where(sql`${programSessionCompletions.programId} IN ${programIds}`)
		.groupBy(programSessionCompletions.programId);

	const totalsMap = new Map(totals.map((t) => [t.programId, Number(t.total)]));
	const completedMap = new Map(completed.map((c) => [c.programId, Number(c.completed)]));

	return rows.map((r) => ({
		id: r.id,
		name: r.name,
		goal: r.goal,
		durationWeeks: r.durationWeeks,
		sessionsPerWeek: r.sessionsPerWeek,
		status: (isProgramStatus(r.status) ? r.status : 'active') as ProgramStatus,
		startDate: typeof r.startDate === 'string' ? r.startDate : new Date(r.startDate as unknown as Date).toISOString().slice(0, 10),
		includeStrength: r.includeStrength,
		includeRunning: r.includeRunning,
		createdAt: r.createdAt.toISOString(),
		completedSessions: completedMap.get(r.id) ?? 0,
		totalSessions: totalsMap.get(r.id) ?? 0
	}));
}

export async function getFullProgram(userId: string, programId: string): Promise<ProgramDTO | null> {
	const program = await db.query.trainingPrograms.findFirst({
		where: and(eq(trainingPrograms.id, programId), eq(trainingPrograms.userId, userId))
	});
	if (!program) return null;

	const weeks = await db.query.programWeeks.findMany({
		where: eq(programWeeks.programId, programId),
		orderBy: [asc(programWeeks.weekNumber)]
	});

	const sessions = await db.query.programSessions.findMany({
		where: eq(programSessions.programId, programId),
		orderBy: [asc(programSessions.dayNumber)]
	});

	const sessionIds = sessions.map((s) => s.id);
	const exercises = sessionIds.length === 0 ? [] : await db.query.programExercises.findMany({
		where: sql`${programExercises.sessionId} IN ${sessionIds}`,
		orderBy: [asc(programExercises.order)]
	});

	const completions = sessionIds.length === 0 ? [] : await db.query.programSessionCompletions.findMany({
		where: sql`${programSessionCompletions.plannedSessionId} IN ${sessionIds}`
	});

	const exercisesBySession = new Map<string, PlannedExerciseDTO[]>();
	for (const e of exercises) {
		const list = exercisesBySession.get(e.sessionId) ?? [];
		list.push({
			id: e.id,
			order: e.order,
			exerciseName: e.exerciseName,
			sets: e.sets,
			repsTarget: e.repsTarget ?? undefined,
			durationSecondsTarget: e.durationSecondsTarget ?? undefined,
			weightHint: e.weightHint ?? undefined,
			notes: e.notes ?? undefined
		});
		exercisesBySession.set(e.sessionId, list);
	}

	const completionsBySession = new Map<string, SessionCompletionDTO>();
	for (const c of completions) {
		completionsBySession.set(c.plannedSessionId, {
			id: c.id,
			plannedSessionId: c.plannedSessionId,
			sensorEventId: c.sensorEventId,
			completedAt: c.completedAt.toISOString(),
			actuals: c.actuals ?? undefined
		});
	}

	const sessionsByWeek = new Map<string, ProgramSessionDTO[]>();
	for (const s of sessions) {
		const session: ProgramSessionDTO = {
			id: s.id,
			weekNumber: weeks.find((w) => w.id === s.weekId)?.weekNumber ?? 0,
			dayNumber: s.dayNumber,
			kind: s.kind === 'run' ? 'run' : 'strength',
			name: s.name,
			restSeconds: s.restSeconds ?? undefined,
			plannedRun: (s.plannedRun as PlannedRunDTO) ?? undefined,
			notes: s.notes ?? undefined,
			plannedExercises: exercisesBySession.get(s.id),
			completion: completionsBySession.get(s.id) ?? null
		};
		const arr = sessionsByWeek.get(s.weekId) ?? [];
		arr.push(session);
		sessionsByWeek.set(s.weekId, arr);
	}

	const weeksDTO: ProgramWeekDTO[] = weeks.map((w) => ({
		id: w.id,
		weekNumber: w.weekNumber,
		deload: w.deload,
		notes: w.notes ?? undefined,
		sessions: (sessionsByWeek.get(w.id) ?? []).sort((a, b) => a.dayNumber - b.dayNumber)
	}));

	return {
		id: program.id,
		userId: program.userId,
		name: program.name,
		goal: program.goal,
		durationWeeks: program.durationWeeks,
		sessionsPerWeek: program.sessionsPerWeek,
		status: (isProgramStatus(program.status) ? program.status : 'active') as ProgramStatus,
		includeStrength: program.includeStrength,
		includeRunning: program.includeRunning,
		startDate: typeof program.startDate === 'string'
			? program.startDate
			: new Date(program.startDate as unknown as Date).toISOString().slice(0, 10),
		createdAt: program.createdAt.toISOString(),
		updatedAt: program.updatedAt.toISOString(),
		generatedWith: program.generatedWith ?? null,
		weeks: weeksDTO
	};
}

/**
 * Finn dagens planlagte økt for et program — basert på programmets startDate.
 * Returnerer null hvis ingen økt planlagt i dag.
 */
export async function getTodaySession(
	userId: string,
	programId: string,
	dateISO: string = todayISODate()
): Promise<{ session: ProgramSessionDTO; weekNumber: number; programStartDate: string } | null> {
	const program = await db.query.trainingPrograms.findFirst({
		where: and(eq(trainingPrograms.id, programId), eq(trainingPrograms.userId, userId)),
		columns: { id: true, startDate: true, durationWeeks: true }
	});
	if (!program) return null;

	const startDate = typeof program.startDate === 'string'
		? program.startDate
		: new Date(program.startDate as unknown as Date).toISOString().slice(0, 10);

	const startMs = new Date(startDate + 'T00:00:00Z').getTime();
	const todayMs = new Date(dateISO + 'T00:00:00Z').getTime();
	const dayOffset = Math.floor((todayMs - startMs) / (1000 * 60 * 60 * 24));
	if (dayOffset < 0) return null;

	const weekNumber = Math.floor(dayOffset / 7) + 1;
	if (weekNumber > program.durationWeeks) return null;
	const dayNumber = (dayOffset % 7) + 1;

	const week = await db.query.programWeeks.findFirst({
		where: and(eq(programWeeks.programId, programId), eq(programWeeks.weekNumber, weekNumber)),
		columns: { id: true }
	});
	if (!week) return null;

	const session = await db.query.programSessions.findFirst({
		where: and(eq(programSessions.weekId, week.id), eq(programSessions.dayNumber, dayNumber))
	});
	if (!session) return null;

	const exercises = session.kind === 'strength'
		? await db.query.programExercises.findMany({
				where: eq(programExercises.sessionId, session.id),
				orderBy: [asc(programExercises.order)]
		  })
		: [];

	const completion = await db.query.programSessionCompletions.findFirst({
		where: eq(programSessionCompletions.plannedSessionId, session.id)
	});

	return {
		weekNumber,
		programStartDate: startDate,
		session: {
			id: session.id,
			weekNumber,
			dayNumber: session.dayNumber,
			kind: session.kind === 'run' ? 'run' : 'strength',
			name: session.name,
			restSeconds: session.restSeconds ?? undefined,
			plannedRun: (session.plannedRun as PlannedRunDTO) ?? undefined,
			notes: session.notes ?? undefined,
			plannedExercises: exercises.map((e) => ({
				id: e.id,
				order: e.order,
				exerciseName: e.exerciseName,
				sets: e.sets,
				repsTarget: e.repsTarget ?? undefined,
				durationSecondsTarget: e.durationSecondsTarget ?? undefined,
				weightHint: e.weightHint ?? undefined,
				notes: e.notes ?? undefined
			})),
			completion: completion
				? {
						id: completion.id,
						plannedSessionId: completion.plannedSessionId,
						sensorEventId: completion.sensorEventId,
						completedAt: completion.completedAt.toISOString(),
						actuals: completion.actuals ?? undefined
				  }
				: null
		}
	};
}

export async function setProgramStatus(
	userId: string,
	programId: string,
	status: ProgramStatus
): Promise<boolean> {
	const updated = await db
		.update(trainingPrograms)
		.set({ status, updatedAt: new Date() })
		.where(and(eq(trainingPrograms.id, programId), eq(trainingPrograms.userId, userId)))
		.returning({ id: trainingPrograms.id });
	return updated.length > 0;
}

export async function deleteProgram(userId: string, programId: string): Promise<boolean> {
	const deleted = await db
		.delete(trainingPrograms)
		.where(and(eq(trainingPrograms.id, programId), eq(trainingPrograms.userId, userId)))
		.returning({ id: trainingPrograms.id });
	return deleted.length > 0;
}

export interface CompleteSessionInput {
	userId: string;
	programId: string;
	plannedSessionId: string;
	sensorEventId?: string | null;
	completedAt?: Date;
}

export interface CompleteSessionResult {
	completion: SessionCompletionDTO;
	plannedSession: {
		id: string;
		kind: 'strength' | 'run';
		weekNumber: number;
		dayNumber: number;
	};
	progressionApplied: boolean;
	progressionSummary?: string[];
}

export async function completePlannedSession(
	input: CompleteSessionInput
): Promise<CompleteSessionResult | null> {
	// 1. Verifiser session tilhører bruker + program
	const session = await db.query.programSessions.findFirst({
		where: eq(programSessions.id, input.plannedSessionId)
	});
	if (!session || session.programId !== input.programId) return null;

	const program = await db.query.trainingPrograms.findFirst({
		where: and(eq(trainingPrograms.id, input.programId), eq(trainingPrograms.userId, input.userId)),
		columns: { id: true }
	});
	if (!program) return null;

	const week = await db.query.programWeeks.findFirst({
		where: eq(programWeeks.id, session.weekId),
		columns: { weekNumber: true }
	});
	if (!week) return null;

	// 2. Hent sensor event hvis oppgitt, og bygg actuals-snapshot
	let actuals: ProgramActuals | undefined;
	let validatedSensorEventId: string | null = null;

	if (input.sensorEventId) {
		const event = await db.query.sensorEvents.findFirst({
			where: and(eq(sensorEvents.id, input.sensorEventId), eq(sensorEvents.userId, input.userId))
		});
		if (event) {
			validatedSensorEventId = event.id;
			actuals = buildActualsSnapshot(session.kind === 'run' ? 'run' : 'strength', event);
		}
	}

	// 3. Insert/upsert completion (unique på plannedSessionId)
	const completedAt = input.completedAt ?? new Date();
	const [completion] = await db
		.insert(programSessionCompletions)
		.values({
			userId: input.userId,
			programId: input.programId,
			plannedSessionId: input.plannedSessionId,
			sensorEventId: validatedSensorEventId,
			completedAt,
			actuals: actuals ?? null
		})
		.onConflictDoUpdate({
			target: programSessionCompletions.plannedSessionId,
			set: {
				sensorEventId: validatedSensorEventId,
				completedAt,
				actuals: actuals ?? null
			}
		})
		.returning();

	return {
		completion: {
			id: completion.id,
			plannedSessionId: completion.plannedSessionId,
			sensorEventId: completion.sensorEventId,
			completedAt: completion.completedAt.toISOString(),
			actuals: completion.actuals ?? undefined
		},
		plannedSession: {
			id: session.id,
			kind: session.kind === 'run' ? 'run' : 'strength',
			weekNumber: week.weekNumber,
			dayNumber: session.dayNumber
		},
		progressionApplied: false
	};
}

function buildActualsSnapshot(
	kind: 'strength' | 'run',
	event: typeof sensorEvents.$inferSelect
): ProgramActuals {
	const data = (event.data ?? {}) as Record<string, any>;
	if (kind === 'strength') {
		const exercises = Array.isArray(data.exercises)
			? data.exercises
					.filter((ex: any) => ex && typeof ex.name === 'string')
					.map((ex: any) => ({
						name: ex.name,
						sets: Array.isArray(ex.sets)
							? ex.sets.map((s: any) => ({
									reps: typeof s.reps === 'number' ? s.reps : undefined,
									weight: typeof s.weight === 'number' ? s.weight : undefined,
									durationSeconds: typeof s.durationSeconds === 'number' ? s.durationSeconds : undefined
							  }))
							: []
					}))
			: undefined;
		return {
			kind: 'strength',
			duration: typeof data.duration === 'number' ? data.duration : undefined,
			avgHeartRate: typeof data.avgHeartRate === 'number' ? data.avgHeartRate : undefined,
			maxHeartRate: typeof data.maxHeartRate === 'number' ? data.maxHeartRate : undefined,
			totalSets: typeof data.totalSets === 'number' ? data.totalSets : undefined,
			totalReps: typeof data.totalReps === 'number' ? data.totalReps : undefined,
			totalVolume: typeof data.totalVolume === 'number' ? data.totalVolume : undefined,
			exercises
		};
	}
	return {
		kind: 'run',
		duration: typeof data.duration === 'number' ? data.duration : undefined,
		avgHeartRate: typeof data.avgHeartRate === 'number' ? data.avgHeartRate : undefined,
		maxHeartRate: typeof data.maxHeartRate === 'number' ? data.maxHeartRate : undefined,
		distance: typeof data.distance === 'number' ? data.distance : undefined,
		paceSecondsPerKm: typeof data.paceSecondsPerKm === 'number' ? data.paceSecondsPerKm : undefined,
		sportType: typeof data.sportType === 'string' ? data.sportType : undefined
	};
}

// Re-export for å spare imports andre steder
export { STRENGTH_EXERCISE_NAMES };
