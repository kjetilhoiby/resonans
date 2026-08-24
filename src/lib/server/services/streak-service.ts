/**
 * streak-service.ts — Kobler streak-definisjoner mot hendelsesdata.
 *
 * Streaks lagres aldri som en teller. De beregnes on-demand fra hendelser
 * (canonical_workouts / sensor_events), på samme måte som målprogresjon leses
 * i goal-progress.ts. Da kan en økt som kommer inn fra Withings i etterkant
 * reparere streaken automatisk, og en feilberegning fikses ved neste lasting.
 *
 * Regel-semantikken bor i $lib/domain/streaks.ts (ren, testet). Denne filen
 * gjør bare tre ting: hent riktige hendelser, oversett til Oslo-lokale
 * dagsnøkler, og delegér til computeStreak.
 */
import { db } from '$lib/db';
import { canonicalWorkouts, sensorEvents, sensors, streakDefinitions } from '$lib/db/schema';
import { and, asc, eq, gte, sql } from 'drizzle-orm';
import { osloDayKey } from '$lib/server/trip-geo';
import {
	computeStreak,
	type StreakConfig,
	type StreakRule,
	type StreakSource,
	type StreakState
} from '$lib/domain/streaks';
import { countByDay, type StreakHistoryDay } from '$lib/domain/streak-history';
import { normalizeDistanceMeters } from '$lib/server/activity-layer';
import {
	buildDayScale,
	type DayScale,
	type WorkoutDayMetrics
} from '$lib/domain/health/workout-day-scale';
import {
	isStreakInHealthFamily,
	isStreakRelevantForTheme,
	type StreakRelevanceTarget
} from '$lib/domain/streak-relevance';

/** Hvor langt tilbake vi leser hendelser. Nok til å finne beste rekke uten å lese alt. */
const LOOKBACK_DAYS = 400;

/** dataType for manuelt loggede streak-runder (hårklipp, badevask, …). */
export const STREAK_LOG_DATA_TYPE = 'streak_log';

export interface StreakDefinition {
	id: string;
	title: string;
	emoji: string;
	rule: StreakRule;
	source: StreakSource;
	config: StreakConfig;
	active: boolean;
	sortOrder: number;
	themeId: string | null;
}

export interface StreakWithState {
	definition: StreakDefinition;
	state: StreakState;
}

function toDefinition(row: typeof streakDefinitions.$inferSelect): StreakDefinition {
	return {
		id: row.id,
		title: row.title,
		emoji: row.emoji,
		rule: row.rule as StreakRule,
		source: row.source as StreakSource,
		config: (row.config ?? {}) as StreakConfig,
		active: row.active,
		sortOrder: row.sortOrder,
		themeId: (row.metadata as { themeId?: string } | null)?.themeId ?? null
	};
}

/* ── Definisjoner (CRUD) ──────────────────────────────────── */

export async function listStreakDefinitions(
	userId: string,
	opts: { includeInactive?: boolean } = {}
): Promise<StreakDefinition[]> {
	const rows = await db
		.select()
		.from(streakDefinitions)
		.where(
			opts.includeInactive
				? eq(streakDefinitions.userId, userId)
				: and(eq(streakDefinitions.userId, userId), eq(streakDefinitions.active, true))
		)
		.orderBy(asc(streakDefinitions.sortOrder), asc(streakDefinitions.createdAt));
	return rows.map(toDefinition);
}

export interface StreakDefinitionInput {
	id?: string;
	title: string;
	emoji?: string;
	rule: StreakRule;
	source: StreakSource;
	config?: StreakConfig;
	active?: boolean;
	sortOrder?: number;
	themeId?: string | null;
}

export async function upsertStreakDefinition(
	userId: string,
	input: StreakDefinitionInput
): Promise<StreakDefinition> {
	const values = {
		userId,
		title: input.title.trim(),
		emoji: input.emoji?.trim() || '🔥',
		rule: input.rule,
		source: input.source,
		config: input.config ?? {},
		...(input.active !== undefined ? { active: input.active } : {}),
		...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
		metadata: input.themeId ? { themeId: input.themeId } : {}
	};

	if (input.id) {
		const [updated] = await db
			.update(streakDefinitions)
			.set({ ...values, updatedAt: new Date() })
			.where(and(eq(streakDefinitions.id, input.id), eq(streakDefinitions.userId, userId)))
			.returning();
		if (!updated) throw new Error('Streak ikke funnet');
		return toDefinition(updated);
	}

	const [created] = await db.insert(streakDefinitions).values(values).returning();
	return toDefinition(created);
}

export async function deleteStreakDefinition(userId: string, id: string): Promise<void> {
	await db
		.delete(streakDefinitions)
		.where(and(eq(streakDefinitions.id, id), eq(streakDefinitions.userId, userId)));
}

/* ── Manuell logging av runder ────────────────────────────── */

/** Sensor for manuelt loggede streak-runder. Samme mønster som chore_log. */
async function ensureStreakLogSensor(userId: string) {
	const existing = await db.query.sensors.findFirst({
		where: and(eq(sensors.userId, userId), eq(sensors.provider, 'streak_log'))
	});
	if (existing) return existing;
	const [created] = await db
		.insert(sensors)
		.values({
			userId,
			provider: 'streak_log',
			type: 'manual_log',
			subtype: 'streak',
			name: 'Streaks',
			isActive: true,
			config: {}
		})
		.returning();
	return created;
}

/**
 * Logg en gjennomført runde for en manuell streak (hårklipp, badevask, …).
 * Returnerer event-id-en, slik at kallstedet kan angre ved å slette den.
 *
 * Kun for `source.kind === 'manual'` — de andre kildene fanges automatisk fra
 * treningsdata/sensorer, og en manuell logg der ville ikke blitt talt.
 */
export async function logStreakRound(
	userId: string,
	definitionId: string,
	at: Date = new Date()
): Promise<string> {
	const [definition] = await db
		.select()
		.from(streakDefinitions)
		.where(and(eq(streakDefinitions.id, definitionId), eq(streakDefinitions.userId, userId)))
		.limit(1);
	if (!definition) throw new Error('Streak ikke funnet');

	const source = definition.source as StreakSource;
	if (source.kind !== 'manual') {
		throw new Error(
			`Streaken «${definition.title}» hentes fra ${source.kind} og kan ikke logges manuelt`
		);
	}

	const sensor = await ensureStreakLogSensor(userId);

	// Unikhets-indeksen er (sensorId, dataType, timestamp), og alle manuelle streaks
	// deler én sensor. To ulike streaks etterregistrert på samme dato får identisk
	// tidsstempel, så en konflikt betyr ikke nødvendigvis at *denne* runden finnes.
	// Er den alt logget, returner den; ellers nudg tidsstempelet og prøv igjen.
	for (let attempt = 0; attempt < 5; attempt++) {
		const timestamp = new Date(at.getTime() + attempt);
		const [event] = await db
			.insert(sensorEvents)
			.values({
				userId,
				sensorId: sensor.id,
				eventType: 'activity',
				dataType: STREAK_LOG_DATA_TYPE,
				timestamp,
				data: { definitionId, title: definition.title },
				metadata: { manual: true }
			})
			.onConflictDoNothing()
			.returning({ id: sensorEvents.id });
		if (event) return event.id;

		const [existing] = await db
			.select({ id: sensorEvents.id })
			.from(sensorEvents)
			.where(
				and(
					eq(sensorEvents.userId, userId),
					eq(sensorEvents.dataType, STREAK_LOG_DATA_TYPE),
					eq(sensorEvents.timestamp, timestamp),
					sql`${sensorEvents.data}->>'definitionId' = ${definitionId}`
				)
			)
			.limit(1);
		if (existing) return existing.id;
	}

	throw new Error(`Kunne ikke logge runde for «${definition.title}» — for mange kollisjoner`);
}

/** Angre en logget runde. */
export async function deleteStreakRound(userId: string, eventId: string): Promise<void> {
	await db
		.delete(sensorEvents)
		.where(and(eq(sensorEvents.id, eventId), eq(sensorEvents.userId, userId)));
}

/* ── Beregning ────────────────────────────────────────────── */

/** Hent Oslo-lokale dagsnøkler for hendelsene bak én definisjon. Duplikater bevares. */
async function readEventDayKeys(
	userId: string,
	definition: StreakDefinition,
	since: Date
): Promise<string[]> {
	const source = definition.source;

	if (source.kind === 'workout') {
		const rows = await db
			.select({ at: canonicalWorkouts.startTime })
			.from(canonicalWorkouts)
			.where(
				and(
					eq(canonicalWorkouts.userId, userId),
					eq(canonicalWorkouts.sportFamily, source.sportFamily),
					gte(canonicalWorkouts.startTime, since)
				)
			);
		return rows.map((r) => osloDayKey(r.at));
	}

	if (source.kind === 'sensor_event') {
		const rows = await db
			.select({ at: sensorEvents.timestamp, data: sensorEvents.data })
			.from(sensorEvents)
			.where(
				and(
					eq(sensorEvents.userId, userId),
					eq(sensorEvents.dataType, source.dataType),
					gte(sensorEvents.timestamp, since)
				)
			);
		const needle = source.textMatch?.toLowerCase().trim();
		return rows
			.filter((r) => {
				if (!needle) return true;
				// Fritekst-hendelser (f.eks. chore_done) matches på oppgavenavnet.
				const data = (r.data ?? {}) as Record<string, unknown>;
				const haystack = [data.task, data.title, data.text]
					.filter((v): v is string => typeof v === 'string')
					.join(' ')
					.toLowerCase();
				return haystack.includes(needle);
			})
			.map((r) => osloDayKey(r.at));
	}

	// Manuell: streak_log-events som peker på denne definisjonen.
	const rows = await db
		.select({ at: sensorEvents.timestamp })
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, STREAK_LOG_DATA_TYPE),
				gte(sensorEvents.timestamp, since),
				sql`${sensorEvents.data}->>'definitionId' = ${definition.id}`
			)
		);
	return rows.map((r) => osloDayKey(r.at));
}

/**
 * Les alle aktive streaks med beregnet tilstand. Kalles fra sidelastere —
 * én indeksert spørring per definisjon, kjørt parallelt.
 */
export async function loadStreaks(
	userId: string,
	opts: { includeInactive?: boolean; now?: Date } = {}
): Promise<StreakWithState[]> {
	const definitions = await listStreakDefinitions(userId, opts);
	if (definitions.length === 0) return [];

	const now = opts.now ?? new Date();
	const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);
	const todayKey = osloDayKey(now);

	return Promise.all(
		definitions.map(async (definition) => ({
			definition,
			state: computeStreak(
				definition,
				await readEventDayKeys(userId, definition, since),
				todayKey
			)
		}))
	);
}

/**
 * Streaks som hører på ett tema, med beregnet tilstand.
 *
 * Filtrerer på definisjonene FØR tilstanden regnes: relevansen er ren og krever
 * ingen hendelser, mens hver tilstand koster en spørring. Et tema uten relevante
 * streaks (film, økonomi) betaler da bare for definisjonslista.
 */
export async function loadRelevantStreaks(
	userId: string,
	target: StreakRelevanceTarget,
	opts: { now?: Date } = {}
): Promise<StreakWithState[]> {
	const definitions = (await listStreakDefinitions(userId)).filter((definition) =>
		isStreakRelevantForTheme(definition, target)
	);
	if (definitions.length === 0) return [];

	const now = opts.now ?? new Date();
	const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);
	const todayKey = osloDayKey(now);

	return Promise.all(
		definitions.map(async (definition) => ({
			definition,
			state: computeStreak(definition, await readEventDayKeys(userId, definition, since), todayKey)
		}))
	);
}

/**
 * Streaks i helse-familien, med beregnet tilstand.
 *
 * Samme mønster som `loadRelevantStreaks` — filtrer definisjonene FØR tilstanden
 * regnes, siden relevansen er ren og gratis mens hver tilstand er en spørring —
 * men bredere: helsechatten skal se trening, vekt, søvn, ernæring, skjermtid og
 * egenfrekvens i samme briefing.
 */
export async function loadHealthFamilyStreaks(
	userId: string,
	healthThemeIds: readonly string[],
	opts: { now?: Date } = {}
): Promise<StreakWithState[]> {
	const definitions = (await listStreakDefinitions(userId)).filter((definition) =>
		isStreakInHealthFamily(definition, healthThemeIds)
	);
	if (definitions.length === 0) return [];

	const now = opts.now ?? new Date();
	const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);
	const todayKey = osloDayKey(now);

	return Promise.all(
		definitions.map(async (definition) => ({
			definition,
			state: computeStreak(definition, await readEventDayKeys(userId, definition, since), todayKey)
		}))
	);
}

/**
 * Distanse og tempo per dag for en trenings-streak.
 *
 * Leser `canonical_workouts` — den dedupliserte utgaven — så samme tur skrevet av
 * klokka, Dropbox og Ekko teller én gang. Samme filter som `readEventDayKeys`
 * bruker, så kalenderens dager er de samme dagene telleren er bygget av.
 *
 * **Tempoet regnes på ELAPSED tid**, som er den eneste varigheten canonical bærer.
 * Glemmer man å stoppe sporingen, ser dagen derfor svært treg ut. Det er ikke rettet
 * her, men skalaen tåler det: persentiler gjør en slik dag til en ytterlighet framfor
 * til hele spennet. Se `moving-time.ts` for hvorfor korreksjonen bor i Ekko.
 */
async function readWorkoutDayMetrics(
	userId: string,
	sportFamily: string,
	since: Date
): Promise<WorkoutDayMetrics[]> {
	const rows = await db
		.select({
			at: canonicalWorkouts.startTime,
			distanceMeters: canonicalWorkouts.distanceMeters,
			durationSeconds: canonicalWorkouts.durationSeconds
		})
		.from(canonicalWorkouts)
		.where(
			and(
				eq(canonicalWorkouts.userId, userId),
				eq(canonicalWorkouts.sportFamily, sportFamily),
				gte(canonicalWorkouts.startTime, since)
			)
		);

	const byDay = new Map<string, { count: number; meters: number; seconds: number }>();
	for (const row of rows) {
		const day = osloDayKey(row.at);
		const entry = byDay.get(day) ?? { count: 0, meters: 0, seconds: 0 };
		entry.count += 1;
		// Aldri rått: verdier ≤ 80 tolkes som kilometer. Se workout-sport.ts.
		const meters = normalizeDistanceMeters(Number(row.distanceMeters));
		if (meters !== null) entry.meters += meters;
		const seconds = Number(row.durationSeconds);
		if (Number.isFinite(seconds) && seconds > 0) entry.seconds += seconds;
		byDay.set(day, entry);
	}

	return [...byDay.entries()]
		.map(([date, { count, meters, seconds }]) => {
			const distanceKm = meters > 0 ? Math.round((meters / 1000) * 100) / 100 : null;
			return {
				date,
				count,
				distanceKm,
				// Vektet tempo: hele dagens tid delt på hele dagens distanse. To turer
				// samme dag blir én verdi, og den lange veier mest — et snitt av
				// tempoene ville latt en kort spurt dominere en langtur.
				paceSecPerKm:
					distanceKm !== null && seconds > 0
						? Math.round(seconds / distanceKm)
						: null
			};
		})
		.sort((a, b) => (a.date < b.date ? -1 : 1));
}

export interface StreakHistory {
	definition: StreakDefinition;
	state: StreakState;
	/** Dager med hendelse, stigende. Antall per dag, siden duplikater teller. */
	days: StreakHistoryDay[];
	/** Hvor langt tilbake historikken er lest. Flaten skal kunne si det. */
	lookbackDays: number;
	/** Dagens Oslo-dato, så kalenderen ikke regner den ut på nytt. */
	today: string;
	/**
	 * Distanse og tempo per dag — bare for trenings-streaks. Null ellers, og da
	 * viser kalenderen ren tilstedeværelse.
	 */
	dayMetrics: WorkoutDayMetrics[] | null;
	/** Spennet dagene fargelegges mot, regnet av brukerens egne dager. */
	scale: DayScale | null;
	/** Idretten, så flaten kan velge «tempo» eller «fart». */
	sportFamily: string | null;
}

/**
 * Historikken bak én streak: dagene, og tilstanden regnet av de samme dagene.
 *
 * Samme kilde og samme vindu som `loadStreaks` bruker — kalenderen i
 * bunnpanelet skal vise nøyaktig de hendelsene telleren på kortet er bygget av.
 * En egen spørring med et annet vindu ville gitt en kalender som ikke summerer
 * til tallet ved siden av.
 */
export async function loadStreakHistory(
	userId: string,
	definitionId: string,
	opts: { now?: Date } = {}
): Promise<StreakHistory | null> {
	const [row] = await db
		.select()
		.from(streakDefinitions)
		.where(and(eq(streakDefinitions.id, definitionId), eq(streakDefinitions.userId, userId)))
		.limit(1);
	if (!row) return null;

	const definition = toDefinition(row);
	const now = opts.now ?? new Date();
	const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);
	const todayKey = osloDayKey(now);

	/**
	 * Trenings-streaks leses gjennom metrikk-spørringen, ikke gjennom
	 * `readEventDayKeys`: da er kalenderen, telleren og fargene bygget av NØYAKTIG
	 * de samme radene. To spørringer mot samme tabell kan gi ulike svar i det
	 * sekundet en synk skriver mellom dem.
	 */
	if (definition.source.kind === 'workout') {
		const metrics = await readWorkoutDayMetrics(userId, definition.source.sportFamily, since);
		const dayKeys = metrics.flatMap((m) => Array<string>(m.count).fill(m.date));
		return {
			definition,
			state: computeStreak(definition, dayKeys, todayKey),
			days: metrics.map(({ date, count }) => ({ date, count })),
			lookbackDays: LOOKBACK_DAYS,
			today: todayKey,
			dayMetrics: metrics,
			scale: buildDayScale(metrics),
			sportFamily: definition.source.sportFamily
		};
	}

	const dayKeys = await readEventDayKeys(userId, definition, since);

	return {
		definition,
		state: computeStreak(definition, dayKeys, todayKey),
		days: countByDay(dayKeys),
		lookbackDays: LOOKBACK_DAYS,
		today: todayKey,
		dayMetrics: null,
		scale: null,
		sportFamily: null
	};
}

export interface DueMaintenance {
	definitionId: string;
	title: string;
	emoji: string;
	/** Runder på rad nå — 0 når streaken alt er brutt. */
	count: number;
	/** Dager til forfall. Negativt = på overtid. */
	daysUntilDue: number;
	nextDueDay: string | null;
	status: 'due_soon' | 'overdue';
}

/**
 * Periodisk vedlikehold som nærmer seg eller har passert forfall.
 *
 * Dette er det som løftes fram på ukeplanen, slik at streaken kan forsvares før
 * den brytes. Sortert mest presserende først.
 */
export async function listDueMaintenance(
	userId: string,
	opts: { now?: Date } = {}
): Promise<DueMaintenance[]> {
	const streaks = await loadStreaks(userId, { now: opts.now });
	return streaks
		.filter(
			(s) =>
				s.definition.rule === 'max_interval' &&
				(s.state.status === 'due_soon' || s.state.status === 'overdue')
		)
		.map(({ definition, state }) => ({
			definitionId: definition.id,
			title: definition.title,
			emoji: definition.emoji,
			count: state.count,
			daysUntilDue: state.daysUntilDue ?? 0,
			nextDueDay: state.nextDueDay,
			status: state.status as 'due_soon' | 'overdue'
		}))
		.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
}
