import { db } from '$lib/db';
import { reflections } from '$lib/db/schema';
import { and, desc, eq, gte } from 'drizzle-orm';

export type ReflectionKind =
	| 'day_close'
	| 'week_review'
	| 'month_review'
	| 'salary_report'
	| 'goal_check'
	| 'reflection_light'
	| 'feriedagbok'
	| 'birthday_interview'
	| 'ad_hoc';

export interface ReflectionScores {
	mood?: number;
	energy?: number;
	focus?: number;
	[key: string]: unknown;
}

export interface CreateReflectionParams {
	userId: string;
	themeId?: string | null;
	personId?: string | null;
	kind: ReflectionKind;
	periodKey?: string | null;
	content: string;
	scores?: ReflectionScores;
	flowRunId?: string;
}

export async function createReflection(params: CreateReflectionParams) {
	const trimmed = params.content?.trim();
	if (!trimmed) return null;
	const [row] = await db
		.insert(reflections)
		.values({
			userId: params.userId,
			themeId: params.themeId ?? null,
			personId: params.personId ?? null,
			kind: params.kind,
			periodKey: params.periodKey ?? null,
			content: trimmed,
			scores: params.scores,
			flowRunId: params.flowRunId
		})
		.returning();
	return row ?? null;
}

/**
 * Opprett eller erstatt siste refleksjon for et gitt (userId, kind, periodKey).
 * Brukes der vi tidligere upsertet i memories (f.eks. salary_reflection).
 */
export async function upsertReflectionForPeriod(params: CreateReflectionParams & { periodKey: string }) {
	const trimmed = params.content?.trim();
	if (!trimmed) return null;

	const existing = await db.query.reflections.findFirst({
		where: and(
			eq(reflections.userId, params.userId),
			eq(reflections.kind, params.kind),
			eq(reflections.periodKey, params.periodKey)
		),
		orderBy: [desc(reflections.createdAt)]
	});

	if (existing) {
		const [updated] = await db
			.update(reflections)
			.set({ content: trimmed, scores: params.scores, themeId: params.themeId ?? null })
			.where(eq(reflections.id, existing.id))
			.returning();
		return updated ?? null;
	}
	return createReflection(params);
}

export async function getReflectionForPeriod(
	userId: string,
	kind: ReflectionKind,
	periodKey: string
) {
	return db.query.reflections.findFirst({
		where: and(
			eq(reflections.userId, userId),
			eq(reflections.kind, kind),
			eq(reflections.periodKey, periodKey)
		),
		orderBy: [desc(reflections.createdAt)]
	});
}

export async function getRecentReflections(userId: string, opts: { kinds?: ReflectionKind[]; sinceDays?: number; limit?: number } = {}) {
	const { kinds, sinceDays = 7, limit = 20 } = opts;
	const since = new Date();
	since.setDate(since.getDate() - sinceDays);

	const rows = await db.query.reflections.findMany({
		where: and(
			eq(reflections.userId, userId),
			gte(reflections.createdAt, since)
		),
		orderBy: [desc(reflections.createdAt)],
		limit: limit * 2
	});

	if (kinds && kinds.length > 0) {
		const set = new Set<string>(kinds);
		return rows.filter((r) => set.has(r.kind)).slice(0, limit);
	}
	return rows.slice(0, limit);
}
