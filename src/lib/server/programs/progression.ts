import { db } from '$lib/db';
import {
	programExercises,
	programSessions,
	programWeeks
} from '$lib/db/schema';
import { and, asc, eq, sql } from 'drizzle-orm';
import { PROGRAM_LIMITS, getStrengthExercise } from './constants';
import type { PlannedRunDTO, SessionCompletionDTO } from './types';

/**
 * Etter at en økt er fullført, juster targets for tilsvarende øvelse/økt i
 * påfølgende uker innenfor samme program.
 *
 * Regler (intensjonelt enkle for v1):
 *   - Styrke: traff target på ALLE sett → øk reps med +1 (eller +5s for tid).
 *             Bommet på minst ett sett → hold target (ingen endring).
 *   - Løp: gjennomført med avg HR i forventet sone og fullført distanse →
 *          øk neste ukes distanse/duration med ~5%.
 *          Stopp på halvveis (distanse < 80%) → reduser neste ukes target litt.
 *
 * Returnerer en liste med fritekst-beskrivelser av hva som ble justert
 * (brukes i API-svaret og for debugging).
 */
export async function applyProgression(args: {
	programId: string;
	plannedSessionId: string;
	completion: SessionCompletionDTO;
}): Promise<string[]> {
	const session = await db.query.programSessions.findFirst({
		where: eq(programSessions.id, args.plannedSessionId)
	});
	if (!session) return [];

	const currentWeek = await db.query.programWeeks.findFirst({
		where: eq(programWeeks.id, session.weekId),
		columns: { weekNumber: true }
	});
	if (!currentWeek) return [];

	const futureWeeks = await db.query.programWeeks.findMany({
		where: and(
			eq(programWeeks.programId, args.programId),
			sql`${programWeeks.weekNumber} > ${currentWeek.weekNumber}`,
			sql`${programWeeks.deload} = false`
		),
		orderBy: [asc(programWeeks.weekNumber)]
	});

	if (futureWeeks.length === 0) return [];

	const summaries: string[] = [];

	if (session.kind === 'strength') {
		const completedExercises = await db.query.programExercises.findMany({
			where: eq(programExercises.sessionId, args.plannedSessionId),
			orderBy: [asc(programExercises.order)]
		});

		const actualExercises = (args.completion.actuals as { exercises?: Array<{ name: string; sets: Array<{ reps?: number; durationSeconds?: number }> }> } | undefined)?.exercises ?? [];

		for (const planned of completedExercises) {
			const spec = getStrengthExercise(planned.exerciseName);
			if (!spec) continue;

			const actual = actualExercises.find((e) => e.name === planned.exerciseName);
			const hitTarget = didHitTarget(planned, actual);

			if (!hitTarget) {
				summaries.push(`${planned.exerciseName}: bommet på target — holder neste uke uendret`);
				continue;
			}

			// Finn matching øvelse i neste uke og bump
			const nextWeek = futureWeeks[0];
			const nextSession = await db.query.programSessions.findFirst({
				where: and(eq(programSessions.weekId, nextWeek.id), eq(programSessions.dayNumber, session.dayNumber))
			});
			if (!nextSession) continue;

			const nextExercise = await db.query.programExercises.findFirst({
				where: and(
					eq(programExercises.sessionId, nextSession.id),
					eq(programExercises.exerciseName, planned.exerciseName)
				)
			});
			if (!nextExercise) continue;

			if (spec.mode === 'reps' && nextExercise.repsTarget != null && planned.repsTarget != null) {
				// Bare bump hvis neste uke ikke allerede har en høyere target
				if (nextExercise.repsTarget <= planned.repsTarget) {
					const newTarget = Math.min(planned.repsTarget + 1, PROGRAM_LIMITS.maxRepsTarget);
					if (newTarget > nextExercise.repsTarget) {
						await db
							.update(programExercises)
							.set({ repsTarget: newTarget })
							.where(eq(programExercises.id, nextExercise.id));
						summaries.push(`${planned.exerciseName}: traff target → neste uke ${newTarget} reps`);
					}
				}
			} else if (spec.mode === 'time' && nextExercise.durationSecondsTarget != null && planned.durationSecondsTarget != null) {
				if (nextExercise.durationSecondsTarget <= planned.durationSecondsTarget) {
					const newTarget = Math.min(planned.durationSecondsTarget + 5, PROGRAM_LIMITS.maxDurationSecondsTarget);
					if (newTarget > nextExercise.durationSecondsTarget) {
						await db
							.update(programExercises)
							.set({ durationSecondsTarget: newTarget })
							.where(eq(programExercises.id, nextExercise.id));
						summaries.push(`${planned.exerciseName}: traff target → neste uke ${newTarget}s`);
					}
				}
			}
		}
	} else {
		// Løp — bump distance/duration på neste ukes økt med samme runType + dayNumber
		const plannedRun = session.plannedRun as PlannedRunDTO | null;
		if (!plannedRun) return summaries;

		const actuals = args.completion.actuals as { distance?: number; duration?: number } | undefined;
		const targetDist = plannedRun.targetDistanceMeters;
		const targetDur = plannedRun.targetDurationSeconds;

		const completionFraction = (() => {
			if (targetDist && actuals?.distance) return actuals.distance / targetDist;
			if (targetDur && actuals?.duration) return actuals.duration / targetDur;
			return 1;
		})();

		const bumpFactor = completionFraction >= 0.95 ? 1.05 : completionFraction >= 0.8 ? 1.0 : 0.9;

		const nextWeek = futureWeeks[0];
		const nextSession = await db.query.programSessions.findFirst({
			where: and(
				eq(programSessions.weekId, nextWeek.id),
				eq(programSessions.dayNumber, session.dayNumber)
			)
		});
		if (!nextSession || nextSession.kind !== 'run') return summaries;

		const nextRun = nextSession.plannedRun as PlannedRunDTO | null;
		if (!nextRun || nextRun.runType !== plannedRun.runType) return summaries;

		const updates: { targetDistanceMeters?: number; targetDurationSeconds?: number } = {};
		if (nextRun.targetDistanceMeters && targetDist) {
			updates.targetDistanceMeters = Math.round(nextRun.targetDistanceMeters * bumpFactor);
		}
		if (nextRun.targetDurationSeconds && targetDur) {
			updates.targetDurationSeconds = Math.round(nextRun.targetDurationSeconds * bumpFactor);
		}

		if (Object.keys(updates).length > 0) {
			const newRun: PlannedRunDTO = { ...nextRun, ...updates };
			await db
				.update(programSessions)
				.set({ plannedRun: newRun })
				.where(eq(programSessions.id, nextSession.id));

			const changeDesc = updates.targetDistanceMeters
				? `${Math.round((updates.targetDistanceMeters ?? 0) / 100) / 10} km`
				: `${updates.targetDurationSeconds}s`;
			const direction = bumpFactor > 1 ? 'øker' : bumpFactor < 1 ? 'reduserer' : 'holder';
			summaries.push(`${plannedRun.runType}: ${direction} neste uke til ${changeDesc}`);
		}
	}

	return summaries;
}

function didHitTarget(
	planned: { repsTarget: number | null; durationSecondsTarget: number | null; sets: number },
	actual: { sets?: Array<{ reps?: number; durationSeconds?: number }> } | undefined
): boolean {
	if (!actual || !Array.isArray(actual.sets) || actual.sets.length === 0) return false;
	const completedSets = actual.sets.slice(0, planned.sets);
	if (completedSets.length < planned.sets) return false;

	if (planned.repsTarget != null) {
		return completedSets.every((s) => typeof s.reps === 'number' && s.reps >= planned.repsTarget!);
	}
	if (planned.durationSecondsTarget != null) {
		return completedSets.every(
			(s) => typeof s.durationSeconds === 'number' && s.durationSeconds >= planned.durationSecondsTarget!
		);
	}
	return false;
}

export { didHitTarget as _didHitTargetForTests };
export type { SessionCompletionDTO };
