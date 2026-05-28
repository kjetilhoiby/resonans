import { db } from '$lib/db';
import {
	programReadinessAssessments,
	programSessions,
	programWeeks,
	sensorEvents,
	themes,
	trainingPrograms
} from '$lib/db/schema';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { getActiveEgenfrekvensFlags } from '$lib/server/egenfrekvens-checkin';
import { generateSessionAlternative } from './session-alternative';
import { sessionPlannedDate, mondayOf } from './repository';
import type { ProgramSessionDTO } from './types';

export type ReadinessState = 'klar' | 'lett' | 'easy' | 'rest';

export type SignalFlag = 'red' | 'yellow' | 'green' | 'unknown';

export interface ReadinessSignals {
	sleep: {
		score: number | null; // siste natt
		nights: Array<{ date: string; score: number | null }>;
		flag: SignalFlag;
	};
	egenfrekvens: {
		level: number | null;
		balance: number | null;
		loggedAt: string | null;
		flag: SignalFlag;
	};
	sick: { active: boolean; until: string | null };
	crunch: { active: boolean; until: string | null };
	trip: {
		active: boolean;
		themeId: string | null;
		destination: string | null;
		endDate: string | null;
	};
}

export interface ReadinessAlternative {
	kind: 'strength' | 'run' | 'rest';
	name: string;
	summary: string;
	plannedRun?: {
		runType: 'easy' | 'tempo' | 'intervals' | 'long';
		targetDistanceMeters?: number;
		targetDurationSeconds?: number;
		paceHintSecPerKm?: number;
		hrZoneHint?: string;
		notes?: string;
	};
	plannedExercises?: Array<{
		exerciseName: string;
		sets: number;
		repsTarget?: number;
		durationSecondsTarget?: number;
		notes?: string;
	}>;
	rationale: string;
}

export interface ReadinessAssessment {
	state: ReadinessState;
	reasons: string[];
	signals: ReadinessSignals;
	alternative: ReadinessAlternative | null;
	// Hvis det ikke er planlagt økt i dag (hviledag), er plannedSession null
	plannedSession: ProgramSessionDTO | null;
	plannedSessionDate: string;
	programId: string;
	cached: boolean;
}

function todayIsoDate(): string {
	return new Date().toISOString().slice(0, 10);
}

/**
 * Henter siste 3 nettsøvn for bruker (sensor_events.dataType = 'sleep').
 * Returnerer sortert nyeste først.
 */
async function fetchRecentSleep(
	userId: string,
	today: string
): Promise<Array<{ date: string; score: number | null }>> {
	// 4 dager bakover for å være sikker på å fange siste 3 netter
	const cutoff = new Date(today + 'T00:00:00Z');
	cutoff.setUTCDate(cutoff.getUTCDate() - 4);

	const rows = await db
		.select({
			data: sensorEvents.data,
			timestamp: sensorEvents.timestamp
		})
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'sleep'),
				gte(sensorEvents.timestamp, cutoff)
			)
		)
		.orderBy(desc(sensorEvents.timestamp))
		.limit(5);

	const seen = new Set<string>();
	const nights: Array<{ date: string; score: number | null }> = [];
	for (const row of rows) {
		const date = row.timestamp.toISOString().slice(0, 10);
		if (seen.has(date)) continue;
		seen.add(date);
		const data = (row.data ?? {}) as Record<string, unknown>;
		const score = typeof data.sleepScore === 'number' ? data.sleepScore : null;
		nights.push({ date, score });
		if (nights.length >= 3) break;
	}
	return nights;
}

function evaluateSleepFlag(nights: Array<{ score: number | null }>): SignalFlag {
	const scored = nights.filter((n) => n.score !== null) as Array<{ score: number }>;
	if (scored.length === 0) return 'unknown';
	const last = scored[0].score;
	const prev = scored[1]?.score;
	// Rød: siste natt < 40, eller to netter på rad < 50
	if (last < 40) return 'red';
	if (last < 50 && prev !== undefined && prev < 50) return 'red';
	// Gul: siste < 65 og forrige < 65, eller siste < 55
	if (last < 55) return 'yellow';
	if (last < 65 && prev !== undefined && prev < 65) return 'yellow';
	return 'green';
}

function evaluateEgenfrekvensFlag(level: number | null, balance: number | null): SignalFlag {
	if (level === null) return 'unknown';
	if (level <= 2) return 'red';
	if (balance !== null && balance <= -2) return 'red';
	if (level === 3 && balance !== null && balance < 0) return 'yellow';
	return 'green';
}

async function fetchActiveTrip(
	userId: string,
	today: string
): Promise<{ themeId: string; destination: string | null; endDate: string | null } | null> {
	const rows = await db
		.select({ id: themes.id, tripProfile: themes.tripProfile })
		.from(themes)
		.where(and(eq(themes.userId, userId), eq(themes.archived, false)));

	for (const row of rows) {
		const trip = row.tripProfile;
		if (!trip || !trip.startDate || !trip.endDate) continue;
		if (today >= trip.startDate && today <= trip.endDate) {
			return {
				themeId: row.id,
				destination: trip.destination ?? trip.country ?? null,
				endDate: trip.endDate
			};
		}
	}
	return null;
}

/**
 * Konservativ terskel:
 *   - rest: sick aktiv, eller 3+ røde
 *   - easy: 2+ røde, eller (1 rød + 1 gul) med crunch aktiv
 *   - lett: 1 rød eller 2 gule
 *   - klar: ellers
 */
function deriveState(signals: ReadinessSignals): { state: ReadinessState; reasons: string[] } {
	const reasons: string[] = [];
	if (signals.sick.active) {
		reasons.push(`Markert syk t.o.m. ${signals.sick.until}`);
		return { state: 'rest', reasons };
	}

	const flags: SignalFlag[] = [signals.sleep.flag, signals.egenfrekvens.flag];
	const reds = flags.filter((f) => f === 'red').length;
	const yellows = flags.filter((f) => f === 'yellow').length;

	if (signals.sleep.flag === 'red') {
		const last = signals.sleep.nights[0];
		if (last?.score !== null && last?.score !== undefined) {
			reasons.push(`Søvn ${last.score}`);
		} else {
			reasons.push('Søvn lavt to netter');
		}
	} else if (signals.sleep.flag === 'yellow') {
		reasons.push(`Søvn redusert (${signals.sleep.nights[0]?.score ?? '?'})`);
	}

	if (signals.egenfrekvens.flag === 'red') {
		if (signals.egenfrekvens.level !== null) {
			reasons.push(`Egenfrekvens ${signals.egenfrekvens.level}/5`);
		} else {
			reasons.push('Egenfrekvens lavt');
		}
	} else if (signals.egenfrekvens.flag === 'yellow') {
		reasons.push(`Egenfrekvens ${signals.egenfrekvens.level}/5`);
	}

	if (signals.crunch.active) {
		reasons.push(`Crunch t.o.m. ${signals.crunch.until}`);
	}
	if (signals.trip.active && signals.trip.destination) {
		reasons.push(`På reise (${signals.trip.destination})`);
	}

	if (reds >= 3) return { state: 'rest', reasons };
	if (reds >= 2) return { state: 'easy', reasons };
	if (reds >= 1 && yellows >= 1 && signals.crunch.active) {
		return { state: 'easy', reasons };
	}
	if (reds >= 1) return { state: 'lett', reasons };
	if (yellows >= 2) return { state: 'lett', reasons };
	if (yellows >= 1 && signals.crunch.active) return { state: 'lett', reasons };

	if (reasons.length === 0) reasons.push('Søvn ok, egenfrekvens balansert');
	return { state: 'klar', reasons };
}

function buildFingerprint(args: {
	plannedSessionId: string | null;
	signals: ReadinessSignals;
	state: ReadinessState;
}): string {
	const payload = {
		plannedSessionId: args.plannedSessionId,
		state: args.state,
		sleep: args.signals.sleep.flag,
		egenfrekvens: args.signals.egenfrekvens.flag,
		sick: args.signals.sick.active,
		crunch: args.signals.crunch.active,
		trip: args.signals.trip.active
	};
	return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32);
}

async function fetchPlannedSessionForDate(
	userId: string,
	programId: string,
	date: string
): Promise<{ session: ProgramSessionDTO | null; weekNumber: number | null }> {
	const program = await db.query.trainingPrograms.findFirst({
		where: and(eq(trainingPrograms.id, programId), eq(trainingPrograms.userId, userId)),
		columns: { id: true, startDate: true, durationWeeks: true }
	});
	if (!program) return { session: null, weekNumber: null };

	const startDate =
		typeof program.startDate === 'string'
			? program.startDate
			: new Date(program.startDate as unknown as Date).toISOString().slice(0, 10);

	if (date < startDate) return { session: null, weekNumber: null };

	// Ankre mot mandagen i startuka, slik at dayNumber = ekte ukedag.
	const week1Monday = mondayOf(startDate);
	const weekOffset = Math.floor(
		(new Date(mondayOf(date) + 'T00:00:00Z').getTime() -
			new Date(week1Monday + 'T00:00:00Z').getTime()) /
			(1000 * 60 * 60 * 24 * 7)
	);
	const weekNumber = weekOffset + 1;
	if (weekNumber < 1 || weekNumber > program.durationWeeks)
		return { session: null, weekNumber: null };
	const dow = new Date(date + 'T00:00:00Z').getUTCDay();
	const dayNumber = ((dow + 6) % 7) + 1;

	const week = await db.query.programWeeks.findFirst({
		where: and(eq(programWeeks.programId, programId), eq(programWeeks.weekNumber, weekNumber)),
		columns: { id: true }
	});
	if (!week) return { session: null, weekNumber };

	const session = await db.query.programSessions.findFirst({
		where: and(eq(programSessions.weekId, week.id), eq(programSessions.dayNumber, dayNumber)),
		with: { exercises: true }
	});
	if (!session) return { session: null, weekNumber };

	const dto: ProgramSessionDTO = {
		id: session.id,
		weekNumber,
		dayNumber: session.dayNumber,
		kind: session.kind === 'run' ? 'run' : 'strength',
		name: session.name,
		restSeconds: session.restSeconds ?? undefined,
		plannedRun: (session.plannedRun as any) ?? undefined,
		notes: session.notes ?? undefined,
		isTest: session.isTest || undefined,
		testType: (session.testType as any) ?? undefined,
		plannedExercises: session.exercises?.map((e) => ({
			id: e.id,
			order: e.order,
			exerciseName: e.exerciseName,
			sets: e.sets,
			repsTarget: e.repsTarget ?? undefined,
			durationSecondsTarget: e.durationSecondsTarget ?? undefined,
			weightHint: e.weightHint ?? undefined,
			notes: e.notes ?? undefined
		})),
		completion: null
	};
	return { session: dto, weekNumber };
}

/**
 * Hovedinngangen: returnerer dagens tilstand-vurdering for et program.
 * Cacher resultatet i program_readiness_assessments — nytt AI-kall kun
 * når signal-fingerprint endres.
 */
export async function evaluateProgramReadiness(args: {
	userId: string;
	programId: string;
	date?: string;
}): Promise<ReadinessAssessment> {
	const date = args.date ?? todayIsoDate();
	const { userId, programId } = args;

	// 1. Samle inn signaler
	const [nights, egenfrekvens, trip] = await Promise.all([
		fetchRecentSleep(userId, date),
		getActiveEgenfrekvensFlags(userId, date),
		fetchActiveTrip(userId, date)
	]);

	const lastNight = nights[0] ?? null;
	const signals: ReadinessSignals = {
		sleep: {
			score: lastNight?.score ?? null,
			nights,
			flag: evaluateSleepFlag(nights)
		},
		egenfrekvens: {
			level: egenfrekvens.level,
			balance: egenfrekvens.balance,
			loggedAt: egenfrekvens.loggedAt,
			flag: evaluateEgenfrekvensFlag(egenfrekvens.level, egenfrekvens.balance)
		},
		sick: egenfrekvens.sick,
		crunch: egenfrekvens.crunch,
		trip: {
			active: !!trip,
			themeId: trip?.themeId ?? null,
			destination: trip?.destination ?? null,
			endDate: trip?.endDate ?? null
		}
	};

	// 2. Beregn state
	const { state, reasons } = deriveState(signals);

	// 3. Hent dagens planlagte økt (kan være null på hviledager)
	const { session: plannedSession } = await fetchPlannedSessionForDate(userId, programId, date);
	const plannedSessionId = plannedSession?.id ?? null;
	const fingerprint = buildFingerprint({ plannedSessionId, signals, state });

	// 4. Cache-oppslag
	const existing = await db.query.programReadinessAssessments.findFirst({
		where: and(
			eq(programReadinessAssessments.userId, userId),
			eq(programReadinessAssessments.programId, programId),
			eq(programReadinessAssessments.assessmentDate, date)
		)
	});

	if (existing && existing.signalFingerprint === fingerprint) {
		return {
			state: existing.state as ReadinessState,
			reasons: existing.reasons ?? reasons,
			signals: (existing.signals as ReadinessSignals) ?? signals,
			alternative: (existing.alternative as ReadinessAlternative | null) ?? null,
			plannedSession,
			plannedSessionDate: date,
			programId,
			cached: true
		};
	}

	// 5. Generer alternativ-økt hvis state ≠ klar OG det er en planlagt økt
	let alternative: ReadinessAlternative | null = null;
	if (state !== 'klar') {
		if (!plannedSession) {
			// Hviledag — ingen bytte nødvendig, men vi forklarer state
			alternative = {
				kind: 'rest',
				name: 'Hvile',
				summary: 'Hviledag — bare lytt til kroppen.',
				rationale: reasons.join(', ')
			};
		} else if (state === 'rest') {
			alternative = {
				kind: 'rest',
				name: 'Hopp dagen',
				summary: 'Hopp dagens økt og hvil.',
				rationale: reasons.join(', ')
			};
		} else {
			alternative = await generateSessionAlternative({
				userId,
				originalSession: plannedSession,
				state,
				reasons,
				signals
			});
		}
	}

	// 6. Upsert i cache
	await db
		.insert(programReadinessAssessments)
		.values({
			userId,
			programId,
			plannedSessionId,
			assessmentDate: date,
			state,
			reasons,
			signals: signals as any,
			alternative: alternative as any,
			signalFingerprint: fingerprint
		})
		.onConflictDoUpdate({
			target: [
				programReadinessAssessments.userId,
				programReadinessAssessments.programId,
				programReadinessAssessments.assessmentDate
			],
			set: {
				plannedSessionId,
				state,
				reasons,
				signals: signals as any,
				alternative: alternative as any,
				signalFingerprint: fingerprint,
				updatedAt: new Date()
			}
		});

	return {
		state,
		reasons,
		signals,
		alternative,
		plannedSession,
		plannedSessionDate: date,
		programId,
		cached: false
	};
}

/**
 * Logger brukerens valg (alternative eller original). Brukes både til audit
 * og som hint for fremtidig kalibrering.
 */
export async function recordReadinessChoice(args: {
	userId: string;
	programId: string;
	date: string;
	choice: 'alternative' | 'original';
}): Promise<boolean> {
	const updated = await db
		.update(programReadinessAssessments)
		.set({ userChoice: args.choice, userChoiceAt: new Date(), updatedAt: new Date() })
		.where(
			and(
				eq(programReadinessAssessments.userId, args.userId),
				eq(programReadinessAssessments.programId, args.programId),
				eq(programReadinessAssessments.assessmentDate, args.date)
			)
		)
		.returning({ id: programReadinessAssessments.id });
	return updated.length > 0;
}

export function sessionDateForToday(programStartDate: string, weekNumber: number, dayNumber: number): string {
	return sessionPlannedDate(programStartDate, weekNumber, dayNumber);
}

// Bevisst eksponert for cron-jobben som forhåndsgenererer alternatives natt-tid
export async function precomputeReadinessForAllActivePrograms(date?: string): Promise<{
	programsChecked: number;
	assessmentsWritten: number;
}> {
	const targetDate = date ?? todayIsoDate();
	const programs = await db
		.select({ id: trainingPrograms.id, userId: trainingPrograms.userId })
		.from(trainingPrograms)
		.where(eq(trainingPrograms.status, 'active'));

	let written = 0;
	for (const program of programs) {
		try {
			const result = await evaluateProgramReadiness({
				userId: program.userId,
				programId: program.id,
				date: targetDate
			});
			if (!result.cached) written += 1;
		} catch (error) {
			console.error(`[readiness] precompute failed for program ${program.id}:`, error);
		}
	}

	return { programsChecked: programs.length, assessmentsWritten: written };
}
