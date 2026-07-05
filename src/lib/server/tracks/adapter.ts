import { and, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { sensorEvents, trackSessions } from '$lib/db/schema';
import { buildActualsSnapshot } from '$lib/server/programs/repository';
import type {
	ProgramDTO,
	ProgramSessionDTO,
	ProgramSummaryDTO,
	ProgramWeekDTO,
	SessionCompletionDTO
} from '$lib/server/programs/types';
import {
	computeTrackStates,
	countCompletedSessions,
	evaluateAndMarkMilestones,
	getPlanById,
	getSessionsForPlan,
	getTrackSessionById,
	upsertSuggestedSession,
	type TrackSessionRow,
	type TrainingPlanRow,
	type TrackStates
} from './repository';
import { isoWeekday, weekNumberAt } from './curve';
import { computeStrengthState, nextStrengthSession, summarizeStrengthSession } from './strength-engine';

/**
 * Ekko-kompatibilitetslaget: serverer treningsløpene gjennom den eksisterende
 * /api/apps/programs-kontrakten (plan-id = programId utad), byte-for-byte som
 * dokumentert i docs/archive/EKKO_PROGRAMS_INTEGRATION.md. Programmet "vokser
 * når det leves": weeks bygges av materialiserte track_sessions, ikke av et
 * pre-generert tre.
 */

/** Er id-en en treningsplan (ny modell)? Ellers faller rutene tilbake til legacy. */
export async function resolveTrackPlan(userId: string, id: string): Promise<TrainingPlanRow | null> {
	// UUID-format kreves før DB-oppslag (unngå kast på ugyldig input)
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
	return getPlanById(userId, id);
}

function toCompletionDTO(row: TrackSessionRow): SessionCompletionDTO | null {
	if (row.status !== 'completed' || !row.completedAt) return null;
	return {
		id: row.id,
		plannedSessionId: row.id,
		sensorEventId: row.sensorEventId,
		completedAt: row.completedAt.toISOString(),
		actuals: row.actuals ?? undefined
	};
}

export function toSessionDTO(row: TrackSessionRow, plan: TrainingPlanRow): ProgramSessionDTO {
	const payload = row.payload;
	return {
		id: row.id,
		weekNumber: weekNumberAt(plan.startDate, row.date),
		dayNumber: isoWeekday(row.date),
		kind: row.kind === 'run' ? 'run' : 'strength',
		name: payload.name,
		restSeconds: payload.restSeconds,
		plannedExercises: payload.plannedExercises?.map((e, i) => ({ order: i + 1, ...e })),
		plannedRun: payload.plannedRun,
		notes: payload.notes,
		isTest: payload.isTest,
		testType: payload.testType as ProgramSessionDTO['testType'],
		completion: toCompletionDTO(row)
	};
}

export async function getTrackProgramSummary(userId: string, plan: TrainingPlanRow): Promise<ProgramSummaryDTO> {
	const [sessions, completed] = await Promise.all([
		getSessionsForPlan(userId, plan.id),
		countCompletedSessions(userId, plan.id)
	]);
	return {
		id: plan.id,
		name: plan.name,
		goal: 'To løp: styrke (100 armhevinger, 3 pull-ups, 60s planke) + utholdenhet (22 km/uke @ 5:30)',
		durationWeeks: plan.durationWeeks,
		sessionsPerWeek: 6,
		status: plan.status as ProgramSummaryDTO['status'],
		startDate: plan.startDate,
		includeStrength: true,
		includeRunning: true,
		createdAt: plan.createdAt.toISOString(),
		completedSessions: completed,
		totalSessions: sessions.length
	};
}

export async function getTrackFullProgram(userId: string, plan: TrainingPlanRow): Promise<ProgramDTO> {
	const sessions = await getSessionsForPlan(userId, plan.id);
	const byWeek = new Map<number, ProgramSessionDTO[]>();
	for (const row of sessions) {
		const dto = toSessionDTO(row, plan);
		const list = byWeek.get(dto.weekNumber) ?? [];
		list.push(dto);
		byWeek.set(dto.weekNumber, list);
	}

	const weeks: ProgramWeekDTO[] = [...byWeek.entries()]
		.sort(([a], [b]) => a - b)
		.map(([weekNumber, weekSessions]) => ({
			weekNumber,
			deload: false,
			sessions: weekSessions.sort((a, b) => a.dayNumber - b.dayNumber)
		}));

	const summary = await getTrackProgramSummary(userId, plan);
	return {
		id: plan.id,
		userId,
		name: plan.name,
		goal: summary.goal,
		durationWeeks: plan.durationWeeks,
		sessionsPerWeek: summary.sessionsPerWeek,
		status: summary.status,
		includeStrength: true,
		includeRunning: true,
		startDate: plan.startDate,
		createdAt: plan.createdAt.toISOString(),
		updatedAt: plan.updatedAt.toISOString(),
		generatedWith: null,
		weeks
	};
}

export interface TrackTodayResult {
	session: ProgramSessionDTO;
	weekNumber: number;
	programStartDate: string;
	states: TrackStates;
	trackSessionId: string;
}

/**
 * Dagens økt: materialiserer motorforslaget som track_sessions-rad (stabil
 * plannedSessionId), eller returnerer en allerede materialisert/fullført rad.
 * Null = hviledag.
 */
export async function getTrackTodaySession(
	userId: string,
	plan: TrainingPlanRow,
	date?: string
): Promise<{ result: TrackTodayResult | null; states: TrackStates }> {
	const day = date ?? new Date().toISOString().slice(0, 10);
	const states = await computeTrackStates(userId, plan, day);

	// Registrert/fullført trening i dag vinner ALLTID — «i dag løp jeg» skal
	// aldri vises som «hvile foreslått». (Auto-koblet av reconcile i
	// computeTrackStates, eller satt av complete-session.)
	const existing = await db
		.select()
		.from(trackSessions)
		.where(and(eq(trackSessions.planId, plan.id), eq(trackSessions.userId, userId), eq(trackSessions.date, day)));
	const nonSuggested = existing.find((r) => r.status === 'completed') ?? existing.find((r) => r.status === 'skipped');
	if (nonSuggested) {
		const dto = toSessionDTO(nonSuggested, plan);
		return {
			result: {
				session: dto,
				weekNumber: dto.weekNumber,
				programStartDate: plan.startDate,
				states,
				trackSessionId: nonSuggested.id
			},
			states
		};
	}

	// Planen legger kun inn løp. Uten løpsforslag: høy belastning → ekte
	// hviledag (null); ellers serveres de stående styrkemålene som VALGFRI
	// økt, så «dagens armhevinger» alltid er ett trykk unna i Ekko.
	let suggestion = states.todaySuggestion;
	let trackId = states.utholdenhetTrack?.id ?? null;
	if (!suggestion) {
		if (states.restReason || !states.strengthSuggestion || !states.styrkeTrack) {
			return { result: null, states };
		}
		suggestion = {
			...states.strengthSuggestion,
			notes: 'Valgfri styrke — ingen planlagt økt i dag. Gjør den når det passer.'
		};
		trackId = states.styrkeTrack.id;
	}
	if (!trackId) return { result: null, states };

	const row = await upsertSuggestedSession(userId, plan.id, trackId, day, suggestion);
	const dto = toSessionDTO(row, plan);
	return {
		result: {
			session: dto,
			weekNumber: dto.weekNumber,
			programStartDate: plan.startDate,
			states,
			trackSessionId: row.id
		},
		states
	};
}

export interface CompleteTrackSessionResult {
	completion: SessionCompletionDTO;
	plannedSession: { id: string; kind: 'strength' | 'run'; weekNumber: number; dayNumber: number };
	progression: { applied: boolean; summary: string[] };
}

function fmtPace(secPerKm: number): string {
	const m = Math.floor(secPerKm / 60);
	const s = Math.round(secPerKm - m * 60);
	return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Fullfører en track-økt: snapshot av actuals fra sensorEvent, progresjons-
 * oppsummering fra motorene og milepæl-sjekk. Idempotent per plannedSessionId.
 */
export async function completeTrackSession(
	userId: string,
	plan: TrainingPlanRow,
	input: { plannedSessionId: string; sensorEventId?: string | null; completedAt?: Date }
): Promise<CompleteTrackSessionResult | null> {
	const row = await getTrackSessionById(userId, input.plannedSessionId);
	if (!row || row.planId !== plan.id) return null;

	let actuals: TrackSessionRow['actuals'] = row.actuals;
	let validatedSensorEventId: string | null = row.sensorEventId;
	if (input.sensorEventId) {
		const event = await db.query.sensorEvents.findFirst({
			where: and(eq(sensorEvents.id, input.sensorEventId), eq(sensorEvents.userId, userId))
		});
		if (event) {
			validatedSensorEventId = event.id;
			actuals = buildActualsSnapshot(row.kind === 'run' ? 'run' : 'strength', event);
		}
	}

	const completedAt = input.completedAt ?? new Date();
	const [updated] = await db
		.update(trackSessions)
		.set({
			status: 'completed',
			completedAt,
			sensorEventId: validatedSensorEventId,
			actuals,
			updatedAt: new Date()
		})
		.where(eq(trackSessions.id, row.id))
		.returning();

	// Progresjonsoppsummering: tilstanden ETTER økten (motorene leser faktiske data)
	const summary: string[] = [];
	try {
		const states = await computeTrackStates(userId, plan);
		if (row.kind === 'strength' && states.strengthState) {
			const s = states.strengthState;
			// Fullføringen kan ha kommet uten sensorEvent — bruk actuals-snapshotet
			// som fallback-kilde for "siste" hvis motorene ikke ser økten ennå.
			const fromActuals =
				actuals?.exercises && actuals.exercises.length > 0
					? summarizeStrengthSession({ date: updated.date, exercises: actuals.exercises })
					: null;
			const armSiste = s.armhevinger.siste ?? fromActuals?.armhevingerTotal ?? null;
			if (armSiste != null) {
				const state = fromActuals
					? computeStrengthState(
							[...states.strengthSessions, { date: updated.date, exercises: actuals!.exercises! }],
							{
								armhevinger: states.styrkeTrack?.goal?.armhevinger ?? { fra: 10, til: 100 },
								planke: states.styrkeTrack?.goal?.planke ?? { fraSek: 30, tilSek: 60 }
							},
							{
								startDate: states.styrkeTrack?.startDate ?? plan.startDate,
								targetDate: states.styrkeTrack?.targetDate ?? plan.startDate
							},
							updated.date
						)
					: s;
				summary.push(`Armhevinger: ${armSiste} → neste mål ${state.armhevinger.nesteTarget}`);
				if (state.planke.sisteSek != null) {
					summary.push(`Planke: ${state.planke.sisteSek}s → neste mål ${state.planke.nesteTargetSek}s`);
				}
				if (state.pullup.fase === 'negativer' && state.pullup.nesteTarget.negativSek != null) {
					summary.push(`Pull-up: negativer → neste mål ${state.pullup.nesteTarget.negativSek}s`);
				} else if (state.pullup.nesteTarget.reps != null) {
					summary.push(`Pull-up: strikte → neste mål ${state.pullup.nesteTarget.reps} reps`);
				}
			}
		} else if (row.kind === 'run' && states.enduranceState) {
			const e = states.enduranceState;
			summary.push(`Løpeuke: ${e.week.runKm} av ${e.week.weekTargetKm} km`);
			if (e.sistePaceSekPerKm != null) {
				summary.push(`Pace: ${fmtPace(e.sistePaceSekPerKm)} (forventet ${fmtPace(e.forventetPaceSekPerKm)})`);
			}
			if (states.budget) {
				const b = states.budget;
				summary.push(`Effort denne uka: ${b.spentThisWeek} av ${b.bandMin}–${b.bandMax}`);
			}
		}

		const achieved = await evaluateAndMarkMilestones(userId, states);
		for (const name of achieved) summary.push(`Milepæl nådd: ${name}`);
	} catch (err) {
		console.error('[tracks/adapter] progresjonsoppsummering feilet:', err);
	}

	const dto = toSessionDTO(updated, plan);
	return {
		completion: toCompletionDTO(updated)!,
		plannedSession: {
			id: updated.id,
			kind: dto.kind,
			weekNumber: dto.weekNumber,
			dayNumber: dto.dayNumber
		},
		progression: { applied: summary.length > 0, summary }
	};
}

/** Regelbasert innsikt for løpene — `summary` er alltid satt (Ekko-garantien). */
export async function buildTrackInsight(
	userId: string,
	plan: TrainingPlanRow,
	scope: 'week' | 'progression'
): Promise<{ scope: string; title: string; summary: string; highlights: string[] }> {
	const states = await computeTrackStates(userId, plan);
	const highlights: string[] = [];
	const e = states.enduranceState;
	const s = states.strengthState;

	if (scope === 'week') {
		if (e) {
			highlights.push(`Løping: ${e.week.runKm} av ${e.week.weekTargetKm} km denne uken.`);
			if (e.week.deload) highlights.push('Deload-uke — redusert volum er meningen.');
			if (e.week.stallRebased) highlights.push('Uketarget er justert ned etter en rolig forrige uke.');
		}
		if (states.budget) {
			const b = states.budget;
			highlights.push(`Effort (løp + sykkel): ${b.spentThisWeek} av ${b.bandMin}–${b.bandMax} denne uka.`);
			if (b.restRecommended) highlights.push('Høy belastning siste 3 dager — hvil eller hold det rolig.');
			if (states.effortComposition) highlights.push(states.effortComposition);
		}
		if (s?.armhevinger.siste != null) {
			highlights.push(`Styrke: sist ${s.armhevinger.siste} armhevinger — neste mål ${s.armhevinger.nesteTarget}.`);
		}
		const summary =
			highlights[0] ?? 'Ingen registrerte økter denne uken ennå — dagens forslag ligger klart.';
		return { scope, title: 'Denne uken', summary, highlights };
	}

	if (s) {
		const armPct = Math.round(((s.armhevinger.siste ?? 0) / 100) * 100);
		highlights.push(`Armhevinger: ${s.armhevinger.siste ?? 0} av 100 (${armPct} %).`);
		highlights.push(
			s.pullup.fase === 'negativer'
				? `Pull-up: negativ-fasen, sist ${s.pullup.sisteNegativSek ?? 0}s av 20s.`
				: `Pull-up: strikte-fasen, sist ${s.pullup.sisteReps ?? 0} av 3 reps.`
		);
		if (s.planke.sisteSek != null) highlights.push(`Planke: ${s.planke.sisteSek}s av 60s.`);
	}
	if (e) {
		highlights.push(`Ukesvolum-mål nå: ${e.week.weekTargetKm} km (mot 22 km).`);
		if (e.sistePaceSekPerKm != null) {
			highlights.push(`Pace: ${fmtPace(e.sistePaceSekPerKm)}/km (kurven sier ${fmtPace(e.forventetPaceSekPerKm)}/km, mål 5:30).`);
		}
	}
	const summary = highlights[0] ?? 'Løpene er i gang — registrer økter i Ekko så bygges progresjonen herfra.';
	return { scope, title: 'Progresjon', summary, highlights };
}

/**
 * Setter inn en test-økt som track_session på beregnet dato. Testtypen avgjør
 * hvilket løp den hører til (løpstester → utholdenhet, styrketester → styrke).
 */
export async function insertTrackTest(
	userId: string,
	plan: TrainingPlanRow,
	input: { testType: string; weekNumber: number; dayNumber: number }
): Promise<ProgramSessionDTO | null> {
	const states = await computeTrackStates(userId, plan);
	const isRunTest = input.testType.startsWith('cooper') || input.testType.startsWith('time_');
	const track = isRunTest ? states.utholdenhetTrack : states.styrkeTrack;
	if (!track) return null;

	const start = new Date(`${plan.startDate}T00:00:00Z`);
	start.setUTCDate(start.getUTCDate() + (input.weekNumber - 1) * 7 + (input.dayNumber - 1));
	const date = start.toISOString().slice(0, 10);

	const suggestion = isRunTest
		? {
				kind: 'run' as const,
				name: `Test: ${input.testType}`,
				plannedRun: { runType: 'easy' as const, notes: 'Testøkt — gi alt, registrer resultatet.' }
			}
		: {
				kind: 'strength' as const,
				name: `Test: ${input.testType}`,
				plannedExercises: [],
				notes: 'Testøkt — én maks-utførelse.'
			};

	const row = await upsertSuggestedSession(userId, plan.id, track.id, date, suggestion);
	// Merk raden som test i payload
	const [updated] = await db
		.update(trackSessions)
		.set({ payload: { ...row.payload, isTest: true, testType: input.testType }, updatedAt: new Date() })
		.where(eq(trackSessions.id, row.id))
		.returning();
	return toSessionDTO(updated, plan);
}

/** Kompakt tekst-kontekst om løpene til coach-endepunktet. */
export async function buildTrackCoachContext(userId: string, plan: TrainingPlanRow): Promise<string> {
	const insight = await buildTrackInsight(userId, plan, 'progression');
	const week = await buildTrackInsight(userId, plan, 'week');
	return [
		`Treningsløp «${plan.name}» (${plan.durationWeeks} uker fra ${plan.startDate}):`,
		...insight.highlights,
		...week.highlights
	].join('\n');
}
