/**
 * Mål og oppgavene under dem, for MCP: les, finn likt, endre, pause, avslutt.
 *
 * En måloppgave (`tasks` med `goalId`) er en GJENTAKENDE forpliktelse — «løpe 3
 * ganger i uka» — med frekvens og måltall, og framdrift i `progress`. Det er en
 * annen ting enn et prosjektpunkt eller et punkt i dagslista, og de holdes fra
 * hverandre her: bare oppgaver med et mål brukeren eier slipper gjennom.
 *
 * `tasks` har ingen `user_id`; eierskapet går via målet, som i ukeplanens
 * `updateTask`/`deleteTask`. (`getGoalTasks` og `findSimilarTasks` i goals.ts
 * sjekker IKKE eier, og brukes derfor ikke her.)
 */

import { and, eq, gte, inArray } from 'drizzle-orm';
import { db } from '$lib/db';
import { goals, persons, progress, tasks } from '$lib/db/schema';
import { areSemanticallySimilar, calculateSimilarity } from '$lib/server/similarity';
import { addDaysIso, osloTodayIso } from '$lib/server/iso-week';
import { osloLocalToIso } from '$lib/domain/plan-items';
import { PlanError } from './plan-service';

export const TASK_STATUSES = ['active', 'paused', 'completed', 'archived'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_FREQUENCIES = ['daily', 'weekly', 'monthly', 'once'] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function checkUuid(value: string | undefined, field: string): string {
	if (!value || !UUID.test(value)) throw new PlanError('invalid_argument', `${field} må være en UUID, fikk ${JSON.stringify(value)}.`);
	return value;
}

/** Starten på perioden framdriften telles i: Oslo-midnatt dagen, mandagen eller den 1. */
function periodStart(frequency: string | null): { period: 'day' | 'week' | 'month' | 'total'; since: Date | null } {
	const today = osloTodayIso();
	const midnight = (date: string) => new Date(osloLocalToIso(date, 0, 0));
	if (frequency === 'daily') return { period: 'day', since: midnight(today) };
	if (frequency === 'weekly') {
		const [y, m, d] = today.split('-').map(Number);
		const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7;
		return { period: 'week', since: midnight(addDaysIso(today, 1 - dow)) };
	}
	if (frequency === 'monthly') return { period: 'month', since: midnight(`${today.slice(0, 8)}01`) };
	return { period: 'total', since: null };
}

type TaskRow = typeof tasks.$inferSelect;

function toGoalTask(task: TaskRow, progressCount?: number) {
	const { period } = periodStart(task.frequency);
	return {
		id: task.id,
		goalId: task.goalId,
		title: task.title,
		description: task.description,
		frequency: task.frequency,
		targetValue: task.targetValue,
		unit: task.unit,
		status: task.status,
		periodType: task.periodType,
		periodId: task.periodId,
		...(progressCount !== undefined ? { progress: { period, count: progressCount } } : {}),
		updatedAt: task.updatedAt.toISOString()
	};
}

export type GoalTask = ReturnType<typeof toGoalTask>;

export async function listGoalsWithTasks(
	userId: string,
	opts: { goalId?: string; includeInactive?: boolean } = {}
) {
	if (opts.goalId) checkUuid(opts.goalId, 'goalId');
	const rows = await db.query.goals.findMany({
		where: and(
			eq(goals.userId, userId),
			...(opts.goalId ? [eq(goals.id, opts.goalId)] : []),
			...(opts.includeInactive ? [] : [eq(goals.status, 'active')])
		),
		with: { tasks: true },
		orderBy: (g, { desc }) => [desc(g.createdAt)]
	});
	if (opts.goalId && rows.length === 0) throw new PlanError('not_found', `Fant ikke målet ${opts.goalId}.`);

	const personIds = [...new Set(rows.map((g) => g.personId).filter((id): id is string => !!id))];
	const people = personIds.length
		? await db.query.persons.findMany({ where: inArray(persons.id, personIds), columns: { id: true, name: true } })
		: [];
	const personName = new Map(people.map((p) => [p.id, p.name]));

	const visibleTasks = rows.flatMap((g) =>
		(g.tasks as TaskRow[]).filter((t) => opts.includeInactive || t.status === 'active')
	);
	const counts = new Map<string, number>();
	await Promise.all(
		visibleTasks.map(async (task) => {
			const { since } = periodStart(task.frequency);
			const rowsForTask = await db.query.progress.findMany({
				where: and(eq(progress.taskId, task.id), ...(since ? [gte(progress.completedAt, since)] : [])),
				columns: { value: true }
			});
			counts.set(task.id, rowsForTask.reduce((sum, r) => sum + (r.value ?? 1), 0));
		})
	);

	return rows.map((g) => ({
		id: g.id,
		title: g.title,
		description: g.description,
		status: g.status,
		periodKey: g.periodKey,
		targetDate: g.targetDate ? g.targetDate.toISOString().slice(0, 10) : null,
		personName: g.personId ? (personName.get(g.personId) ?? null) : null,
		parentGoalId: g.parentGoalId,
		tasks: (g.tasks as TaskRow[])
			.filter((t) => opts.includeInactive || t.status === 'active')
			.map((t) => toGoalTask(t, counts.get(t.id) ?? 0))
	}));
}

async function loadOwnGoalTask(userId: string, taskId: string): Promise<TaskRow> {
	checkUuid(taskId, 'taskId');
	const task = await db.query.tasks.findFirst({
		where: eq(tasks.id, taskId),
		with: { goal: { columns: { userId: true } } }
	});
	const owner = (task as { goal?: { userId: string } | null } | undefined)?.goal?.userId;
	// Samme svar for «finnes ikke» og «ikke din»: et annet svar ville latt hvem
	// som helst prøve ut hvilke oppgave-id-er som finnes.
	if (!task || owner !== userId) {
		throw new PlanError('not_found', `Fant ingen måloppgave med id ${taskId}. Hent id-ene med query_goals.`);
	}
	return task;
}

/**
 * Alle oppgavene under målet, rangert etter likhet med `title` — ikke bare de
 * over en terskel.
 *
 * `findSimilarTasks` i goals.ts regner Levenshtein på hele strengen, og der er
 * «Løpe 3 ganger i uka» mot «Løpe» 21 % lik: en ekte dublett slipper gjennom.
 * Et mål har sjelden mer enn en håndfull oppgaver, så modellen får alle, med en
 * poengsum og `likelyDuplicate` (tegn- ELLER ordlikhet), og dømmer selv. Pausede
 * og arkiverte er med, så den kan gjenoppta en gammel framfor å lage en ny.
 */
export async function findSimilarGoalTasks(userId: string, goalId: string, title: string) {
	checkUuid(goalId, 'goalId');
	if (!title?.trim()) throw new PlanError('invalid_argument', 'title er påkrevd for find_similar.');
	const goal = await db.query.goals.findFirst({
		where: and(eq(goals.id, goalId), eq(goals.userId, userId)),
		with: { tasks: true }
	});
	if (!goal) throw new PlanError('not_found', `Fant ikke målet ${goalId}.`);
	const query = title.trim();
	return (goal.tasks as TaskRow[])
		.map((task) => ({
			...toGoalTask(task),
			similarity: Math.round(calculateSimilarity(query, task.title)),
			likelyDuplicate: areSemanticallySimilar(query, task.title, 60)
		}))
		.sort((a, b) => Number(b.likelyDuplicate) - Number(a.likelyDuplicate) || b.similarity - a.similarity);
}

export interface GoalTaskUpdate {
	title?: string;
	description?: string | null;
	frequency?: string;
	targetValue?: number | null;
	unit?: string | null;
	status?: TaskStatus;
}

/** Bare feltene som er med endres. */
export async function updateGoalTask(userId: string, taskId: string, input: GoalTaskUpdate): Promise<GoalTask> {
	await loadOwnGoalTask(userId, taskId);
	const set: Partial<typeof tasks.$inferInsert> = {};
	if (input.title !== undefined) {
		if (!input.title.trim()) throw new PlanError('invalid_argument', 'title kan ikke være tom.');
		set.title = input.title.trim();
	}
	if (input.description !== undefined) set.description = input.description?.trim() || null;
	if (input.frequency !== undefined) {
		if (!(TASK_FREQUENCIES as readonly string[]).includes(input.frequency)) {
			throw new PlanError('invalid_argument', `frequency må være en av ${TASK_FREQUENCIES.join(', ')}.`);
		}
		set.frequency = input.frequency;
	}
	if (input.targetValue !== undefined) {
		if (input.targetValue !== null && (!Number.isInteger(input.targetValue) || input.targetValue < 0)) {
			throw new PlanError('invalid_argument', 'targetValue må være et ikke-negativt heltall.');
		}
		set.targetValue = input.targetValue;
	}
	if (input.unit !== undefined) set.unit = input.unit?.trim() || null;
	if (input.status !== undefined) set.status = input.status;
	if (Object.keys(set).length === 0) throw new PlanError('invalid_argument', 'Ingen felt å endre.');

	const [updated] = await db
		.update(tasks)
		.set({ ...set, updatedAt: new Date() })
		.where(eq(tasks.id, taskId))
		.returning();
	return toGoalTask(updated);
}
