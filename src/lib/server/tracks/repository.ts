import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import {
	canonicalWorkouts,
	sensorEvents,
	trackMilestones,
	trackSessions,
	trainingPlans,
	trainingTracks
} from '$lib/db/schema';
import { classifyEffortFamily } from '$lib/server/services/effort-service';
import type {
	EnduranceConfig,
	EnduranceGoal,
	EnduranceState,
	EnduranceWorkout,
	SessionSuggestion,
	StrengthGoal,
	StrengthSessionActual,
	StrengthState,
	TrackWindow
} from './types';
import {
	DEFAULT_ENDURANCE_CONFIG,
	DEFAULT_ENDURANCE_GOAL,
	DEFAULT_PLAN_DURATION_WEEKS,
	DEFAULT_SCHEDULE,
	DEFAULT_STRENGTH_GOAL,
	ENDURANCE_MILESTONES,
	PULLUP_PHASES,
	STRENGTH_MILESTONES
} from './constants';
import {
	bestStrengthMetrics,
	computeStrengthState,
	nextStrengthSession
} from './strength-engine';
import { bestWeekEqKm, computeEnduranceState, nextEnduranceSession } from './endurance-engine';
import { suggestSessionForDate } from './schedule';

export type TrainingPlanRow = typeof trainingPlans.$inferSelect;
export type TrainingTrackRow = typeof trainingTracks.$inferSelect;
export type TrackMilestoneRow = typeof trackMilestones.$inferSelect;
export type TrackSessionRow = typeof trackSessions.$inferSelect;

const LOOKBACK_DAYS = 42; // 6 uker inn i motorene

function todayIso(): string {
	return new Date().toISOString().slice(0, 10);
}

function addWeeks(iso: string, weeks: number): string {
	const d = new Date(`${iso}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + weeks * 7);
	return d.toISOString().slice(0, 10);
}

// ─── Plan + tracks ───────────────────────────────────────────────────────────

export async function getActivePlan(userId: string): Promise<TrainingPlanRow | null> {
	const rows = await db
		.select()
		.from(trainingPlans)
		.where(and(eq(trainingPlans.userId, userId), eq(trainingPlans.status, 'active')))
		.orderBy(desc(trainingPlans.createdAt))
		.limit(1);
	return rows[0] ?? null;
}

export async function getPlanById(userId: string, planId: string): Promise<TrainingPlanRow | null> {
	const rows = await db
		.select()
		.from(trainingPlans)
		.where(and(eq(trainingPlans.id, planId), eq(trainingPlans.userId, userId)))
		.limit(1);
	return rows[0] ?? null;
}

export async function getTracksForPlan(planId: string): Promise<TrainingTrackRow[]> {
	return db.select().from(trainingTracks).where(eq(trainingTracks.planId, planId)).orderBy(asc(trainingTracks.kind));
}

export async function getMilestonesForTracks(trackIds: string[]): Promise<TrackMilestoneRow[]> {
	if (trackIds.length === 0) return [];
	return db
		.select()
		.from(trackMilestones)
		.where(inArray(trackMilestones.trackId, trackIds))
		.orderBy(asc(trackMilestones.order));
}

/**
 * Oppretter plan + de to løpene + milepæler. Idempotent per bruker:
 * returnerer eksisterende aktiv plan hvis den finnes.
 */
export async function createDefaultPlan(
	userId: string,
	opts: {
		startDate?: string;
		durationWeeks?: number;
		strengthBaseline?: { armhevingerPerOkt?: number; plankeSekunder?: number; pullupNegativSekunder?: number };
		enduranceBaseline?: { ukesKm?: number; paceSekPerKm?: number };
	} = {}
): Promise<{ plan: TrainingPlanRow; tracks: TrainingTrackRow[] }> {
	const existing = await getActivePlan(userId);
	if (existing) {
		return { plan: existing, tracks: await getTracksForPlan(existing.id) };
	}

	const startDate = opts.startDate ?? todayIso();
	const durationWeeks = opts.durationWeeks ?? DEFAULT_PLAN_DURATION_WEEKS;
	const targetDate = addWeeks(startDate, durationWeeks);
	const recordedAt = new Date().toISOString();

	const [plan] = await db
		.insert(trainingPlans)
		.values({
			userId,
			name: 'Treningsløp',
			status: 'active',
			startDate,
			durationWeeks,
			schedule: { days: Object.fromEntries(Object.entries(DEFAULT_SCHEDULE).map(([k, v]) => [k, v])) }
		})
		.returning();

	const [styrke] = await db
		.insert(trainingTracks)
		.values({
			userId,
			planId: plan.id,
			kind: 'styrke',
			name: 'Styrke',
			status: 'active',
			startDate,
			targetDate,
			baseline: {
				armhevingerPerOkt: opts.strengthBaseline?.armhevingerPerOkt ?? DEFAULT_STRENGTH_GOAL.armhevinger.fra,
				plankeSekunder: opts.strengthBaseline?.plankeSekunder ?? DEFAULT_STRENGTH_GOAL.planke.fraSek,
				pullupNegativSekunder: opts.strengthBaseline?.pullupNegativSekunder ?? 10,
				recordedAt
			},
			goal: {
				armhevinger: {
					fra: opts.strengthBaseline?.armhevingerPerOkt ?? DEFAULT_STRENGTH_GOAL.armhevinger.fra,
					til: DEFAULT_STRENGTH_GOAL.armhevinger.til
				},
				planke: {
					fraSek: opts.strengthBaseline?.plankeSekunder ?? DEFAULT_STRENGTH_GOAL.planke.fraSek,
					tilSek: DEFAULT_STRENGTH_GOAL.planke.tilSek
				},
				pullup: { faser: PULLUP_PHASES.map((p) => ({ navn: p.navn, kriterium: `${p.criteria.metric}>=${p.criteria.value}` })) }
			}
		})
		.returning();

	const [utholdenhet] = await db
		.insert(trainingTracks)
		.values({
			userId,
			planId: plan.id,
			kind: 'utholdenhet',
			name: 'Utholdenhet',
			status: 'active',
			startDate,
			targetDate,
			baseline: {
				ukesKm: opts.enduranceBaseline?.ukesKm ?? DEFAULT_ENDURANCE_GOAL.ukesKm.fra,
				paceSekPerKm: opts.enduranceBaseline?.paceSekPerKm ?? DEFAULT_ENDURANCE_GOAL.paceSekPerKm.fra,
				recordedAt
			},
			goal: {
				ukesKm: {
					fra: opts.enduranceBaseline?.ukesKm ?? DEFAULT_ENDURANCE_GOAL.ukesKm.fra,
					til: DEFAULT_ENDURANCE_GOAL.ukesKm.til
				},
				paceSekPerKm: {
					fra: opts.enduranceBaseline?.paceSekPerKm ?? DEFAULT_ENDURANCE_GOAL.paceSekPerKm.fra,
					til: DEFAULT_ENDURANCE_GOAL.paceSekPerKm.til
				}
			},
			config: {
				deloadHverNteUke: DEFAULT_ENDURANCE_CONFIG.deloadHverNteUke,
				maksIkkeLopAndel: DEFAULT_ENDURANCE_CONFIG.maksIkkeLopAndel
			}
		})
		.returning();

	const milestoneRows = [
		...[...STRENGTH_MILESTONES, ...PULLUP_PHASES].map((m, i) => ({
			userId,
			trackId: styrke.id,
			order: i + 1,
			name: m.navn,
			criteria: { ...m.criteria } as { metric: string; value: number; manual?: boolean }
		})),
		...ENDURANCE_MILESTONES.map((m, i) => ({
			userId,
			trackId: utholdenhet.id,
			order: i + 1,
			name: m.navn,
			criteria: { ...m.criteria } as { metric: string; value: number; manual?: boolean }
		}))
	];
	await db.insert(trackMilestones).values(milestoneRows);

	return { plan, tracks: [styrke, utholdenhet] };
}

// ─── Faktiske økter inn i motorene ───────────────────────────────────────────

/**
 * Styrkeøkter leses fra rå sensor_events fordi canonical_workouts stripper
 * exercises[]-detaljene. Ekko-spec-en sier dataType='strength_workout', men
 * klassifiseringen er defensiv: også dataType='workout' med styrke-sportType
 * og exercises-data telles.
 */
export async function getStrengthSessions(userId: string, sinceDays = LOOKBACK_DAYS): Promise<StrengthSessionActual[]> {
	const since = new Date(Date.now() - sinceDays * 24 * 3600_000);
	const rows = await db
		.select({
			timestamp: sensorEvents.timestamp,
			dataType: sensorEvents.dataType,
			data: sensorEvents.data
		})
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				gte(sensorEvents.timestamp, since),
				inArray(sensorEvents.dataType, ['workout', 'strength_workout']),
				sql`NOT COALESCE((${sensorEvents.metadata}->>'dismissed')::boolean, false)`
			)
		)
		.orderBy(asc(sensorEvents.timestamp));

	const sessions: StrengthSessionActual[] = [];
	for (const row of rows) {
		const data = (row.data ?? {}) as Record<string, unknown>;
		const sportType = typeof data.sportType === 'string' ? data.sportType : null;
		const isStrength =
			row.dataType === 'strength_workout' || classifyEffortFamily(sportType) === 'strength';
		if (!isStrength) continue;
		const exercises = Array.isArray(data.exercises) ? data.exercises : [];
		if (exercises.length === 0) continue;
		sessions.push({
			date: row.timestamp.toISOString().slice(0, 10),
			exercises: exercises
				.map((e) => {
					const ex = (e ?? {}) as Record<string, unknown>;
					const name = typeof ex.name === 'string' ? ex.name : '';
					const sets = Array.isArray(ex.sets) ? ex.sets : [];
					return {
						name,
						sets: sets.map((s) => {
							const set = (s ?? {}) as Record<string, unknown>;
							return {
								reps: typeof set.reps === 'number' ? set.reps : undefined,
								durationSeconds: typeof set.durationSeconds === 'number' ? set.durationSeconds : undefined,
								weight: typeof set.weight === 'number' ? set.weight : undefined
							};
						})
					};
				})
				.filter((e) => e.name.length > 0)
		});
	}
	return sessions;
}

/** Utholdenhetsøkter leses fra canonical_workouts (dedupet, med effortScore). */
export async function getEnduranceWorkouts(userId: string, sinceDays = LOOKBACK_DAYS): Promise<EnduranceWorkout[]> {
	const since = new Date(Date.now() - sinceDays * 24 * 3600_000);
	const rows = await db
		.select({
			startTime: canonicalWorkouts.startTime,
			sportType: canonicalWorkouts.sportType,
			sportFamily: canonicalWorkouts.sportFamily,
			distanceMeters: canonicalWorkouts.distanceMeters,
			durationSeconds: canonicalWorkouts.durationSeconds,
			effortScore: canonicalWorkouts.effortScore
		})
		.from(canonicalWorkouts)
		.where(and(eq(canonicalWorkouts.userId, userId), gte(canonicalWorkouts.startTime, since)))
		.orderBy(asc(canonicalWorkouts.startTime));

	return rows.map((row) => ({
		date: row.startTime.toISOString().slice(0, 10),
		family: classifyEffortFamily(row.sportType, row.sportFamily),
		effortScore: row.effortScore != null ? Number(row.effortScore) : null,
		distanceMeters: row.distanceMeters != null ? Number(row.distanceMeters) : null,
		durationSeconds: row.durationSeconds != null ? Number(row.durationSeconds) : null
	}));
}

// ─── Samlet tilstand ─────────────────────────────────────────────────────────

export interface TrackStates {
	plan: TrainingPlanRow;
	styrkeTrack: TrainingTrackRow | null;
	utholdenhetTrack: TrainingTrackRow | null;
	strengthState: StrengthState | null;
	enduranceState: EnduranceState | null;
	strengthSuggestion: SessionSuggestion | null;
	enduranceSuggestion: SessionSuggestion | null;
	todayOwner: 'styrke' | 'utholdenhet' | 'hvile';
	todaySuggestion: SessionSuggestion | null;
	strengthSessions: StrengthSessionActual[];
	enduranceWorkouts: EnduranceWorkout[];
}

function strengthGoalOf(track: TrainingTrackRow): StrengthGoal {
	const goal = track.goal ?? {};
	return {
		armhevinger: goal.armhevinger ?? DEFAULT_STRENGTH_GOAL.armhevinger,
		planke: goal.planke ?? DEFAULT_STRENGTH_GOAL.planke
	};
}

function enduranceGoalOf(track: TrainingTrackRow): EnduranceGoal {
	const goal = track.goal ?? {};
	return {
		ukesKm: goal.ukesKm ?? DEFAULT_ENDURANCE_GOAL.ukesKm,
		paceSekPerKm: goal.paceSekPerKm ?? DEFAULT_ENDURANCE_GOAL.paceSekPerKm
	};
}

function enduranceConfigOf(track: TrainingTrackRow): EnduranceConfig {
	const config = track.config ?? {};
	return {
		deloadHverNteUke: config.deloadHverNteUke ?? DEFAULT_ENDURANCE_CONFIG.deloadHverNteUke,
		maksIkkeLopAndel: config.maksIkkeLopAndel ?? DEFAULT_ENDURANCE_CONFIG.maksIkkeLopAndel
	};
}

function windowOf(track: TrainingTrackRow): TrackWindow {
	return { startDate: track.startDate, targetDate: track.targetDate };
}

export async function computeTrackStates(
	userId: string,
	plan: TrainingPlanRow,
	date?: string
): Promise<TrackStates> {
	const today = date ?? todayIso();
	const tracks = await getTracksForPlan(plan.id);
	const styrkeTrack = tracks.find((t) => t.kind === 'styrke') ?? null;
	const utholdenhetTrack = tracks.find((t) => t.kind === 'utholdenhet') ?? null;

	const [strengthSessions, enduranceWorkouts] = await Promise.all([
		getStrengthSessions(userId),
		getEnduranceWorkouts(userId)
	]);

	const strengthState = styrkeTrack
		? computeStrengthState(strengthSessions, strengthGoalOf(styrkeTrack), windowOf(styrkeTrack), today)
		: null;
	const enduranceState = utholdenhetTrack
		? computeEnduranceState(
				enduranceWorkouts,
				enduranceGoalOf(utholdenhetTrack),
				enduranceConfigOf(utholdenhetTrack),
				windowOf(utholdenhetTrack),
				today
			)
		: null;

	const strengthSuggestion = strengthState ? nextStrengthSession(strengthState) : null;
	const weekdayNumber = ((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
	const enduranceSuggestion = enduranceState ? nextEnduranceSession(enduranceState, weekdayNumber) : null;

	const scheduleDays = plan.schedule?.days;
	const { owner, suggestion } = suggestSessionForDate(today, scheduleDays, strengthSuggestion, enduranceSuggestion);

	return {
		plan,
		styrkeTrack,
		utholdenhetTrack,
		strengthState,
		enduranceState,
		strengthSuggestion,
		enduranceSuggestion,
		todayOwner: owner,
		todaySuggestion: suggestion,
		strengthSessions,
		enduranceWorkouts
	};
}

// ─── Milepæler ───────────────────────────────────────────────────────────────

/**
 * Sjekker automatiske milepæler mot faktiske registreringer og markerer
 * oppnådde. Manuelle (criteria.manual) hoppes over — de hukes av i UI.
 * Returnerer navnene på nylig oppnådde milepæler.
 */
export async function evaluateAndMarkMilestones(userId: string, states: TrackStates): Promise<string[]> {
	const trackIds = [states.styrkeTrack?.id, states.utholdenhetTrack?.id].filter((id): id is string => !!id);
	const milestones = await getMilestonesForTracks(trackIds);
	const pending = milestones.filter((m) => !m.achievedAt && !m.criteria.manual);
	if (pending.length === 0) return [];

	const strengthBest = bestStrengthMetrics(states.strengthSessions);
	let enduranceBest = 0;
	if (states.utholdenhetTrack) {
		enduranceBest = bestWeekEqKm(
			states.enduranceWorkouts,
			enduranceGoalOf(states.utholdenhetTrack),
			enduranceConfigOf(states.utholdenhetTrack),
			windowOf(states.utholdenhetTrack)
		);
	}

	const achieved: string[] = [];
	for (const milestone of pending) {
		const { metric, value } = milestone.criteria;
		const current = metric === 'ukes_km' ? enduranceBest : (strengthBest[metric] ?? 0);
		if (current >= value) {
			await db
				.update(trackMilestones)
				.set({ achievedAt: new Date(), updatedAt: new Date() })
				.where(eq(trackMilestones.id, milestone.id));
			achieved.push(milestone.name);
		}
	}
	return achieved;
}

export async function setMilestoneAchieved(
	userId: string,
	milestoneId: string,
	achieved: boolean
): Promise<boolean> {
	const result = await db
		.update(trackMilestones)
		.set({ achievedAt: achieved ? new Date() : null, updatedAt: new Date() })
		.where(and(eq(trackMilestones.id, milestoneId), eq(trackMilestones.userId, userId)))
		.returning({ id: trackMilestones.id });
	return result.length > 0;
}

// ─── Track-sessions (Ekko-ankeret) ───────────────────────────────────────────

/**
 * Materialiserer dagens forslag som track_sessions-rad (upsert på track_id+date)
 * slik at Ekko får en stabil plannedSessionId. Fullførte rader overskrives aldri.
 */
export async function upsertSuggestedSession(
	userId: string,
	planId: string,
	trackId: string,
	date: string,
	suggestion: SessionSuggestion
): Promise<TrackSessionRow> {
	const existing = await db
		.select()
		.from(trackSessions)
		.where(and(eq(trackSessions.trackId, trackId), eq(trackSessions.date, date)))
		.limit(1);

	if (existing[0]) {
		if (existing[0].status !== 'suggested') return existing[0];
		const [updated] = await db
			.update(trackSessions)
			.set({
				kind: suggestion.kind,
				payload: {
					name: suggestion.name,
					restSeconds: suggestion.restSeconds,
					plannedExercises: suggestion.plannedExercises,
					plannedRun: suggestion.plannedRun,
					notes: suggestion.notes
				},
				updatedAt: new Date()
			})
			.where(eq(trackSessions.id, existing[0].id))
			.returning();
		return updated;
	}

	const [created] = await db
		.insert(trackSessions)
		.values({
			userId,
			trackId,
			planId,
			date,
			kind: suggestion.kind,
			payload: {
				name: suggestion.name,
				restSeconds: suggestion.restSeconds,
				plannedExercises: suggestion.plannedExercises,
				plannedRun: suggestion.plannedRun,
				notes: suggestion.notes
			},
			status: 'suggested'
		})
		.returning();
	return created;
}

export async function getTrackSessionById(userId: string, sessionId: string): Promise<TrackSessionRow | null> {
	const rows = await db
		.select()
		.from(trackSessions)
		.where(and(eq(trackSessions.id, sessionId), eq(trackSessions.userId, userId)))
		.limit(1);
	return rows[0] ?? null;
}

export async function getSessionsForPlan(userId: string, planId: string): Promise<TrackSessionRow[]> {
	return db
		.select()
		.from(trackSessions)
		.where(and(eq(trackSessions.planId, planId), eq(trackSessions.userId, userId)))
		.orderBy(asc(trackSessions.date));
}

export async function setPlanStatus(userId: string, planId: string, status: string): Promise<boolean> {
	const result = await db
		.update(trainingPlans)
		.set({ status, updatedAt: new Date() })
		.where(and(eq(trainingPlans.id, planId), eq(trainingPlans.userId, userId)))
		.returning({ id: trainingPlans.id });
	return result.length > 0;
}

/** Lagrer Ekkos mode-valg i preferences — treningsløp har ingen adaptiv modus (no-op). */
export async function setPlanPreferenceMode(userId: string, planId: string, mode: string): Promise<boolean> {
	const plan = await getPlanById(userId, planId);
	if (!plan) return false;
	await db
		.update(trainingPlans)
		.set({ preferences: { ...(plan.preferences ?? {}), mode }, updatedAt: new Date() })
		.where(eq(trainingPlans.id, planId));
	return true;
}

export async function countCompletedSessions(userId: string, planId: string): Promise<number> {
	const rows = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(trackSessions)
		.where(
			and(
				eq(trackSessions.planId, planId),
				eq(trackSessions.userId, userId),
				eq(trackSessions.status, 'completed')
			)
		);
	return rows[0]?.count ?? 0;
}
