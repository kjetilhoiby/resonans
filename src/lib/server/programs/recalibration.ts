/**
 * Rekalibrering: kjøres når en test-økt i et program fullføres, og test-
 * resultatet avviker betydelig fra baseline. Justerer alle gjenværende
 * ikke-deload-uker uten å gå via LLM (regelbasert, billig, deterministisk).
 *
 * Triggerterskel: ≥ 10% endring i én av nøkkelmetrikkene.
 *  - Løp: VDOT eller 5k-tid
 *  - Styrke: AMRAP-reps eller max-hold
 */

import { db } from '$lib/db';
import {
	programExercises,
	programSessions,
	programWeeks,
	trainingPrograms
} from '$lib/db/schema';
import { and, asc, eq, sql } from 'drizzle-orm';
import { PROGRAM_LIMITS, getStrengthExercise } from './constants';
import { paceZonesForVdot, vdotFromCooper, vdotFromTime } from '$lib/server/workouts/vdot';
import type { PlannedRunDTO, ProgramTestType } from './types';

export interface TestResultPayload {
	testType: ProgramTestType;
	result: {
		cooper12minMeters?: number;
		time5kSeconds?: number;
		time10kSeconds?: number;
		amrapReps?: number;
		holdSeconds?: number;
	};
}

export interface RecalibrationOutcome {
	applied: boolean;
	deviation?: number;
	summary: string[];
	newBaseline?: Record<string, unknown>;
}

const SIGNIFICANT_DEVIATION = 0.1;

export async function maybeRecalibrate(args: {
	programId: string;
	plannedSessionId: string;
	test: TestResultPayload;
}): Promise<RecalibrationOutcome> {
	const program = await db.query.trainingPrograms.findFirst({
		where: eq(trainingPrograms.id, args.programId)
	});
	if (!program) return { applied: false, summary: [] };

	const baseline = (program.baseline ?? {}) as Record<string, any>;
	const session = await db.query.programSessions.findFirst({
		where: eq(programSessions.id, args.plannedSessionId)
	});
	if (!session) return { applied: false, summary: [] };
	const currentWeek = await db.query.programWeeks.findFirst({
		where: eq(programWeeks.id, session.weekId),
		columns: { weekNumber: true }
	});
	if (!currentWeek) return { applied: false, summary: [] };

	const isRunTest = ['cooper_12min', 'time_5k', 'time_10k'].includes(args.test.testType);

	if (isRunTest) {
		return await recalibrateRun({
			programId: args.programId,
			fromWeek: currentWeek.weekNumber,
			baseline,
			test: args.test
		});
	}

	return await recalibrateStrength({
		programId: args.programId,
		fromWeek: currentWeek.weekNumber,
		baseline,
		test: args.test
	});
}

async function recalibrateRun(args: {
	programId: string;
	fromWeek: number;
	baseline: Record<string, any>;
	test: TestResultPayload;
}): Promise<RecalibrationOutcome> {
	const newVdot = computeVdotFromTest(args.test);
	if (newVdot == null) return { applied: false, summary: [] };
	const oldVdot: number | undefined = args.baseline.vdotEstimate;

	const deviation = oldVdot ? Math.abs(newVdot - oldVdot) / oldVdot : 1;
	const newZones = paceZonesForVdot(newVdot);

	// Oppdater alltid baseline-snapshot på programmet — selv små endringer fanger fremdrift
	const updatedBaseline = {
		...args.baseline,
		vdotEstimate: newVdot,
		paceZones: newZones,
		recordedAt: new Date().toISOString()
	};
	await db
		.update(trainingPrograms)
		.set({ baseline: updatedBaseline as any, updatedAt: new Date() })
		.where(eq(trainingPrograms.id, args.programId));

	if (deviation < SIGNIFICANT_DEVIATION) {
		return {
			applied: false,
			deviation,
			summary: [
				oldVdot
					? `VDOT ${oldVdot} → ${newVdot} (${(deviation * 100).toFixed(1)}% endring, under 10%-terskel)`
					: `Ny baseline VDOT=${newVdot} lagret`
			],
			newBaseline: updatedBaseline
		};
	}

	// Hent alle gjenværende ikke-deload løps-økter og juster pace
	const futureWeeks = await db.query.programWeeks.findMany({
		where: and(
			eq(programWeeks.programId, args.programId),
			sql`${programWeeks.weekNumber} > ${args.fromWeek}`,
			sql`${programWeeks.deload} = false`
		),
		orderBy: [asc(programWeeks.weekNumber)]
	});

	if (futureWeeks.length === 0) {
		return {
			applied: false,
			deviation,
			summary: ['Ingen flere uker å rekalibrere'],
			newBaseline: updatedBaseline
		};
	}

	const sessions = await db.query.programSessions.findMany({
		where: and(
			eq(programSessions.programId, args.programId),
			sql`${programSessions.weekId} IN ${futureWeeks.map((w) => w.id)}`,
			eq(programSessions.kind, 'run')
		)
	});

	let updates = 0;
	const summary: string[] = [];
	for (const s of sessions) {
		const run = s.plannedRun as PlannedRunDTO | null;
		if (!run) continue;
		const updated = applyZonesToRun(run, newZones);
		if (updated) {
			await db
				.update(programSessions)
				.set({ plannedRun: updated })
				.where(eq(programSessions.id, s.id));
			updates += 1;
		}
	}
	summary.push(
		`VDOT ${oldVdot ?? '–'} → ${newVdot} (${(deviation * 100).toFixed(1)}% endring). Justerte pace på ${updates} løps-økt(er) i ${futureWeeks.length} uker.`
	);

	return { applied: true, deviation, summary, newBaseline: updatedBaseline };
}

function computeVdotFromTest(test: TestResultPayload): number | null {
	const r = test.result;
	switch (test.testType) {
		case 'cooper_12min':
			if (typeof r.cooper12minMeters === 'number') return vdotFromCooper(r.cooper12minMeters);
			return null;
		case 'time_5k':
			if (typeof r.time5kSeconds === 'number') return vdotFromTime(5000, r.time5kSeconds);
			return null;
		case 'time_10k':
			if (typeof r.time10kSeconds === 'number') return vdotFromTime(10000, r.time10kSeconds);
			return null;
		default:
			return null;
	}
}

function applyZonesToRun(
	run: PlannedRunDTO,
	zones: ReturnType<typeof paceZonesForVdot>
): PlannedRunDTO | null {
	const target = {
		easy: zones.easySecPerKm,
		long: zones.easySecPerKm,
		tempo: zones.tempoSecPerKm,
		intervals: zones.intervalSecPerKm
	}[run.runType];
	if (run.paceHintSecPerKm === target) return null;
	return { ...run, paceHintSecPerKm: target };
}

async function recalibrateStrength(args: {
	programId: string;
	fromWeek: number;
	baseline: Record<string, any>;
	test: TestResultPayload;
}): Promise<RecalibrationOutcome> {
	const exerciseName = strengthExerciseFromTest(args.test.testType);
	if (!exerciseName) return { applied: false, summary: [] };
	const spec = getStrengthExercise(exerciseName);
	if (!spec) return { applied: false, summary: [] };

	const newMax = spec.mode === 'reps' ? args.test.result.amrapReps : args.test.result.holdSeconds;
	if (typeof newMax !== 'number' || newMax <= 0) return { applied: false, summary: [] };

	const sb = (args.baseline.strengthBaseline ?? {}) as Record<string, { reps?: number; durationSeconds?: number }>;
	const oldEntry = sb[exerciseName] ?? {};
	const oldMax = spec.mode === 'reps' ? oldEntry.reps : oldEntry.durationSeconds;
	const deviation = oldMax ? Math.abs(newMax - oldMax) / oldMax : 1;

	const updatedSb: typeof sb = {
		...sb,
		[exerciseName]: spec.mode === 'reps' ? { reps: newMax } : { durationSeconds: newMax }
	};
	const updatedBaseline = {
		...args.baseline,
		strengthBaseline: updatedSb,
		recordedAt: new Date().toISOString()
	};
	await db
		.update(trainingPrograms)
		.set({ baseline: updatedBaseline as any, updatedAt: new Date() })
		.where(eq(trainingPrograms.id, args.programId));

	if (deviation < SIGNIFICANT_DEVIATION) {
		return {
			applied: false,
			deviation,
			summary: [
				oldMax
					? `${exerciseName} ${oldMax} → ${newMax} (${(deviation * 100).toFixed(1)}% endring, under terskel)`
					: `Ny baseline ${exerciseName}=${newMax} lagret`
			],
			newBaseline: updatedBaseline
		};
	}

	// 70% av ny max blir uke 1-target, og målet vokser lineært mot 100% over gjenværende uker
	const futureWeeks = await db.query.programWeeks.findMany({
		where: and(
			eq(programWeeks.programId, args.programId),
			sql`${programWeeks.weekNumber} > ${args.fromWeek}`,
			sql`${programWeeks.deload} = false`
		),
		orderBy: [asc(programWeeks.weekNumber)]
	});

	if (futureWeeks.length === 0) {
		return {
			applied: false,
			deviation,
			summary: ['Ingen flere uker å rekalibrere'],
			newBaseline: updatedBaseline
		};
	}

	const exercises = await db.query.programExercises.findMany({
		where: and(
			eq(programExercises.exerciseName, exerciseName),
			sql`${programExercises.sessionId} IN (
				SELECT id FROM ${programSessions} WHERE week_id IN ${futureWeeks.map((w) => w.id)}
				AND is_test = false
			)`
		)
	});

	let updates = 0;
	const totalWeeks = futureWeeks.length;
	for (const ex of exercises) {
		const session = await db.query.programSessions.findFirst({
			where: eq(programSessions.id, ex.sessionId),
			columns: { weekId: true, isTest: true }
		});
		if (!session || session.isTest) continue;
		const week = futureWeeks.find((w) => w.id === session.weekId);
		if (!week) continue;
		const weekIdx = futureWeeks.findIndex((w) => w.id === week.id);
		const progressFraction = 0.7 + (weekIdx / Math.max(totalWeeks - 1, 1)) * 0.3;
		const target = Math.round(newMax * progressFraction);
		if (spec.mode === 'reps') {
			const capped = Math.max(1, Math.min(PROGRAM_LIMITS.maxRepsTarget, target));
			if (ex.repsTarget !== capped) {
				await db
					.update(programExercises)
					.set({ repsTarget: capped })
					.where(eq(programExercises.id, ex.id));
				updates += 1;
			}
		} else {
			const capped = Math.max(1, Math.min(PROGRAM_LIMITS.maxDurationSecondsTarget, target));
			if (ex.durationSecondsTarget !== capped) {
				await db
					.update(programExercises)
					.set({ durationSecondsTarget: capped })
					.where(eq(programExercises.id, ex.id));
				updates += 1;
			}
		}
	}

	return {
		applied: true,
		deviation,
		summary: [
			`${exerciseName} ${oldMax ?? '–'} → ${newMax} (${(deviation * 100).toFixed(1)}% endring). Justerte ${updates} targets over ${futureWeeks.length} uker.`
		],
		newBaseline: updatedBaseline
	};
}

function strengthExerciseFromTest(testType: ProgramTestType): string | null {
	switch (testType) {
		case 'amrap_utfall':
			return 'Utfall';
		case 'amrap_armhevinger':
			return 'Armhevinger';
		case 'amrap_taahevinger':
			return 'Tåhevinger';
		case 'max_planke':
			return 'Planke';
		default:
			return null;
	}
}
