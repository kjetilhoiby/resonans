import { db } from '$lib/db';
import { checklists, sensorEvents, sensors } from '$lib/db/schema';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { SensorEventService } from '$lib/server/services/sensor-event-service';
import {
	LIVSKOMPASS_DIMENSIONS,
	LIVSKOMPASS_DIMENSION_IDS,
	IMPORTANCE_MAX,
	MATCH_MAX,
	NEUTRAL_MATCH,
	computeOutOfSync,
	dimensionById,
	isValidImportanceMap,
	isValidWeekKey,
	localIsoWeek,
	type LivskompassGoal,
	type LivskompassScores,
	type LivskompassWeekGoal,
	type OutOfSyncItem
} from '$lib/domains/livskompass/dimensions';

export class LivskompassCheckinError extends Error {}

const DATA_TYPE = 'livskompass_checkin';
const IMPORTANCE_DATA_TYPE = 'livskompass_importance';
const GOAL_DATA_TYPE = 'livskompass_goal';

export interface LivskompassCheckin {
	eventId: string;
	week: string;
	scores: LivskompassScores;
	note: string | null;
	outOfSync: OutOfSyncItem[];
	timestamp: string;
}

export interface LivskompassStatus {
	week: string;
	submitted: boolean;
	latest: LivskompassCheckin | null;
	/** Siste innsjekk FØR denne uka — spøkelses-markør og delta i neste innsjekk. */
	previous: { week: string; scores: LivskompassScores } | null;
	/** Ett-poengs-mål som peker på denne uka, med tiltaksstatus fra ukelista. */
	weekGoals: LivskompassWeekGoal[];
	/** Viktighet fra onboarding/forrige uke — forhåndsutfyller neste innsjekk. */
	prefillImportance: Record<string, number>;
	/** Bruker har aldri satt viktighet (ingen profil + ingen innsjekk) → vis onboarding. */
	needsOnboarding: boolean;
}

async function getOrCreateLivskompassSensor(userId: string) {
	const existing = await db.query.sensors.findFirst({
		where: and(eq(sensors.userId, userId), eq(sensors.provider, 'livskompass_checkin'))
	});
	if (existing) return existing;
	const [created] = await db
		.insert(sensors)
		.values({
			userId,
			provider: 'livskompass_checkin',
			type: 'manual_log',
			subtype: 'livskompass_weekly',
			name: 'Livskompasset',
			isActive: true,
			config: { sliderRange: '1_10', cadence: 'weekly' }
		})
		.returning();
	return created;
}

/** Validerer og normaliserer en score-map fra klienten (viktighet 1–10, samsvar 1–5). */
function parseScores(value: unknown): LivskompassScores {
	if (!value || typeof value !== 'object') {
		throw new LivskompassCheckinError('Mangler dimensjons-scorer.');
	}
	const raw = value as Record<string, unknown>;
	const inRange = (n: number, hi: number) => Number.isInteger(n) && n >= 1 && n <= hi;
	const scores: LivskompassScores = {};
	for (const dim of LIVSKOMPASS_DIMENSIONS) {
		const entry = raw[dim.id];
		if (!entry || typeof entry !== 'object') {
			throw new LivskompassCheckinError(`Mangler score for «${dim.label}».`);
		}
		const importance = Number((entry as Record<string, unknown>).importance);
		const match = Number((entry as Record<string, unknown>).match);
		if (!inRange(importance, IMPORTANCE_MAX)) {
			throw new LivskompassCheckinError(`Viktighet for «${dim.label}» må være heltall fra 1 til ${IMPORTANCE_MAX}.`);
		}
		if (!inRange(match, MATCH_MAX)) {
			throw new LivskompassCheckinError(`Samsvar for «${dim.label}» må være heltall fra 1 til ${MATCH_MAX}.`);
		}
		scores[dim.id] = { importance, match };
	}
	return scores;
}

function rowToCheckin(id: string, data: Record<string, unknown>, timestamp: Date): LivskompassCheckin {
	const scores = (data.scores ?? {}) as LivskompassScores;
	return {
		eventId: id,
		week: typeof data.week === 'string' ? data.week : '',
		scores,
		note: typeof data.note === 'string' ? data.note : null,
		outOfSync: computeOutOfSync(scores),
		timestamp: timestamp.toISOString()
	};
}

async function latestCheckinRow(userId: string, week?: string) {
	const conditions = [eq(sensorEvents.userId, userId), eq(sensorEvents.dataType, DATA_TYPE)];
	if (week) conditions.push(sql`${sensorEvents.data}->>'week' = ${week}`);
	const rows = await db
		.select({ id: sensorEvents.id, data: sensorEvents.data, timestamp: sensorEvents.timestamp })
		.from(sensorEvents)
		.where(and(...conditions))
		.orderBy(desc(sensorEvents.timestamp))
		.limit(1);
	return rows[0] ?? null;
}

/** Nyeste viktighets-profil fra onboarding (eller senere justering), eller null. */
async function latestImportanceProfileRow(userId: string) {
	const rows = await db
		.select({ data: sensorEvents.data, timestamp: sensorEvents.timestamp })
		.from(sensorEvents)
		.where(and(eq(sensorEvents.userId, userId), eq(sensorEvents.dataType, IMPORTANCE_DATA_TYPE)))
		.orderBy(desc(sensorEvents.timestamp))
		.limit(1);
	return rows[0] ?? null;
}

// ── Ukesmål (livskompass_goal) ──────────────────────────────────────────────

/**
 * Persisterer ett-poengs-intensjonen når coachingen fører tiltak på ukelista.
 * fromMatch hentes fra siste innsjekk (den coachingen nettopp tok utgangspunkt
 * i); målet er ett poeng opp, capped på skala-maks.
 */
export async function recordLivskompassGoals(params: {
	userId: string;
	/** Uka tiltakene ble ført på (målaka), f.eks. «2026-W30». */
	week: string;
	dimensionIds: string[];
}): Promise<LivskompassGoal[]> {
	const valid = [...new Set(params.dimensionIds)].filter((id) => LIVSKOMPASS_DIMENSION_IDS.includes(id));
	if (!valid.length || !isValidWeekKey(params.week)) return [];

	const latest = await latestCheckinRow(params.userId);
	const scores = latest
		? (((latest.data ?? {}) as Record<string, unknown>).scores as LivskompassScores | undefined)
		: undefined;

	const goals: LivskompassGoal[] = valid.map((dimensionId) => {
		const fromMatch = scores?.[dimensionId]?.match ?? NEUTRAL_MATCH;
		return { dimensionId, fromMatch, target: Math.min(MATCH_MAX, fromMatch + 1) };
	});

	const sensor = await getOrCreateLivskompassSensor(params.userId);
	await SensorEventService.write({
		userId: params.userId,
		sensorId: sensor.id,
		eventType: 'measurement',
		dataType: GOAL_DATA_TYPE,
		timestamp: new Date(),
		data: { week: params.week, goals },
		source: 'livskompass_coaching'
	});
	return goals;
}

/** Alle mål som peker på en uke, flettet på tvers av events (nyeste vinner per dimensjon). */
export async function getLivskompassGoalsForWeek(userId: string, week: string): Promise<LivskompassGoal[]> {
	const rows = await db
		.select({ data: sensorEvents.data })
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, GOAL_DATA_TYPE),
				sql`${sensorEvents.data}->>'week' = ${week}`
			)
		)
		.orderBy(asc(sensorEvents.timestamp));

	const byDimension = new Map<string, LivskompassGoal>();
	for (const row of rows) {
		const goals = ((row.data ?? {}) as Record<string, unknown>).goals;
		if (!Array.isArray(goals)) continue;
		for (const g of goals) {
			const dimensionId = typeof g?.dimensionId === 'string' ? g.dimensionId : null;
			if (!dimensionId || !LIVSKOMPASS_DIMENSION_IDS.includes(dimensionId)) continue;
			const fromMatch = Number(g?.fromMatch);
			const target = Number(g?.target);
			if (!Number.isFinite(fromMatch) || !Number.isFinite(target)) continue;
			byDimension.set(dimensionId, { dimensionId, fromMatch, target });
		}
	}
	return [...byDimension.values()];
}

/** Tiltaksstatus per dimensjon fra ukelistas livskompass-taggede punkter. */
async function livskompassItemStatus(
	userId: string,
	week: string
): Promise<Record<string, { total: number; checked: number }>> {
	const list = await db.query.checklists.findFirst({
		where: and(eq(checklists.userId, userId), eq(checklists.context, `week:${week}`)),
		with: { items: { columns: { checked: true, metadata: true } } }
	});
	const byDimension: Record<string, { total: number; checked: number }> = {};
	for (const item of list?.items ?? []) {
		const meta = (item.metadata ?? {}) as Record<string, unknown>;
		if (meta.source !== 'livskompass') continue;
		const dim = typeof meta.livskompassDimension === 'string' ? meta.livskompassDimension : null;
		if (!dim) continue;
		const entry = (byDimension[dim] ??= { total: 0, checked: 0 });
		entry.total += 1;
		if (item.checked) entry.checked += 1;
	}
	return byDimension;
}

/** Ukas mål med label og tiltaksstatus — det innsjekk-UI-et og coachingen trenger. */
export async function getLivskompassWeekGoals(userId: string, week: string): Promise<LivskompassWeekGoal[]> {
	const goals = await getLivskompassGoalsForWeek(userId, week);
	if (!goals.length) return [];
	const itemStatus = await livskompassItemStatus(userId, week);
	return goals.map((g) => ({
		...g,
		label: dimensionById(g.dimensionId)?.label ?? g.dimensionId,
		itemsTotal: itemStatus[g.dimensionId]?.total ?? 0,
		itemsChecked: itemStatus[g.dimensionId]?.checked ?? 0
	}));
}

export async function getLivskompassStatus(
	userId: string,
	week: string = localIsoWeek()
): Promise<LivskompassStatus> {
	const thisWeekRow = await latestCheckinRow(userId, week);
	const latest = thisWeekRow
		? rowToCheckin(thisWeekRow.id, (thisWeekRow.data ?? {}) as Record<string, unknown>, thisWeekRow.timestamp)
		: null;

	// Forhåndsutfyll viktighet: denne ukas innsjekk → nyeste innsjekk → onboarding-profil.
	const checkinRow = thisWeekRow ?? (await latestCheckinRow(userId));
	const profileRow = await latestImportanceProfileRow(userId);

	// Sløyfe-kontekst: forrige innsjekk (spøkelses-markør) + ukas mål (oppfølging).
	const [recent, weekGoals] = await Promise.all([
		getLivskompassRecent(userId, 8),
		getLivskompassWeekGoals(userId, week)
	]);
	const previousCheckin = recent.find((c) => c.week !== '' && c.week < week) ?? null;
	const previous = previousCheckin ? { week: previousCheckin.week, scores: previousCheckin.scores } : null;
	const prefillImportance: Record<string, number> = {};
	if (checkinRow) {
		const scores = ((checkinRow.data ?? {}) as Record<string, unknown>).scores as LivskompassScores | undefined;
		for (const dim of LIVSKOMPASS_DIMENSIONS) {
			const imp = scores?.[dim.id]?.importance;
			if (typeof imp === 'number') prefillImportance[dim.id] = imp;
		}
	} else if (profileRow) {
		const importance = ((profileRow.data ?? {}) as Record<string, unknown>).importance as Record<string, number> | undefined;
		for (const dim of LIVSKOMPASS_DIMENSIONS) {
			const imp = importance?.[dim.id];
			if (typeof imp === 'number') prefillImportance[dim.id] = imp;
		}
	}

	return {
		week,
		submitted: latest !== null,
		latest,
		previous,
		weekGoals,
		prefillImportance,
		// Onboarding trengs bare når bruker aldri har satt viktighet (verken profil eller innsjekk).
		needsOnboarding: !checkinRow && !profileRow
	};
}

/** Lagrer viktighets-profilen fra onboarding (eller senere justering). */
export async function submitLivskompassImportance(params: {
	userId: string;
	importance: unknown;
}): Promise<LivskompassStatus> {
	if (!isValidImportanceMap(params.importance)) {
		throw new LivskompassCheckinError(`Viktighet må være heltall fra 1 til ${IMPORTANCE_MAX} for alle dimensjoner.`);
	}
	const sensor = await getOrCreateLivskompassSensor(params.userId);
	await SensorEventService.write({
		userId: params.userId,
		sensorId: sensor.id,
		eventType: 'measurement',
		dataType: IMPORTANCE_DATA_TYPE,
		timestamp: new Date(),
		data: { importance: params.importance },
		source: 'livskompass_onboarding'
	});
	return getLivskompassStatus(params.userId);
}

export async function getLivskompassRecent(userId: string, weeks = 8): Promise<LivskompassCheckin[]> {
	const rows = await db
		.select({ id: sensorEvents.id, data: sensorEvents.data, timestamp: sensorEvents.timestamp })
		.from(sensorEvents)
		.where(and(eq(sensorEvents.userId, userId), eq(sensorEvents.dataType, DATA_TYPE)))
		.orderBy(desc(sensorEvents.timestamp))
		.limit(weeks);
	return rows.map((r) => rowToCheckin(r.id, (r.data ?? {}) as Record<string, unknown>, r.timestamp));
}

export async function submitLivskompassCheckin(params: {
	userId: string;
	week?: string;
	scores: unknown;
	note?: string | null;
}): Promise<LivskompassStatus> {
	const week = isValidWeekKey(params.week) ? params.week : localIsoWeek();
	const scores = parseScores(params.scores);
	const cleanNote = typeof params.note === 'string' && params.note.trim() ? params.note.trim() : null;

	const sensor = await getOrCreateLivskompassSensor(params.userId);

	const payload: Record<string, unknown> = { week, scores };
	if (cleanNote) payload.note = cleanNote;

	await SensorEventService.write({
		userId: params.userId,
		sensorId: sensor.id,
		eventType: 'measurement',
		dataType: DATA_TYPE,
		timestamp: new Date(),
		data: payload,
		source: 'livskompass_ui'
	});

	return getLivskompassStatus(params.userId, week);
}
