import { db } from '$lib/db';
import { planArtifacts } from '$lib/db/schema';
import { and, eq, gte, lte, desc, sql } from 'drizzle-orm';

export type PlanArtifactKind = 'day' | 'week' | 'month';
export type PlanArtifactField = 'headline' | 'note' | 'reflection' | 'vision';

interface UpsertParams {
	userId: string;
	kind: PlanArtifactKind;
	periodKey: string;
	field: PlanArtifactField;
	content: string;
	parentPeriodKey?: string | null;
	themeId?: string | null;
}

/**
 * Upsert ett tekstfelt på et plan-artefakt. Hvis innholdet er tomt og raden
 * eksisterer, settes feltet til null (men raden beholdes om andre felter har innhold).
 */
export async function upsertPlanArtifactField(params: UpsertParams) {
	const { userId, kind, periodKey, field, parentPeriodKey, themeId } = params;
	const trimmed = params.content?.trim() ?? '';
	const value = trimmed.length > 0 ? trimmed : null;

	const setObj: Record<string, unknown> = {
		[field]: value,
		updatedAt: new Date()
	};
	if (parentPeriodKey !== undefined) setObj.parentPeriodKey = parentPeriodKey;
	if (themeId !== undefined) setObj.themeId = themeId;

	await db
		.insert(planArtifacts)
		.values({
			userId,
			kind,
			periodKey,
			parentPeriodKey: parentPeriodKey ?? null,
			themeId: themeId ?? null,
			[field]: value
		})
		.onConflictDoUpdate({
			target: [planArtifacts.userId, planArtifacts.kind, planArtifacts.periodKey],
			set: setObj
		});
}

export async function getPlanArtifact(userId: string, kind: PlanArtifactKind, periodKey: string) {
	return db.query.planArtifacts.findFirst({
		where: and(
			eq(planArtifacts.userId, userId),
			eq(planArtifacts.kind, kind),
			eq(planArtifacts.periodKey, periodKey)
		)
	});
}

export async function getPlanArtifactsByParent(userId: string, parentPeriodKey: string) {
	return db.query.planArtifacts.findMany({
		where: and(
			eq(planArtifacts.userId, userId),
			eq(planArtifacts.parentPeriodKey, parentPeriodKey)
		)
	});
}

/**
 * Hent siste N aktive plan-artefakter (sortert nyest først), uavhengig av kind.
 * Brukes av DreamService og prompt-bygging.
 */
export async function getRecentPlanArtifacts(userId: string, kinds: PlanArtifactKind[], limit = 8) {
	return db
		.select()
		.from(planArtifacts)
		.where(
			and(
				eq(planArtifacts.userId, userId),
				sql`${planArtifacts.kind} = ANY(${kinds})`
			)
		)
		.orderBy(desc(planArtifacts.updatedAt))
		.limit(limit);
}

export async function getPlanArtifactsInRange(
	userId: string,
	kind: PlanArtifactKind,
	fromKey: string,
	toKey: string
) {
	return db.query.planArtifacts.findMany({
		where: and(
			eq(planArtifacts.userId, userId),
			eq(planArtifacts.kind, kind),
			gte(planArtifacts.periodKey, fromKey),
			lte(planArtifacts.periodKey, toKey)
		)
	});
}
