import { and, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { roProfiles, roSessions } from '$lib/db/schema';
import { parseProfile, type RoProfile } from './ro-logic';

/** Så mange økter beholder det brukeren faktisk sa. Eldre tekst nulles ut. */
export const KEEP_TEXT_FOR_SESSIONS = 10;

export async function loadProfile(userId: string): Promise<RoProfile> {
	const [row] = await db.select().from(roProfiles).where(eq(roProfiles.userId, userId)).limit(1);
	return parseProfile(row?.state);
}

export async function saveProfile(userId: string, profile: RoProfile): Promise<void> {
	const state = profile as unknown as Record<string, unknown>;
	await db
		.insert(roProfiles)
		.values({ userId, state })
		.onConflictDoUpdate({ target: roProfiles.userId, set: { state, updatedAt: new Date() } });
}

export type RoSessionRow = typeof roSessions.$inferSelect;

export async function createSession(values: typeof roSessions.$inferInsert): Promise<RoSessionRow> {
	const [row] = await db.insert(roSessions).values(values).returning();
	return row;
}

export async function getOwnedSession(userId: string, id: string): Promise<RoSessionRow | null> {
	if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
	const [row] = await db
		.select()
		.from(roSessions)
		.where(and(eq(roSessions.id, id), eq(roSessions.userId, userId)))
		.limit(1);
	return row ?? null;
}

export async function completeSession(
	id: string,
	values: Pick<RoSessionRow, 'durationSec' | 'reflection' | 'reply' | 'proposal' | 'themeId'>
): Promise<void> {
	await db
		.update(roSessions)
		.set({ ...values, completedAt: new Date() })
		.where(eq(roSessions.id, id));
}

export async function countCompleted(userId: string, since?: Date): Promise<number> {
	const conditions = [eq(roSessions.userId, userId), isNotNull(roSessions.completedAt)];
	if (since) conditions.push(gte(roSessions.completedAt, since));
	const [row] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(roSessions)
		.where(and(...conditions));
	return row?.n ?? 0;
}

/** Siste refleksjoner for et tema, eldste først – grunnlaget for gjennomgangen. */
export async function recentReflections(userId: string, themeId: string, limit = 10): Promise<string[]> {
	const rows = await db
		.select({ reflection: roSessions.reflection })
		.from(roSessions)
		.where(and(eq(roSessions.userId, userId), eq(roSessions.themeId, themeId), isNotNull(roSessions.reflection)))
		.orderBy(desc(roSessions.createdAt))
		.limit(limit);
	return rows
		.map((r) => r.reflection)
		.filter((r): r is string => !!r)
		.reverse();
}

/**
 * Glem ordrett tekst eldre enn de ti siste øktene. Det som var verdt å huske,
 * ligger i profilen; resten er en dagbok vi ikke har bedt om å føre.
 */
export async function forgetOldText(userId: string): Promise<void> {
	await db.execute(sql`
		UPDATE ro_sessions SET intake = NULL, reflection = NULL, reply = NULL
		WHERE user_id = ${userId}
		  AND (intake IS NOT NULL OR reflection IS NOT NULL OR reply IS NOT NULL)
		  AND id NOT IN (
			SELECT id FROM ro_sessions WHERE user_id = ${userId}
			ORDER BY created_at DESC LIMIT ${KEEP_TEXT_FOR_SESSIONS}
		  )
	`);
}
