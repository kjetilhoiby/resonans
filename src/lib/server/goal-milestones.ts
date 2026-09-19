/**
 * Milepæler: lesing til chat-konteksten, og ÉN skrivevei for regnskapet.
 *
 * To flater fullfører et mål — `update_goal` i chatten og `PATCH /api/goals/[id]`
 * (som «Fullfør»-knappen på /plan/mal går gjennom). Begge normaliserer med
 * `mergeMilestoneRecord` fra domenelaget, av samme grunn som ernæringens tre
 * innganger deler `saveNutritionTargets`: skriver de hver sin `metadata.milestone`,
 * driver formene fra hverandre, og bare én av dem husker at `achievedOn` settes én
 * gang. Skriveveien her finnes fordi chat-verktøyet trenger hele les-flett-skriv;
 * PATCH-en bygger alt et `updateData`-objekt og fletter inn i det.
 *
 * Se `docs/changelog/2026-09-19-retningen-som-baerer-prioriteringer.md`.
 */

import { and, desc, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { goals } from '$lib/db/schema';
import { osloDayKey } from '$lib/domain/oslo-time';
import {
	mergeMilestoneRecord,
	milestoneFromGoal,
	readMilestoneRecord,
	type Milestone,
	type MilestonePatch
} from '$lib/domain/goals/milestone';

/**
 * Taket er på RADER, ikke på alder: `splitMilestones` kapper bakgrunnen selv, og en
 * fersk milepæl må være med uansett hvor mange gamle som ligger foran den.
 */
const MAX_COMPLETED_ROWS = 50;

/** Fullførte mål som milepæler, nyeste endring først. */
export async function readMilestones(userId: string): Promise<Milestone[]> {
	const rows = await db.query.goals.findMany({
		where: and(eq(goals.userId, userId), eq(goals.status, 'completed')),
		orderBy: [desc(goals.updatedAt)],
		limit: MAX_COMPLETED_ROWS,
		columns: { id: true, title: true, metadata: true }
	});
	return rows.map((r) => milestoneFromGoal(r));
}

export type CompleteGoalResult =
	| { ok: true; goal: typeof goals.$inferSelect; milestone: Milestone }
	| { ok: false; error: string; status: number };

/**
 * Sett målet til `completed` og flett inn milepælsregnskapet.
 *
 * **`metadata` flettes, aldri erstattes.** Målet bærer `visionHorizon` og
 * `goalTrack` i samme objekt — et skriv som bygger metadataen på nytt ville
 * koblet målet fra retningen og tømt målverdien, stille.
 */
export async function completeGoalWithMilestone(args: {
	userId: string;
	goalId: string;
	patch?: MilestonePatch;
	now?: Date;
}): Promise<CompleteGoalResult> {
	const now = args.now ?? new Date();
	const existing = await db.query.goals.findFirst({
		where: and(eq(goals.id, args.goalId), eq(goals.userId, args.userId))
	});
	if (!existing) return { ok: false, error: 'Fant ikke målet.', status: 404 };

	const merged = mergeMilestoneRecord(
		readMilestoneRecord(existing.metadata),
		args.patch ?? {},
		osloDayKey(now)
	);
	if (!merged.ok) return { ok: false, error: merged.error, status: 400 };

	const metadata = {
		...((existing.metadata ?? {}) as Record<string, unknown>),
		milestone: merged.record
	};

	const [updated] = await db
		.update(goals)
		.set({ status: 'completed', metadata, updatedAt: now })
		.where(eq(goals.id, args.goalId))
		.returning();

	return {
		ok: true,
		goal: updated,
		milestone: milestoneFromGoal({ id: updated.id, title: updated.title, metadata })
	};
}
