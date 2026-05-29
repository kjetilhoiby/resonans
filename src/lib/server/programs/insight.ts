import { db } from '$lib/db';
import {
	programReadinessAssessments,
	programSessionCompletions,
	programSessions,
	programWeeks,
	sensorEvents,
	trainingPrograms
} from '$lib/db/schema';
import { and, asc, count, desc, eq, gte, sql } from 'drizzle-orm';
import { openai } from '$lib/server/openai';
import { buildAthleteSnapshot } from './athlete-context';
import { mondayOf, sessionPlannedDate } from './repository';
import type { ProgramDTO, ProgramSessionDTO } from './types';

export type InsightScope = 'week' | 'progression';

export interface InsightResult {
	ok: true;
	scope: InsightScope;
	title: string;
	summary: string;
	highlights: string[];
	model: string;
	generatedAt: string;
	cached: boolean;
}

interface CachedInsight {
	value: Omit<InsightResult, 'cached'>;
	fingerprint: string;
	expiresAt: number;
}

// In-memory cache — 1 time TTL, nøkkel per (userId, programId, scope, weekNumber).
// Bevisst enkel: server-restart blåser den vekk, og forskjellige Vercel-instanser
// har egne kopier. Verdien er stale-tolerant og kost-grensa er ett gpt-kall.
const insightCache = new Map<string, CachedInsight>();
const CACHE_TTL_MS = 60 * 60 * 1000;

function cacheKey(userId: string, programId: string, scope: InsightScope, weekNumber: number | null): string {
	return `${userId}::${programId}::${scope}::${weekNumber ?? 'auto'}`;
}

function computeCurrentWeek(programStartDate: string, today: string): number {
	const week1Monday = mondayOf(programStartDate);
	const offsetWeeks = Math.floor(
		(new Date(mondayOf(today) + 'T00:00:00Z').getTime() -
			new Date(week1Monday + 'T00:00:00Z').getTime()) /
			(1000 * 60 * 60 * 24 * 7)
	);
	return offsetWeeks + 1;
}

interface WeekContext {
	weekNumber: number;
	phase: string | null;
	deload: boolean;
	notes: string | null;
	sessions: Array<{
		id: string;
		dayNumber: number;
		date: string;
		kind: 'run' | 'strength';
		name: string;
		isTest: boolean;
		testType: string | null;
		plannedRun: ProgramSessionDTO['plannedRun'] | null;
		plannedExercises: ProgramSessionDTO['plannedExercises'] | null;
		completion: {
			completedAt: string;
			actuals: Record<string, unknown> | null;
		} | null;
		readiness: {
			state: string;
			reasons: string[];
		} | null;
	}>;
}

async function loadWeekContext(args: {
	userId: string;
	programId: string;
	programStartDate: string;
	weekNumber: number;
}): Promise<WeekContext | null> {
	const week = await db.query.programWeeks.findFirst({
		where: and(
			eq(programWeeks.programId, args.programId),
			eq(programWeeks.weekNumber, args.weekNumber)
		)
	});
	if (!week) return null;

	const sessions = await db.query.programSessions.findMany({
		where: eq(programSessions.weekId, week.id),
		orderBy: [asc(programSessions.dayNumber)],
		with: { exercises: true, completion: true }
	});

	const datesInWeek = sessions.map((s) =>
		sessionPlannedDate(args.programStartDate, args.weekNumber, s.dayNumber)
	);

	let readinessByDate = new Map<string, { state: string; reasons: string[] }>();
	if (datesInWeek.length > 0) {
		const minDate = datesInWeek.reduce((a, b) => (a < b ? a : b));
		const maxDate = datesInWeek.reduce((a, b) => (a > b ? a : b));
		const rows = await db
			.select({
				date: programReadinessAssessments.assessmentDate,
				state: programReadinessAssessments.state,
				reasons: programReadinessAssessments.reasons
			})
			.from(programReadinessAssessments)
			.where(
				and(
					eq(programReadinessAssessments.userId, args.userId),
					eq(programReadinessAssessments.programId, args.programId),
					gte(programReadinessAssessments.assessmentDate, minDate),
					sql`${programReadinessAssessments.assessmentDate} <= ${maxDate}`
				)
			);
		for (const r of rows) {
			readinessByDate.set(r.date as unknown as string, {
				state: r.state,
				reasons: (r.reasons as string[]) ?? []
			});
		}
	}

	return {
		weekNumber: week.weekNumber,
		phase: week.phase,
		deload: week.deload,
		notes: week.notes,
		sessions: sessions.map((s, i) => {
			const date = datesInWeek[i];
			return {
				id: s.id,
				dayNumber: s.dayNumber,
				date,
				kind: s.kind === 'run' ? 'run' : 'strength',
				name: s.name,
				isTest: s.isTest,
				testType: s.testType,
				plannedRun: (s.plannedRun as ProgramSessionDTO['plannedRun']) ?? null,
				plannedExercises:
					s.exercises?.map((e) => ({
						id: e.id,
						order: e.order,
						exerciseName: e.exerciseName,
						sets: e.sets,
						repsTarget: e.repsTarget ?? undefined,
						durationSecondsTarget: e.durationSecondsTarget ?? undefined,
						weightHint: e.weightHint ?? undefined,
						notes: e.notes ?? undefined
					})) ?? null,
				completion: s.completion
					? {
							completedAt: s.completion.completedAt.toISOString(),
							actuals: (s.completion.actuals as Record<string, unknown>) ?? null
						}
					: null,
				readiness: readinessByDate.get(date) ?? null
			};
		})
	};
}

interface ProgressionContext {
	currentWeek: number;
	totalCompletions: number;
	totalSessions: number;
	recentCompletions: Array<{
		date: string;
		kind: string;
		name: string;
		weekNumber: number;
		actuals: Record<string, unknown> | null;
	}>;
	weekPhases: Array<{ weekNumber: number; phase: string | null; deload: boolean }>;
}

async function loadProgressionContext(args: {
	userId: string;
	programId: string;
	currentWeek: number;
}): Promise<ProgressionContext> {
	const [totalRow, completedRow, recentCompletions, weeks] = await Promise.all([
		db
			.select({ total: count() })
			.from(programSessions)
			.where(eq(programSessions.programId, args.programId)),
		db
			.select({ total: count() })
			.from(programSessionCompletions)
			.where(eq(programSessionCompletions.programId, args.programId)),
		db
			.select({
				id: programSessionCompletions.id,
				completedAt: programSessionCompletions.completedAt,
				actuals: programSessionCompletions.actuals,
				sessionId: programSessionCompletions.plannedSessionId
			})
			.from(programSessionCompletions)
			.where(eq(programSessionCompletions.programId, args.programId))
			.orderBy(desc(programSessionCompletions.completedAt))
			.limit(8),
		db
			.select({
				weekNumber: programWeeks.weekNumber,
				phase: programWeeks.phase,
				deload: programWeeks.deload
			})
			.from(programWeeks)
			.where(eq(programWeeks.programId, args.programId))
			.orderBy(asc(programWeeks.weekNumber))
	]);

	const sessionIds = recentCompletions.map((c) => c.sessionId);
	const sessionInfo =
		sessionIds.length === 0
			? []
			: await db
					.select({
						id: programSessions.id,
						kind: programSessions.kind,
						name: programSessions.name,
						dayNumber: programSessions.dayNumber,
						weekId: programSessions.weekId
					})
					.from(programSessions)
					.where(sql`${programSessions.id} IN ${sessionIds}`);

	const weekById = new Map(weeks.map((w) => [w.weekNumber, w]));
	// Vi trenger weekNumber for hver session — map via weekId.
	const weekByWeekId = new Map<string, number>();
	if (sessionIds.length > 0) {
		const weekIds = sessionInfo.map((s) => s.weekId);
		const weekRows = await db
			.select({ id: programWeeks.id, weekNumber: programWeeks.weekNumber })
			.from(programWeeks)
			.where(sql`${programWeeks.id} IN ${weekIds}`);
		for (const w of weekRows) weekByWeekId.set(w.id, w.weekNumber);
	}

	const sessionById = new Map(sessionInfo.map((s) => [s.id, s]));

	return {
		currentWeek: args.currentWeek,
		totalSessions: Number(totalRow[0]?.total ?? 0),
		totalCompletions: Number(completedRow[0]?.total ?? 0),
		recentCompletions: recentCompletions.map((c) => {
			const s = sessionById.get(c.sessionId);
			return {
				date: c.completedAt.toISOString().slice(0, 10),
				kind: s?.kind ?? 'unknown',
				name: s?.name ?? 'Økt',
				weekNumber: (s && weekByWeekId.get(s.weekId)) ?? 0,
				actuals: (c.actuals as Record<string, unknown>) ?? null
			};
		}),
		weekPhases: weeks.map((w) => ({
			weekNumber: w.weekNumber,
			phase: w.phase,
			deload: w.deload
		}))
	};
}

interface WeekFingerprintArgs {
	week: WeekContext;
}

function fingerprintWeek(args: WeekFingerprintArgs): string {
	const parts = args.week.sessions.map((s) =>
		[s.id, s.completion ? '1' : '0', s.readiness?.state ?? '-'].join(':')
	);
	return parts.join('|');
}

function fingerprintProgression(args: { progression: ProgressionContext }): string {
	return `${args.progression.currentWeek}::${args.progression.totalCompletions}`;
}

function buildWeekPrompt(args: {
	program: { name: string; goal: string };
	week: WeekContext;
}): { system: string; user: string } {
	const lines: string[] = [];
	lines.push(`Program: ${args.program.name} — mål: ${args.program.goal}`);
	lines.push(`Uke ${args.week.weekNumber}${args.week.phase ? ` (${args.week.phase})` : ''}${args.week.deload ? ' [deload]' : ''}`);
	if (args.week.notes) lines.push(`Notater for uka: ${args.week.notes}`);
	lines.push('');
	lines.push('Økter:');
	for (const s of args.week.sessions) {
		const status = s.completion ? '✓ fullført' : '○ ikke fullført';
		const readiness = s.readiness ? ` (tilstand: ${s.readiness.state})` : '';
		lines.push(`- ${s.date} ${s.kind === 'run' ? 'Løp' : 'Styrke'} — ${s.name} ${status}${readiness}`);
		if (s.kind === 'run' && s.plannedRun) {
			const r = s.plannedRun;
			const bits: string[] = [r.runType];
			if (r.targetDistanceMeters) bits.push(`${(r.targetDistanceMeters / 1000).toFixed(1)} km`);
			if (r.targetDurationSeconds) bits.push(`${Math.round(r.targetDurationSeconds / 60)} min`);
			if (r.paceHintSecPerKm) bits.push(`pace ${Math.floor(r.paceHintSecPerKm / 60)}:${(r.paceHintSecPerKm % 60).toString().padStart(2, '0')}/km`);
			lines.push(`    plan: ${bits.join(', ')}`);
		}
		if (s.completion?.actuals) {
			const a = s.completion.actuals;
			const bits: string[] = [];
			if (typeof a.distance === 'number') bits.push(`${(a.distance / 1000).toFixed(2)} km`);
			if (typeof a.paceSecondsPerKm === 'number') bits.push(`pace ${Math.floor(a.paceSecondsPerKm / 60)}:${(a.paceSecondsPerKm % 60).toString().padStart(2, '0')}/km`);
			if (typeof a.duration === 'number') bits.push(`${Math.round(a.duration / 60)} min`);
			if (typeof a.avgHeartRate === 'number') bits.push(`hr ${a.avgHeartRate}`);
			if (typeof a.totalReps === 'number') bits.push(`${a.totalReps} reps`);
			if (typeof a.totalVolume === 'number') bits.push(`${a.totalVolume} kg vol`);
			if (bits.length > 0) lines.push(`    faktisk: ${bits.join(', ')}`);
		}
	}

	const system = `Du er Resonans-coach. Du skriver en kort, varm uke-oppsummering på norsk for en hobbyutøver.
Tonen er rolig og spesifikk — du ser tallene, men snakker ikke som en regnearksmodell.
Returner JSON i akkurat denne formen, ingen ekstra felter:
{
  "title": "kort tittel (3-6 ord)",
  "summary": "2-4 setninger om uka — hva gikk bra, hva gikk mindre bra, hvilken vekt har øktene hatt",
  "highlights": ["3-5 punkter — konkrete observasjoner, ikke generelle råd"]
}`;
	const user = lines.join('\n');
	return { system, user };
}

function buildProgressionPrompt(args: {
	program: { name: string; goal: string; durationWeeks: number };
	progression: ProgressionContext;
	athlete: Awaited<ReturnType<typeof buildAthleteSnapshot>>;
}): { system: string; user: string } {
	const lines: string[] = [];
	lines.push(`Program: ${args.program.name} — mål: ${args.program.goal}`);
	lines.push(`Uke ${args.progression.currentWeek} av ${args.program.durationWeeks}.`);
	lines.push(`Fullført ${args.progression.totalCompletions} av ${args.progression.totalSessions} planlagte økter.`);
	lines.push('');
	lines.push('Atlet-snapshot:');
	if (args.athlete.recentVolumeKm)
		lines.push(`- Volum: ${args.athlete.recentVolumeKm.toFixed(1)} km/uke (4 uker)`);
	if (args.athlete.recentSessionsPerWeek)
		lines.push(`- Frekvens: ${args.athlete.recentSessionsPerWeek.toFixed(1)} økter/uke`);
	if (args.athlete.vdotEstimate)
		lines.push(`- VDOT: ${args.athlete.vdotEstimate} (${args.athlete.vdotSource})`);
	if (args.athlete.paceZones) {
		const z = args.athlete.paceZones;
		const fmt = (s?: number) =>
			s ? `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}/km` : '-';
		lines.push(`- Soner: easy ${fmt(z.easySecPerKm)}, tempo ${fmt(z.tempoSecPerKm)}, intervall ${fmt(z.intervalSecPerKm)}`);
	}
	if (args.athlete.bestEfforts) {
		const be = args.athlete.bestEfforts;
		const items = Object.entries(be)
			.filter(([, v]) => typeof v === 'number')
			.map(([k, v]) => `${k} ${Math.floor((v as number) / 60)}:${((v as number) % 60).toString().padStart(2, '0')}`);
		if (items.length > 0) lines.push(`- Beste: ${items.join(', ')}`);
	}
	lines.push('');
	lines.push('Uke-faser:');
	for (const w of args.progression.weekPhases) {
		const marker = w.weekNumber === args.progression.currentWeek ? ' ← nå' : '';
		lines.push(`- Uke ${w.weekNumber}${w.phase ? ` (${w.phase})` : ''}${w.deload ? ' [deload]' : ''}${marker}`);
	}
	lines.push('');
	lines.push('Siste fullførte økter:');
	for (const c of args.progression.recentCompletions) {
		lines.push(`- ${c.date} (uke ${c.weekNumber}) ${c.kind} — ${c.name}`);
	}

	const system = `Du er Resonans-coach. Du skriver en kort progresjonsstatus på norsk for en hobbyutøver i et flerukers-program.
Tonen er rolig og konkret — vis at du ser hvor de er, hva som har endret seg, og hva som ligger foran.
Returner JSON i akkurat denne formen, ingen ekstra felter:
{
  "title": "kort tittel (3-6 ord)",
  "summary": "3-5 setninger om hvor utøveren står mot målet — nevn pace/volum/styrke der det er relevant",
  "highlights": ["3-5 punkter — konkrete observasjoner og hva som gjenstår"]
}`;
	const user = lines.join('\n');
	return { system, user };
}

const MODEL = 'gpt-5.4';

async function callInsightModel(prompt: { system: string; user: string }): Promise<{
	title: string;
	summary: string;
	highlights: string[];
}> {
	const response = await openai.chat.completions.create({
		model: MODEL,
		messages: [
			{ role: 'system', content: prompt.system },
			{ role: 'user', content: prompt.user }
		],
		response_format: { type: 'json_object' },
		max_completion_tokens: 800
	});
	const content = response.choices[0]?.message?.content ?? '{}';
	const parsed = JSON.parse(content) as {
		title?: string;
		summary?: string;
		highlights?: unknown;
	};
	const summary = typeof parsed.summary === 'string' && parsed.summary.trim().length > 0
		? parsed.summary.trim()
		: 'Ingen oppsummering tilgjengelig.';
	const title = typeof parsed.title === 'string' && parsed.title.trim().length > 0
		? parsed.title.trim()
		: 'Innsikt';
	const highlights = Array.isArray(parsed.highlights)
		? parsed.highlights
				.filter((h): h is string => typeof h === 'string')
				.map((h) => h.trim())
				.filter((h) => h.length > 0)
		: [];
	return { title, summary, highlights };
}

export async function generateProgramInsight(args: {
	userId: string;
	programId: string;
	scope: InsightScope;
	weekNumber?: number | null;
}): Promise<InsightResult> {
	const program = await db.query.trainingPrograms.findFirst({
		where: and(
			eq(trainingPrograms.id, args.programId),
			eq(trainingPrograms.userId, args.userId)
		)
	});
	if (!program) throw new InsightNotFoundError('Program ikke funnet');

	const startDate =
		typeof program.startDate === 'string'
			? program.startDate
			: new Date(program.startDate as unknown as Date).toISOString().slice(0, 10);
	const today = new Date().toISOString().slice(0, 10);

	let weekNumber: number | null = args.weekNumber ?? null;
	if (args.scope === 'week' && weekNumber === null) {
		weekNumber = computeCurrentWeek(startDate, today);
		if (weekNumber < 1) weekNumber = 1;
		if (weekNumber > program.durationWeeks) weekNumber = program.durationWeeks;
	}

	const key = cacheKey(args.userId, args.programId, args.scope, weekNumber);
	const now = Date.now();
	const cached = insightCache.get(key);

	let fingerprint = '';
	let prompt: { system: string; user: string };
	let title: string | undefined;

	if (args.scope === 'week') {
		const wk = await loadWeekContext({
			userId: args.userId,
			programId: args.programId,
			programStartDate: startDate,
			weekNumber: weekNumber as number
		});
		if (!wk) throw new InsightNotFoundError(`Uke ${weekNumber} ikke funnet`);
		fingerprint = fingerprintWeek({ week: wk });
		prompt = buildWeekPrompt({
			program: { name: program.name, goal: program.goal },
			week: wk
		});
		title = `Uke ${wk.weekNumber}${wk.phase ? ` – ${wk.phase}` : ''}`;
	} else {
		const currentWeek = computeCurrentWeek(startDate, today);
		const [progression, athlete] = await Promise.all([
			loadProgressionContext({
				userId: args.userId,
				programId: args.programId,
				currentWeek
			}),
			buildAthleteSnapshot(args.userId)
		]);
		fingerprint = fingerprintProgression({ progression });
		prompt = buildProgressionPrompt({
			program: {
				name: program.name,
				goal: program.goal,
				durationWeeks: program.durationWeeks
			},
			progression,
			athlete
		});
		title = 'Progresjon';
	}

	if (cached && cached.fingerprint === fingerprint && cached.expiresAt > now) {
		return { ...cached.value, cached: true };
	}

	const generated = await callInsightModel(prompt);
	const result: Omit<InsightResult, 'cached'> = {
		ok: true,
		scope: args.scope,
		title: generated.title || title || 'Innsikt',
		summary: generated.summary,
		highlights: generated.highlights,
		model: MODEL,
		generatedAt: new Date().toISOString()
	};
	insightCache.set(key, {
		value: result,
		fingerprint,
		expiresAt: now + CACHE_TTL_MS
	});

	return { ...result, cached: false };
}

export class InsightNotFoundError extends Error {}
