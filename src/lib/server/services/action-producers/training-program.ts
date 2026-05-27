import type { ActionProducer } from '../action-suggestion-service';
import { db } from '$lib/db';
import { trainingPrograms, programWeeks, programSessions, programSessionCompletions } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';

/**
 * To måter denne dukker opp som chip i hjemskjermens action-carousel:
 *
 *   1. Brukeren har ingen aktive programmer  → CTA "Lag treningsprogram"
 *   2. Brukeren har et aktivt program, og det er en planlagt økt i dag som
 *      ikke er fullført → chip "I dag: <økt-navn>" som åpner programmet
 *
 * Hvis det er et aktivt program men hviledag (eller dagens økt er gjort),
 * dukker ingen chip opp — vi vil ikke spamme.
 */
export const trainingProgramProducer: ActionProducer = async (ctx) => {
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

	const week = await db.query.programWeeks.findFirst({
		where: and(eq(programWeeks.programId, program.id), eq(programWeeks.weekNumber, weekNumber)),
		columns: { id: true }
	});
	if (!week) return [];

	const session = await db.query.programSessions.findFirst({
		where: and(eq(programSessions.weekId, week.id), eq(programSessions.dayNumber, dayNumber)),
		columns: { id: true, name: true, isTest: true, kind: true }
	});
	if (!session) return [];

	const completion = await db.query.programSessionCompletions.findFirst({
		where: eq(programSessionCompletions.plannedSessionId, session.id),
		columns: { id: true }
	});
	if (completion) return [];

	return [
		{
			id: `training-program-today-${program.id}`,
			icon: session.isTest ? '🎯' : session.kind === 'run' ? '🏃' : '💪',
			label: session.isTest ? `Test: ${session.name}` : `I dag: ${session.name}`,
			priority: 80,
			source: 'system',
			intent: { kind: 'navigate', href: `/treningsprogram/${program.id}` }
		}
	];
};
