import { db } from '$lib/db';
import { workoutSuppressions } from '$lib/db/schema';
import { and, eq, gte, sql } from 'drizzle-orm';
import {
	suppressionLookupWindow,
	type WorkoutSuppression
} from '$lib/domain/health/workout-suppression';

/**
 * Lesing og skriving av øktsvartelista.
 *
 * Tabellen ligger utenfor `sensor_events` med vilje: ingen synk skriver her, så
 * en svartelisting kan ikke overskrives av en kilde som sender økta på nytt.
 * Se `$lib/domain/health/workout-suppression.ts` for hvorfor et flagg på raden
 * ikke holdt.
 */

/**
 * Alle svartelistinger som kan treffe økter fra `since` og framover.
 *
 * Vinduet padder bakover med toleransen — en svartelisting like før `since` kan
 * fortsatt matche den første økta i vinduet.
 */
export async function listWorkoutSuppressions(
	userId: string,
	since?: Date
): Promise<WorkoutSuppression[]> {
	const conditions = [eq(workoutSuppressions.userId, userId)];
	if (since) {
		conditions.push(gte(workoutSuppressions.startTime, suppressionLookupWindow(since)));
	}

	const rows = await db
		.select({
			startTime: workoutSuppressions.startTime,
			sportFamily: workoutSuppressions.sportFamily
		})
		.from(workoutSuppressions)
		.where(and(...conditions));

	return rows;
}

/**
 * Svartelist en økt. Idempotent — gjentatte trykk på «Skjul» treffer samme rad.
 */
export async function addWorkoutSuppression(input: {
	userId: string;
	startTime: Date;
	sportFamily: string;
	source?: string | null;
}): Promise<void> {
	await db
		.insert(workoutSuppressions)
		.values({
			userId: input.userId,
			startTime: input.startTime,
			sportFamily: input.sportFamily,
			source: input.source ?? null
		})
		.onConflictDoNothing();
}

/**
 * Fjern svartelistingen(e) som dekker en økt — gjenåpning.
 *
 * Matcher på samme toleransevindu som filtreringen. Ville vi bare slettet på
 * eksakt starttidspunkt, kunne brukeren stått igjen med en økt som fortsatt var
 * skjult av en svartelisting noen minutter unna, uten noen vei tilbake.
 */
export async function removeWorkoutSuppression(input: {
	userId: string;
	startTime: Date;
	sportFamily: string;
	toleranceMinutes?: number;
}): Promise<number> {
	const tolerance = input.toleranceMinutes ?? undefined;
	const from = suppressionLookupWindow(input.startTime, tolerance);
	const to = new Date(input.startTime.getTime() + (input.startTime.getTime() - from.getTime()));

	const deleted = await db
		.delete(workoutSuppressions)
		.where(
			and(
				eq(workoutSuppressions.userId, input.userId),
				eq(workoutSuppressions.sportFamily, input.sportFamily),
				gte(workoutSuppressions.startTime, from),
				sql`${workoutSuppressions.startTime} <= ${to}`
			)
		)
		.returning({ id: workoutSuppressions.id });

	return deleted.length;
}
