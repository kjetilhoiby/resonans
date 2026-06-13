/**
 * Direkte programendringer foreslått av brukeren via coachen (chat-verktøyet
 * manage_training_program). Skiller ren logikk (testbar, ingen DB) fra
 * DB-operasjonene som verktøyet kaller.
 *
 * Komplementerer adaptive-service.ts: der justerer systemet planen automatisk,
 * her styrer brukeren den eksplisitt. Føringer (preferences) lagres på
 * programmet og respekteres av neste ukentlige rekalkulering.
 */

import { db } from '$lib/db';
import { programSessions, programWeeks, trainingPrograms } from '$lib/db/schema';
import { and, asc, eq, gte, sql } from 'drizzle-orm';
import type { PlannedRunDTO, ProgramPreferences } from './types';
import type { RunType } from './constants';

// ── Pure helpers ─────────────────────────────────────────────────────────────

export interface SessionDayLite {
	id: string;
	dayNumber: number;
	isTest?: boolean;
}

export type DayMovePlan =
	| { ok: true; swapWithSessionId: string | null }
	| { ok: false; error: string };

/**
 * Avgjør hva som skjer når en økt flyttes til en ny ukedag innen samme uke.
 * Unik (week, day)-constraint betyr at en opptatt måldag krever bytte: økten
 * som ligger der flyttes til kildedagen. Test-økter byttes ikke automatisk.
 */
export function planDayMove(
	sessions: SessionDayLite[],
	sessionId: string,
	newDay: number
): DayMovePlan {
	if (newDay < 1 || newDay > 7) return { ok: false, error: 'Ukedag må være 1 (man) til 7 (søn)' };
	const session = sessions.find((s) => s.id === sessionId);
	if (!session) return { ok: false, error: 'Fant ikke økten i uken' };
	if (session.dayNumber === newDay) return { ok: false, error: 'Økten ligger allerede på den dagen' };

	const occupant = sessions.find((s) => s.dayNumber === newDay && s.id !== sessionId);
	if (!occupant) return { ok: true, swapWithSessionId: null };
	if (occupant.isTest) {
		return { ok: false, error: 'Måldagen har en test-økt som ikke kan flyttes automatisk' };
	}
	return { ok: true, swapWithSessionId: occupant.id };
}

/** Skaler løps-targets (distanse/varighet) med en faktor; runder pent. */
export function scaledRunTargets(
	run: Pick<PlannedRunDTO, 'targetDistanceMeters' | 'targetDurationSeconds'>,
	factor: number
): { targetDistanceMeters?: number; targetDurationSeconds?: number } {
	const out: { targetDistanceMeters?: number; targetDurationSeconds?: number } = {};
	if (run.targetDistanceMeters) {
		out.targetDistanceMeters = Math.max(100, Math.round((run.targetDistanceMeters * factor) / 100) * 100);
	}
	if (run.targetDurationSeconds) {
		out.targetDurationSeconds = Math.max(60, Math.round((run.targetDurationSeconds * factor) / 60) * 60);
	}
	return out;
}

/**
 * Slå sammen eksisterende føringer med en delvis oppdatering. Validerer:
 * pinnedDays til unike 1–7, volumeBias klemt til [0.5, 1.5], notes kappet til 10.
 */
export function mergePreferences(
	current: ProgramPreferences | null | undefined,
	patch: Partial<ProgramPreferences>
): ProgramPreferences {
	const base: ProgramPreferences = { ...(current ?? {}) };

	if (patch.pinnedDays !== undefined) {
		const valid = [...new Set(patch.pinnedDays.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort(
			(a, b) => a - b
		);
		base.pinnedDays = valid;
	}
	if (patch.lockPace !== undefined) {
		base.lockPace = !!patch.lockPace;
	}
	if (patch.volumeBias !== undefined && Number.isFinite(patch.volumeBias)) {
		base.volumeBias = Math.min(1.5, Math.max(0.5, patch.volumeBias));
	}
	if (patch.notes !== undefined) {
		const incoming = patch.notes.map((n) => String(n).trim()).filter(Boolean);
		base.notes = [...(base.notes ?? []), ...incoming].slice(-10);
	}
	return base;
}

/** Map runType → hvilken pace-sone som gjelder (samme som adaptive/recalibration). */
export function paceFieldForRunType(runType: RunType): 'easy' | 'tempo' | 'intervals' {
	if (runType === 'tempo') return 'tempo';
	if (runType === 'intervals') return 'intervals';
	return 'easy'; // easy + long
}

// ── DB-operasjoner ───────────────────────────────────────────────────────────

export interface ProgramEditResult {
	ok: boolean;
	summary: string;
	error?: string;
}

/** Hent brukerens aktive program (foretrekker adaptivt), eller et spesifikt. */
export async function resolveTargetProgram(
	userId: string,
	programId?: string | null
): Promise<{ id: string; name: string; mode: string; startDate: string; durationWeeks: number } | null> {
	if (programId) {
		const p = await db.query.trainingPrograms.findFirst({
			where: and(eq(trainingPrograms.id, programId), eq(trainingPrograms.userId, userId)),
			columns: { id: true, name: true, mode: true, startDate: true, durationWeeks: true }
		});
		if (!p) return null;
		return normalizeProgramRow(p);
	}
	const active = await db.query.trainingPrograms.findMany({
		where: and(eq(trainingPrograms.userId, userId), eq(trainingPrograms.status, 'active')),
		orderBy: [
			// Adaptive programmer først, så nyeste
			sql`case when ${trainingPrograms.mode} = 'adaptiv' then 0 else 1 end`,
			sql`${trainingPrograms.createdAt} desc`
		],
		columns: { id: true, name: true, mode: true, startDate: true, durationWeeks: true },
		limit: 1
	});
	return active[0] ? normalizeProgramRow(active[0]) : null;
}

function normalizeProgramRow(p: {
	id: string;
	name: string;
	mode: string;
	startDate: string | Date;
	durationWeeks: number;
}) {
	return {
		id: p.id,
		name: p.name,
		mode: p.mode,
		startDate: typeof p.startDate === 'string' ? p.startDate : new Date(p.startDate).toISOString().slice(0, 10),
		durationWeeks: p.durationWeeks
	};
}

/** Flytt en planlagt økt til en ny ukedag (med automatisk bytte ved kollisjon). */
export async function moveSessionToDay(args: {
	userId: string;
	programId: string;
	sessionId: string;
	newDay: number;
}): Promise<ProgramEditResult> {
	const session = await db.query.programSessions.findFirst({
		where: and(eq(programSessions.id, args.sessionId), eq(programSessions.programId, args.programId))
	});
	if (!session) return { ok: false, summary: '', error: 'Fant ikke økten' };
	if (session.isTest) return { ok: false, summary: '', error: 'Test-økter kan ikke flyttes' };

	const weekSessions = await db.query.programSessions.findMany({
		where: eq(programSessions.weekId, session.weekId),
		columns: { id: true, dayNumber: true, isTest: true, name: true }
	});

	const plan = planDayMove(
		weekSessions.map((s) => ({ id: s.id, dayNumber: s.dayNumber, isTest: s.isTest })),
		args.sessionId,
		args.newDay
	);
	if (!plan.ok) return { ok: false, summary: '', error: plan.error };

	const fromDay = session.dayNumber;
	if (plan.swapWithSessionId) {
		// Frigjør unik (week,day) ved å parkere okkupanten midlertidig (dag 0),
		// flytte økten, og så sette okkupanten til kildedagen.
		await db.update(programSessions).set({ dayNumber: 0 }).where(eq(programSessions.id, plan.swapWithSessionId));
		await db.update(programSessions).set({ dayNumber: args.newDay }).where(eq(programSessions.id, args.sessionId));
		await db.update(programSessions).set({ dayNumber: fromDay }).where(eq(programSessions.id, plan.swapWithSessionId));
		const other = weekSessions.find((s) => s.id === plan.swapWithSessionId);
		return {
			ok: true,
			summary: `Flyttet «${session.name}» til ${dayName(args.newDay)} og byttet plass med «${other?.name ?? 'økten'}» (nå ${dayName(fromDay)}).`
		};
	}

	await db.update(programSessions).set({ dayNumber: args.newDay }).where(eq(programSessions.id, args.sessionId));
	return { ok: true, summary: `Flyttet «${session.name}» til ${dayName(args.newDay)}.` };
}

/** Sett pace-hint på en bestemt økt eller alle fremtidige løpsøkter av en type. */
export async function setRunPace(args: {
	userId: string;
	programId: string;
	paceSecPerKm: number;
	sessionId?: string;
	runType?: RunType;
	fromWeek?: number;
}): Promise<ProgramEditResult> {
	if (args.paceSecPerKm < 150 || args.paceSecPerKm > 900) {
		return { ok: false, summary: '', error: 'Pace må være mellom 2:30 og 15:00 per km' };
	}

	if (args.sessionId) {
		const session = await db.query.programSessions.findFirst({
			where: and(eq(programSessions.id, args.sessionId), eq(programSessions.programId, args.programId))
		});
		if (!session || session.kind !== 'run' || !session.plannedRun) {
			return { ok: false, summary: '', error: 'Fant ikke løpsøkten' };
		}
		const run = session.plannedRun as PlannedRunDTO;
		await db
			.update(programSessions)
			.set({ plannedRun: { ...run, paceHintSecPerKm: args.paceSecPerKm } })
			.where(eq(programSessions.id, args.sessionId));
		return { ok: true, summary: `Satte tempo ${fmtPace(args.paceSecPerKm)} på «${session.name}».` };
	}

	if (!args.runType) return { ok: false, summary: '', error: 'Oppgi enten sessionId eller runType' };

	const futureWeeks = await db.query.programWeeks.findMany({
		where: and(
			eq(programWeeks.programId, args.programId),
			args.fromWeek ? gte(programWeeks.weekNumber, args.fromWeek) : undefined
		),
		columns: { id: true }
	});
	const weekIds = futureWeeks.map((w) => w.id);
	if (weekIds.length === 0) return { ok: false, summary: '', error: 'Ingen uker å oppdatere' };

	const runs = await db.query.programSessions.findMany({
		where: and(
			eq(programSessions.programId, args.programId),
			eq(programSessions.kind, 'run'),
			sql`${programSessions.weekId} IN ${weekIds}`
		)
	});
	let updated = 0;
	for (const s of runs) {
		const run = s.plannedRun as PlannedRunDTO | null;
		if (!run || run.runType !== args.runType) continue;
		await db
			.update(programSessions)
			.set({ plannedRun: { ...run, paceHintSecPerKm: args.paceSecPerKm } })
			.where(eq(programSessions.id, s.id));
		updated += 1;
	}
	return {
		ok: updated > 0,
		summary: `Satte tempo ${fmtPace(args.paceSecPerKm)} på ${updated} ${runTypeLabel(args.runType)}-økt(er).`,
		error: updated === 0 ? 'Fant ingen matchende løpsøkter' : undefined
	};
}

/** Skaler volum (distanse/varighet) for én uke eller alle fremtidige uker. */
export async function scaleVolume(args: {
	userId: string;
	programId: string;
	factor: number;
	weekNumber?: number;
	fromWeek?: number;
}): Promise<ProgramEditResult> {
	const factor = Math.min(1.5, Math.max(0.5, args.factor));
	if (!Number.isFinite(factor)) return { ok: false, summary: '', error: 'Ugyldig faktor' };

	const weeks = await db.query.programWeeks.findMany({
		where: and(
			eq(programWeeks.programId, args.programId),
			args.weekNumber ? eq(programWeeks.weekNumber, args.weekNumber) : undefined,
			args.fromWeek ? gte(programWeeks.weekNumber, args.fromWeek) : undefined
		),
		columns: { id: true, weekNumber: true }
	});
	const weekIds = weeks.map((w) => w.id);
	if (weekIds.length === 0) return { ok: false, summary: '', error: 'Ingen uker å skalere' };

	const runs = await db.query.programSessions.findMany({
		where: and(
			eq(programSessions.programId, args.programId),
			eq(programSessions.kind, 'run'),
			sql`${programSessions.weekId} IN ${weekIds}`
		)
	});
	let updated = 0;
	for (const s of runs) {
		if (s.isTest) continue;
		const run = s.plannedRun as PlannedRunDTO | null;
		if (!run) continue;
		const scaled = scaledRunTargets(run, factor);
		if (Object.keys(scaled).length === 0) continue;
		await db
			.update(programSessions)
			.set({ plannedRun: { ...run, ...scaled } })
			.where(eq(programSessions.id, s.id));
		updated += 1;
	}
	const pct = Math.round((factor - 1) * 100);
	const dir = pct === 0 ? 'uendret' : pct > 0 ? `+${pct}%` : `${pct}%`;
	const scope = args.weekNumber ? `uke ${args.weekNumber}` : `${weeks.length} uker`;
	return {
		ok: updated > 0,
		summary: `Skalerte volum ${dir} på ${updated} løpsøkt(er) i ${scope}.`,
		error: updated === 0 ? 'Fant ingen løpsøkter å skalere' : undefined
	};
}

/** Oppdater brukerføringer (respekteres av neste ukentlige rekalkulering). */
export async function updatePreferences(args: {
	userId: string;
	programId: string;
	patch: Partial<ProgramPreferences>;
}): Promise<ProgramEditResult> {
	const program = await db.query.trainingPrograms.findFirst({
		where: and(eq(trainingPrograms.id, args.programId), eq(trainingPrograms.userId, args.userId)),
		columns: { preferences: true }
	});
	if (!program) return { ok: false, summary: '', error: 'Fant ikke programmet' };

	const merged = mergePreferences(program.preferences as ProgramPreferences | null, args.patch);
	await db
		.update(trainingPrograms)
		.set({ preferences: merged, updatedAt: new Date() })
		.where(eq(trainingPrograms.id, args.programId));

	const parts: string[] = [];
	if (merged.pinnedDays?.length) parts.push(`fastlåste dager: ${merged.pinnedDays.map(dayName).join(', ')}`);
	if (merged.lockPace) parts.push('tempo låst (ingen auto-rekalkulering)');
	if (merged.volumeBias != null && merged.volumeBias !== 1) {
		parts.push(`volum-ønske ${merged.volumeBias > 1 ? '+' : ''}${Math.round((merged.volumeBias - 1) * 100)}%`);
	}
	return {
		ok: true,
		summary: `Føringer oppdatert${parts.length ? ': ' + parts.join('; ') : ''}. Den ukentlige justeringen tar hensyn til dette.`
	};
}

function dayName(day: number): string {
	return ['', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag'][day] ?? `dag ${day}`;
}

function runTypeLabel(t: RunType): string {
	return { easy: 'rolig', tempo: 'tempo', intervals: 'interval', long: 'langtur' }[t] ?? t;
}

function fmtPace(secPerKm: number): string {
	const m = Math.floor(secPerKm / 60);
	const s = Math.round(secPerKm % 60);
	return `${m}:${String(s).padStart(2, '0')}/km`;
}
