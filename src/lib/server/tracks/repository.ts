import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db, rowsOf } from '$lib/db';
import {
	canonicalWorkouts,
	sensorEvents,
	trackMilestones,
	trackSessions,
	trainingPlans,
	trainingTracks
} from '$lib/db/schema';
import { classifyEffortFamily } from '$lib/server/services/effort-service';
import { fmtMinutter } from '$lib/util/duration';
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
	DEFAULT_STRENGTH_GOAL,
	ENDURANCE_MILESTONES,
	PULLUP_PHASES,
	STRENGTH_MILESTONES
} from './constants';
import {
	bestStrengthMetrics,
	computeStrengthState,
	nextStrengthSession,
	summarizeStrengthSession
} from './strength-engine';
import {
	bestWeekRunKm,
	computeEnduranceState,
	countsTowardEndurance,
	isRunFamily,
	nextEnduranceSession
} from './endurance-engine';
import { computeEffortBudget, composeEffortSuggestion } from './effort-budget';
import { computeBalanceState, type BalanceState } from './balance';
import { getRecentRouteLabels } from './routes-repository';
import { fetchActiveTrip } from '$lib/server/programs/readiness';
import { deriveWeekdayPattern, suggestSessionForDate, type WeekdayPattern } from './schedule';
import type { EffortBudget } from './types';

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

	// schedule seedes IKKE — løpedagene læres av faktisk atferd
	// (deriveWeekdayPattern); schedule.days er kun manuell overstyring.
	const [plan] = await db
		.insert(trainingPlans)
		.values({
			userId,
			name: 'Treningsløp',
			status: 'active',
			startDate,
			durationWeeks
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
				effortVekstFaktor: DEFAULT_ENDURANCE_CONFIG.effortVekstFaktor,
				hvileRatioTerskel: DEFAULT_ENDURANCE_CONFIG.hvileRatioTerskel
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

	// Seed startruter (pendlerunde, vannrunden, bakke) — prefylt med brukerens pace
	const { seedDefaultRoutes } = await import('./routes-repository');
	await seedDefaultRoutes(userId, opts.enduranceBaseline?.paceSekPerKm ?? null).catch((err) =>
		console.warn('[tracks] rute-seeding feilet:', err)
	);

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
	/** Stående styrkemål — planlegges aldri på dager, men er alltid tilgjengelige (Ekko). */
	strengthSuggestion: SessionSuggestion | null;
	enduranceSuggestion: SessionSuggestion | null;
	todayOwner: 'utholdenhet' | 'hvile';
	todaySuggestion: SessionSuggestion | null;
	/** Begrunnelse når dagens forslag er hvile pga. belastning/budsjett. */
	restReason: string | null;
	budget: EffortBudget | null;
	/** Balanse/variasjon: disiplin-miks, styrke-dekning, intensitetsspredning + én nudge. */
	balance: BalanceState | null;
	/** Forslag til sammensetning av gjenstående ukeseffort («8 km løp + 45 min sykkel»). */
	effortComposition: string | null;
	pattern: WeekdayPattern;
	/** Gjennomført (registrert) trening i dag — vinner alltid over forslag i visning. */
	todayCompleted: TrackSessionRow | null;
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
		effortVekstFaktor: config.effortVekstFaktor ?? DEFAULT_ENDURANCE_CONFIG.effortVekstFaktor,
		hvileRatioTerskel: config.hvileRatioTerskel ?? DEFAULT_ENDURANCE_CONFIG.hvileRatioTerskel
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

	// Auto-kobling: registrert trening siste uke materialiseres som gjennomførte
	// økter — «i dag løp jeg» skal aldri vises som «hvile foreslått».
	await reconcileSessionsWithActuals(
		userId,
		plan,
		{ styrkeTrack, utholdenhetTrack },
		strengthSessions,
		enduranceWorkouts,
		today
	);

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

	// Vedlikeholdsmodus ved aktiv reise/ferie: senk effort-båndet så en lett uke
	// på reise ikke leses som svikt.
	const activeTrip = await fetchActiveTrip(userId, today).catch(() => null);
	const budget = utholdenhetTrack
		? computeEffortBudget(
				enduranceWorkouts,
				enduranceConfigOf(utholdenhetTrack),
				plan.startDate,
				today,
				!!activeTrip
			)
		: null;
	const effortComposition =
		budget && enduranceState
			? composeEffortSuggestion(budget.remainingMin, budget.remainingMax, enduranceState.forventetPaceSekPerKm)
			: null;

	// Balanse: referanse-pace for intensitetssoner = faktisk snitt siste 14 dager,
	// ellers kurve. Styrke-dekning teller også rå sensor_events-datoer. Rute-labels
	// (fra Ekko-tagget metadata) gir rotasjons-nudgen.
	const balanceEasyPace =
		enduranceState?.sistePaceSekPerKm ?? enduranceState?.forventetPaceSekPerKm ?? null;
	const routeLabels = await getRecentRouteLabels(userId, LOOKBACK_DAYS).catch(() => []);
	const balance = computeBalanceState(
		enduranceWorkouts,
		strengthSessions.map((s) => s.date),
		balanceEasyPace,
		today,
		routeLabels
	);

	const pattern = deriveWeekdayPattern(enduranceWorkouts, today);
	const scheduleDays = plan.schedule?.days;
	const { owner, suggestion, restReason } = suggestSessionForDate(
		today,
		scheduleDays,
		pattern,
		enduranceSuggestion,
		budget
	);

	// Gjennomført trening i dag (auto-koblet eller via complete-session) vinner i visning
	const todayRows = await db
		.select()
		.from(trackSessions)
		.where(and(eq(trackSessions.planId, plan.id), eq(trackSessions.userId, userId), eq(trackSessions.date, today)));
	const todayCompleted = todayRows.find((r) => r.status === 'completed') ?? null;

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
		restReason,
		budget,
		balance,
		effortComposition,
		pattern,
		todayCompleted,
		strengthSessions,
		enduranceWorkouts
	};
}

// ─── Auto-kobling (reconcile) ────────────────────────────────────────────────

const RECONCILE_DAYS = 7;

function noonOf(date: string): Date {
	return new Date(`${date}T12:00:00Z`);
}

/**
 * Materialiserer registrert trening siste ~uke som gjennomførte track_sessions:
 * styrkeøkter → styrke-løpet, løp/sykkel → utholdenhetsløpet. Idempotent —
 * rader som alt er completed røres ikke; suggested-rader oppgraderes;
 * manglende rader opprettes direkte som completed. Ekkos complete-session
 * forblir støttet og beriker med eksplisitt sensorEventId.
 */
export async function reconcileSessionsWithActuals(
	userId: string,
	plan: TrainingPlanRow,
	tracks: { styrkeTrack: TrainingTrackRow | null; utholdenhetTrack: TrainingTrackRow | null },
	strengthSessions: StrengthSessionActual[],
	enduranceWorkouts: EnduranceWorkout[],
	today: string
): Promise<void> {
	const cutoff = new Date(`${today}T00:00:00Z`);
	cutoff.setUTCDate(cutoff.getUTCDate() - (RECONCILE_DAYS - 1));
	const cutoffIso = cutoff.toISOString().slice(0, 10);

	// Grupper per dato
	const strengthByDate = new Map<string, StrengthSessionActual[]>();
	for (const s of strengthSessions) {
		if (s.date < cutoffIso || s.date > today) continue;
		const list = strengthByDate.get(s.date) ?? [];
		list.push(s);
		strengthByDate.set(s.date, list);
	}
	const enduranceByDate = new Map<string, EnduranceWorkout[]>();
	for (const w of enduranceWorkouts) {
		if (w.date < cutoffIso || w.date > today || !countsTowardEndurance(w.family)) continue;
		const list = enduranceByDate.get(w.date) ?? [];
		list.push(w);
		enduranceByDate.set(w.date, list);
	}

	if (strengthByDate.size === 0 && enduranceByDate.size === 0) return;

	// Eksisterende rader i vinduet i ett oppslag
	const existing = await db
		.select()
		.from(trackSessions)
		.where(
			and(
				eq(trackSessions.planId, plan.id),
				eq(trackSessions.userId, userId),
				gte(trackSessions.date, cutoffIso)
			)
		);
	const byTrackDate = new Map<string, TrackSessionRow>();
	for (const row of existing) byTrackDate.set(`${row.trackId}:${row.date}`, row);

	// Styrke
	if (tracks.styrkeTrack) {
		for (const [date, sessions] of strengthByDate) {
			const exercises = sessions.flatMap((s) => s.exercises);
			const summary = summarizeStrengthSession({ date, exercises });
			await upsertCompletedSession(userId, plan.id, tracks.styrkeTrack.id, date, byTrackDate, {
				kind: 'strength',
				name: summary.armhevingerTotal > 0 ? `Styrke (${summary.armhevingerTotal} armhevinger)` : 'Styrke',
				actuals: { kind: 'strength', totalReps: summary.armhevingerTotal || undefined, exercises }
			});
		}
	}

	// Utholdenhet (løp + sykkel)
	if (tracks.utholdenhetTrack) {
		for (const [date, workouts] of enduranceByDate) {
			const runKm = workouts.filter((w) => isRunFamily(w.family)).reduce((s, w) => s + (w.distanceMeters ?? 0) / 1000, 0);
			const rideMin = workouts
				.filter((w) => !isRunFamily(w.family))
				.reduce((s, w) => s + (w.durationSeconds ?? 0) / 60, 0);
			const parts: string[] = [];
			if (runKm > 0) parts.push(`Løp ${runKm.toFixed(1).replace('.', ',')} km`);
			if (rideMin > 0) parts.push(`Sykkel ${fmtMinutter(rideMin)}`);
			const totalDistance = workouts.reduce((s, w) => s + (w.distanceMeters ?? 0), 0);
			const totalDuration = workouts.reduce((s, w) => s + (w.durationSeconds ?? 0), 0);
			await upsertCompletedSession(userId, plan.id, tracks.utholdenhetTrack.id, date, byTrackDate, {
				kind: 'run',
				name: parts.join(' + ') || 'Utholdenhet',
				actuals: {
					kind: 'run',
					distance: totalDistance > 0 ? Math.round(totalDistance) : undefined,
					duration: totalDuration > 0 ? Math.round(totalDuration) : undefined,
					sportType: workouts[0]?.family
				}
			});
		}
	}
}

async function upsertCompletedSession(
	userId: string,
	planId: string,
	trackId: string,
	date: string,
	byTrackDate: Map<string, TrackSessionRow>,
	input: {
		kind: 'strength' | 'run';
		name: string;
		actuals: NonNullable<TrackSessionRow['actuals']>;
	}
): Promise<void> {
	const existing = byTrackDate.get(`${trackId}:${date}`);
	if (existing?.status === 'completed') return;

	if (existing) {
		// Oppgrader forslag → gjennomført. Payload SKRIVES OM til det som faktisk
		// ble gjort — et materialisert «Rolig løp»-forslag skal ikke stå som
		// gjennomført når registreringen var to el-sykkeløkter.
		await db
			.update(trackSessions)
			.set({
				status: 'completed',
				kind: input.kind,
				payload: { name: input.name },
				completedAt: existing.completedAt ?? noonOf(date),
				actuals: input.actuals,
				updatedAt: new Date()
			})
			.where(eq(trackSessions.id, existing.id));
		return;
	}

	await db.insert(trackSessions).values({
		userId,
		trackId,
		planId,
		date,
		kind: input.kind,
		payload: { name: input.name },
		status: 'completed',
		completedAt: noonOf(date),
		actuals: input.actuals
	});
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
	// ukes_lop_km-milepælene måles i rene løpe-km — sykkel teller ikke
	const enduranceBest = states.utholdenhetTrack ? bestWeekRunKm(states.enduranceWorkouts) : 0;

	const achieved: string[] = [];
	for (const milestone of pending) {
		const { metric, value } = milestone.criteria;
		// 'ukes_km' aksepteres defensivt (gammelt navn før metric-rename-migreringen)
		const current = metric === 'ukes_lop_km' || metric === 'ukes_km' ? enduranceBest : (strengthBest[metric] ?? 0);
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

/**
 * Siste beregnede vekt-terskel fra effort/vekt-signalet (cachet daglig av
 * domain-signals-cronen). Null når modellen ikke har funnet noen terskel.
 */
export async function getLatestWeightThreshold(
	userId: string
): Promise<{ thresholdEffort: number; source: string } | null> {
	const result = await db.execute(sql`
		SELECT context
		FROM domain_signals
		WHERE user_id = ${userId}
		  AND signal_type = 'health_effort_vs_threshold'
		ORDER BY observed_at DESC
		LIMIT 1
	`);
	const rows = rowsOf<{ context: Record<string, unknown> | null }>(result);
	const context = (rows[0]?.context ?? {}) as Record<string, unknown>;
	const threshold = context.thresholdEffort;
	if (typeof threshold !== 'number' || threshold <= 0) return null;
	return {
		thresholdEffort: Math.round(threshold),
		source: typeof context.thresholdSource === 'string' ? context.thresholdSource : 'regresjon'
	};
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
