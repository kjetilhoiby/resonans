import type { ActionProducer } from '../action-suggestion-service';
import type { ActionCandidate } from '$lib/types/actions';
import { db } from '$lib/db';
import { trainingPrograms, programWeeks, programSessions, programSessionCompletions } from '$lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';

export const trainingProgramProducer: ActionProducer = async (ctx) => {
	try {
		return await produceChips(ctx);
	} catch (err) {
		console.warn('[training-program-producer] feilet, ingen chip', err);
		return [];
	}
};

async function produceChips(ctx: Parameters<ActionProducer>[0]): Promise<ActionCandidate[]> {
	const activePrograms = await db.query.trainingPrograms.findMany({
		where: and(eq(trainingPrograms.userId, ctx.userId), eq(trainingPrograms.status, 'active')),
		columns: { id: true, name: true, startDate: true, durationWeeks: true },
		orderBy: (t, { desc }) => [desc(t.createdAt)],
		limit: 1
	});

	if (activePrograms.length === 0) {
		return [
			{
				id: 'training-program-create',
				icon: '🏃',
				label: 'Lag treningsprogram',
				priority: 25,
				source: 'system',
				intent: { kind: 'navigate', href: '/treningsprogram/ny' }
			}
		];
	}

	const program = activePrograms[0];
	const startDate =
		typeof program.startDate === 'string'
			? program.startDate
			: new Date(program.startDate as unknown as Date).toISOString().slice(0, 10);

	const startMs = new Date(startDate + 'T00:00:00Z').getTime();
	const todayIso = ctx.now.toISOString().slice(0, 10);
	const todayMs = new Date(todayIso + 'T00:00:00Z').getTime();
	const dayOffset = Math.floor((todayMs - startMs) / (1000 * 60 * 60 * 24));
	if (dayOffset < 0 || dayOffset >= program.durationWeeks * 7) return [];

	const weekNumber = Math.floor(dayOffset / 7) + 1;
	const dayNumber = (dayOffset % 7) + 1;

	const rows = await db
		.select({
			sessionId: programSessions.id,
			sessionName: programSessions.name,
			isTest: programSessions.isTest,
			kind: programSessions.kind,
			completionId: programSessionCompletions.id
		})
		.from(programWeeks)
		.innerJoin(programSessions, eq(programSessions.weekId, programWeeks.id))
		.leftJoin(programSessionCompletions, eq(programSessionCompletions.plannedSessionId, programSessions.id))
		.where(
			and(
				eq(programWeeks.programId, program.id),
				eq(programWeeks.weekNumber, weekNumber),
				eq(programSessions.dayNumber, dayNumber)
			)
		)
		.limit(1);

	if (rows.length === 0 || rows[0].completionId) return [];

	const session = rows[0];
	return [
		{
			id: `training-program-today-${program.id}`,
			icon: session.isTest ? '🎯' : session.kind === 'run' ? '🏃' : '💪',
			label: session.isTest ? `Test: ${session.sessionName}` : `I dag: ${session.sessionName}`,
			priority: 80,
			source: 'system',
			intent: { kind: 'navigate', href: `/treningsprogram/${program.id}` }
		}
	];
};
