import { db } from '$lib/db';
import { sensorEvents, sensors } from '$lib/db/schema';
import { and, desc, eq, sql } from 'drizzle-orm';
import { SensorEventService } from '$lib/server/services/sensor-event-service';
import {
	LIVSKOMPASS_DIMENSIONS,
	IMPORTANCE_MAX,
	MATCH_MAX,
	computeOutOfSync,
	isValidImportanceMap,
	isValidWeekKey,
	localIsoWeek,
	type LivskompassScores,
	type OutOfSyncItem
} from '$lib/domains/livskompass/dimensions';

export class LivskompassCheckinError extends Error {}

const DATA_TYPE = 'livskompass_checkin';
const IMPORTANCE_DATA_TYPE = 'livskompass_importance';

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
			config: { sliderRange: '1_5', cadence: 'weekly' }
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
