/**
 * Adaptiv treningsmodus — DB-orkestrering rundt den rene logikken i adaptive.ts.
 *
 * Kjøres ukentlig (cron, søndag kveld) for alle aktive programmer med
 * mode='adaptiv'. Evaluerer uken som er i ferd med å avsluttes og justerer
 * NESTE uke: tempo (dempet VDOT-rekalkulering), dagplassering (vanedager)
 * og volum (effort-dekning). Hver justering logges i program_adaptations
 * med begrunnelser, slik at coachen kan forklare endringene.
 */

import { db } from '$lib/db';
import {
	canonicalWorkouts,
	programAdaptations,
	programSessions,
	programWeeks,
	trainingPrograms
} from '$lib/db/schema';
import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { paceZonesForVdot } from '$lib/server/workouts/vdot';
import { getEffortBaseline } from '$lib/server/services/effort-service';
import { mondayOf } from './repository';
import {
	buildWeekdayProfile,
	estimateActualEffort,
	estimatePlannedEffort,
	evaluateEffortBalance,
	planDayMoves,
	recalcWeeklyVdot,
	type FamilyEffortMap,
	type ObservedRun,
	type PlannedSessionLite
} from './adaptive';
import type { PlannedRunDTO } from './types';
import type { RunType } from './constants';
import { isRunType } from './constants';

export interface AdaptationRunResult {
	programId: string;
	evaluatedWeek: number;
	adjustedWeek: number | null;
	adaptations: Array<{ kind: string; reasons: string[] }>;
	skipped?: string;
}

function addDaysISO(iso: string, days: number): string {
	const d = new Date(iso + 'T00:00:00Z');
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

/** dayNumber (1=mandag .. 7=søndag) fra et timestamp. */
function dayNumberOf(date: Date): number {
	return ((date.getUTCDay() + 6) % 7) + 1;
}

function toNumber(value: string | null): number | undefined {
	if (value == null) return undefined;
	const n = Number(value);
	return Number.isFinite(n) ? n : undefined;
}

/**
 * Kjør ukentlig adaptiv justering for ett program.
 * `todayISO` ligger normalt i uken som evalueres (cron kjører søndag kveld).
 */
export async function runWeeklyAdaptation(args: {
	userId: string;
	programId: string;
	todayISO?: string;
}): Promise<AdaptationRunResult | null> {
	const todayISO = args.todayISO ?? new Date().toISOString().slice(0, 10);
	const program = await db.query.trainingPrograms.findFirst({
		where: and(eq(trainingPrograms.id, args.programId), eq(trainingPrograms.userId, args.userId))
	});
	if (!program) return null;
	if (program.status !== 'active' || (program as { mode?: string }).mode !== 'adaptiv') {
		return { programId: args.programId, evaluatedWeek: 0, adjustedWeek: null, adaptations: [], skipped: 'ikke aktivt adaptivt program' };
	}

	const startDate = typeof program.startDate === 'string'
		? program.startDate
		: new Date(program.startDate as unknown as Date).toISOString().slice(0, 10);

	// Hvilken programuke er vi i? Ankret mot kalenderuker som resten av systemet.
	const week1Monday = mondayOf(startDate);
	const thisMonday = mondayOf(todayISO);
	const evaluatedWeek =
		Math.floor(
			(new Date(thisMonday + 'T00:00:00Z').getTime() - new Date(week1Monday + 'T00:00:00Z').getTime()) /
				(7 * 86400000)
		) + 1;
	if (evaluatedWeek < 1) {
		return { programId: args.programId, evaluatedWeek, adjustedWeek: null, adaptations: [], skipped: 'programmet har ikke startet' };
	}
	if (evaluatedWeek > program.durationWeeks) {
		return { programId: args.programId, evaluatedWeek, adjustedWeek: null, adaptations: [], skipped: 'programmet er ferdig' };
	}
	const adjustedWeek = evaluatedWeek + 1 <= program.durationWeeks ? evaluatedWeek + 1 : null;

	// ── Datagrunnlag ──────────────────────────────────────────────────────────
	const weekStart = new Date(thisMonday + 'T00:00:00Z');
	const weekEnd = new Date(addDaysISO(thisMonday, 7) + 'T00:00:00Z');
	const ninetyDaysAgo = new Date(weekStart.getTime() - 90 * 86400000);

	const [weekWorkouts, historyRuns, hrBaseline, weeks] = await Promise.all([
		db.query.canonicalWorkouts.findMany({
			where: and(
				eq(canonicalWorkouts.userId, args.userId),
				gte(canonicalWorkouts.startTime, weekStart),
				lt(canonicalWorkouts.startTime, weekEnd)
			)
		}),
		db.query.canonicalWorkouts.findMany({
			where: and(
				eq(canonicalWorkouts.userId, args.userId),
				eq(canonicalWorkouts.sportFamily, 'running'),
				gte(canonicalWorkouts.startTime, ninetyDaysAgo)
			),
			orderBy: [desc(canonicalWorkouts.startTime)]
		}),
		getEffortBaseline(args.userId),
		db.query.programWeeks.findMany({
			where: eq(programWeeks.programId, args.programId),
			orderBy: [asc(programWeeks.weekNumber)]
		})
	]);

	const weekIdByNumber = new Map(weeks.map((w) => [w.weekNumber, w.id]));
	const deloadByNumber = new Map(weeks.map((w) => [w.weekNumber, w.deload]));

	const toObservedRun = (w: (typeof historyRuns)[number]): ObservedRun => {
		const distance = toNumber(w.distanceMeters);
		const duration = toNumber(w.durationSeconds);
		const gap = toNumber(w.gapSecPerKm);
		const pace =
			gap ?? (distance && duration && distance > 500 ? duration / (distance / 1000) : undefined);
		return {
			dayNumber: dayNumberOf(w.startTime),
			distanceMeters: distance,
			durationSeconds: duration,
			paceSecPerKm: pace,
			avgHeartRate: toNumber(w.avgHeartRate),
			bestEfforts: w.bestEfforts ?? undefined
		};
	};

	const adaptations: Array<{ kind: string; changes: Record<string, unknown>; reasons: string[] }> = [];

	// ── 1. Temporekalkulering (dempet, ukentlig) ──────────────────────────────
	const baseline = (program.baseline ?? {}) as Record<string, any>;
	const currentVdot: number | undefined = baseline.vdotEstimate;
	const weekRuns = weekWorkouts.filter((w) => w.sportFamily === 'running').map(toObservedRun);

	if (currentVdot != null && weekRuns.length > 0) {
		const recalc = recalcWeeklyVdot({
			currentVdot,
			runs: weekRuns,
			restHr: hrBaseline.restHr,
			maxHr: hrBaseline.maxHr
		});
		if (recalc.changed) {
			const newZones = paceZonesForVdot(recalc.newVdot);
			await db
				.update(trainingPrograms)
				.set({
					baseline: { ...baseline, vdotEstimate: recalc.newVdot, paceZones: newZones, recordedAt: new Date().toISOString() } as any,
					updatedAt: new Date()
				})
				.where(eq(trainingPrograms.id, args.programId));

			// Oppdater pace-hint på alle gjenværende ikke-deload-løpsøkter
			const futureWeekIds = weeks
				.filter((w) => w.weekNumber > evaluatedWeek && !w.deload)
				.map((w) => w.id);
			let updatedSessions = 0;
			if (futureWeekIds.length > 0) {
				const futureSessions = await db.query.programSessions.findMany({
					where: and(
						eq(programSessions.programId, args.programId),
						sql`${programSessions.weekId} IN ${futureWeekIds}`,
						eq(programSessions.kind, 'run')
					)
				});
				for (const s of futureSessions) {
					const run = s.plannedRun as PlannedRunDTO | null;
					if (!run) continue;
					const target = {
						easy: newZones.easySecPerKm,
						long: newZones.easySecPerKm,
						tempo: newZones.tempoSecPerKm,
						intervals: newZones.intervalSecPerKm
					}[run.runType];
					if (run.paceHintSecPerKm === target) continue;
					await db
						.update(programSessions)
						.set({ plannedRun: { ...run, paceHintSecPerKm: target } })
						.where(eq(programSessions.id, s.id));
					updatedSessions += 1;
				}
			}
			adaptations.push({
				kind: 'tempo',
				changes: {
					oldVdot: currentVdot,
					newVdot: recalc.newVdot,
					observedVdot: recalc.observedVdot,
					observationCount: recalc.observationCount,
					paceZones: newZones,
					updatedSessions
				},
				reasons: recalc.reasons
			});
		}
	}

	// ── 2. Effort-balanse → volum for neste uke ───────────────────────────────
	const evaluatedWeekId = weekIdByNumber.get(evaluatedWeek);
	const adjustedWeekId = adjustedWeek != null ? weekIdByNumber.get(adjustedWeek) : undefined;

	if (evaluatedWeekId && adjustedWeekId) {
		const [plannedSessions, nextWeekSessions] = await Promise.all([
			db.query.programSessions.findMany({ where: eq(programSessions.weekId, evaluatedWeekId) }),
			db.query.programSessions.findMany({ where: eq(programSessions.weekId, adjustedWeekId) })
		]);

		const plannedEffort: FamilyEffortMap = {};
		for (const s of plannedSessions) {
			const run = s.plannedRun as PlannedRunDTO | null;
			const est = estimatePlannedEffort({
				kind: s.kind === 'run' ? 'run' : 'strength',
				runType: run?.runType,
				targetDistanceMeters: run?.targetDistanceMeters,
				targetDurationSeconds: run?.targetDurationSeconds,
				paceHintSecPerKm: run?.paceHintSecPerKm
			});
			plannedEffort[est.family] = (plannedEffort[est.family] ?? 0) + est.effort;
		}

		const actualEffort: FamilyEffortMap = {};
		for (const w of weekWorkouts) {
			const effort = estimateActualEffort(
				{
					sportFamily: w.sportFamily,
					durationSeconds: toNumber(w.durationSeconds),
					avgHeartRate: toNumber(w.avgHeartRate)
				},
				{ restHr: hrBaseline.restHr, maxHr: hrBaseline.maxHr }
			);
			if (effort > 0) actualEffort[w.sportFamily] = (actualEffort[w.sportFamily] ?? 0) + effort;
		}

		const balance = evaluateEffortBalance(plannedEffort, actualEffort);
		const nextWeekIsDeload = deloadByNumber.get(adjustedWeek!) === true;

		if (balance.nextWeekVolumeFactor !== 1.0 && !nextWeekIsDeload) {
			let scaled = 0;
			for (const s of nextWeekSessions) {
				if (s.kind !== 'run' || s.isTest) continue;
				const run = s.plannedRun as PlannedRunDTO | null;
				if (!run) continue;
				const updates: Partial<PlannedRunDTO> = {};
				if (run.targetDistanceMeters) {
					updates.targetDistanceMeters = Math.round((run.targetDistanceMeters * balance.nextWeekVolumeFactor) / 100) * 100;
				}
				if (run.targetDurationSeconds) {
					updates.targetDurationSeconds = Math.round((run.targetDurationSeconds * balance.nextWeekVolumeFactor) / 60) * 60;
				}
				if (Object.keys(updates).length === 0) continue;
				await db
					.update(programSessions)
					.set({ plannedRun: { ...run, ...updates } })
					.where(eq(programSessions.id, s.id));
				scaled += 1;
			}
			adaptations.push({
				kind: 'volum',
				changes: {
					coverage: Math.round(balance.coverage * 100) / 100,
					verdict: balance.verdict,
					byFamily: balance.byFamily,
					volumeFactor: balance.nextWeekVolumeFactor,
					scaledSessions: scaled
				},
				reasons: balance.reasons
			});
		}
	}

	// ── 3. Dagplassering for neste uke ────────────────────────────────────────
	if (adjustedWeekId && historyRuns.length >= 6) {
		const profile = buildWeekdayProfile(historyRuns.map(toObservedRun));
		const nextWeekSessions = await db.query.programSessions.findMany({
			where: eq(programSessions.weekId, adjustedWeekId)
		});
		const lite: PlannedSessionLite[] = nextWeekSessions.map((s) => {
			const run = s.plannedRun as PlannedRunDTO | null;
			return {
				id: s.id,
				dayNumber: s.dayNumber,
				kind: s.kind === 'run' ? 'run' : 'strength',
				isTest: s.isTest,
				runType: run && isRunType(run.runType) ? (run.runType as RunType) : undefined
			};
		});
		const moves = planDayMoves(lite, profile);
		for (const move of moves) {
			await db
				.update(programSessions)
				.set({ dayNumber: move.toDay })
				.where(eq(programSessions.id, move.sessionId));
		}
		if (moves.length > 0) {
			adaptations.push({
				kind: 'ukeplan',
				changes: { moves: moves.map((m) => ({ sessionId: m.sessionId, fromDay: m.fromDay, toDay: m.toDay, character: m.character })) },
				reasons: moves.map((m) => m.reason)
			});
		}
	}

	// ── Logg justeringene ─────────────────────────────────────────────────────
	if (adaptations.length > 0 && adjustedWeek != null) {
		await db.insert(programAdaptations).values(
			adaptations.map((a) => ({
				userId: args.userId,
				programId: args.programId,
				weekNumber: adjustedWeek,
				kind: a.kind,
				changes: a.changes,
				reasons: a.reasons
			}))
		);
	}

	return {
		programId: args.programId,
		evaluatedWeek,
		adjustedWeek,
		adaptations: adaptations.map((a) => ({ kind: a.kind, reasons: a.reasons }))
	};
}

/** Kjør adaptiv justering for alle aktive adaptive programmer (alle brukere). */
export async function runWeeklyAdaptationsForAllPrograms(todayISO?: string): Promise<{
	programsProcessed: number;
	adaptationsApplied: number;
	errors: string[];
	results: AdaptationRunResult[];
}> {
	const programs = await db.query.trainingPrograms.findMany({
		where: and(eq(trainingPrograms.status, 'active'), eq(trainingPrograms.mode, 'adaptiv')),
		columns: { id: true, userId: true }
	});

	const results: AdaptationRunResult[] = [];
	const errors: string[] = [];
	for (const p of programs) {
		try {
			const result = await runWeeklyAdaptation({ userId: p.userId, programId: p.id, todayISO });
			if (result) results.push(result);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			errors.push(`program=${p.id}: ${msg}`);
			console.error(`[adaptive] justering feilet for program ${p.id}`, err);
		}
	}

	return {
		programsProcessed: programs.length,
		adaptationsApplied: results.reduce((sum, r) => sum + r.adaptations.length, 0),
		errors,
		results
	};
}

/** Siste justeringer for et program — til visning på programsiden. */
export async function getRecentAdaptations(
	userId: string,
	programId: string,
	limit = 20
): Promise<Array<{ id: string; weekNumber: number; kind: string; reasons: string[]; createdAt: string }>> {
	const rows = await db.query.programAdaptations.findMany({
		where: and(eq(programAdaptations.programId, programId), eq(programAdaptations.userId, userId)),
		orderBy: [desc(programAdaptations.createdAt)],
		limit
	});
	return rows.map((r) => ({
		id: r.id,
		weekNumber: r.weekNumber,
		kind: r.kind,
		reasons: (r.reasons ?? []) as string[],
		createdAt: r.createdAt.toISOString()
	}));
}
