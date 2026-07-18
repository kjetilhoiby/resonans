/**
 * sleep-goals.ts — DB-siden av søvnmål (speiler screen-time-goals.ts).
 *
 * Mål lagres i den eksisterende `goals`-tabellen under `metadata.sleepGoal`
 * (ingen skjemaendring). All ren logikk (nap-inferens, medianer, evaluering)
 * bor i `$lib/domain/sleep-goals.ts` og er enhetstestet der.
 */

import { db } from '$lib/db';
import { goals, sensorEvents, sensors } from '$lib/db/schema';
import { and, eq, gte } from 'drizzle-orm';
import {
	defaultSleepGoalTitle,
	evaluateSleepGoal,
	isNapSleepEvent,
	readSleepGoalMetadata,
	toSleepNights,
	type SleepGoal,
	type SleepGoalEval,
	type SleepNight
} from '$lib/domain/sleep-goals';

export interface SleepGoalRecord {
	id: string;
	title: string;
	description: string | null;
	goal: SleepGoal;
}

/** Rå 'sleep'-events → netter/naps for de siste `sinceDays` døgnene. */
export async function readSleepNights(userId: string, sinceDays = 8): Promise<SleepNight[]> {
	const since = new Date(Date.now() - sinceDays * 86_400_000);
	const rows = await db.query.sensorEvents.findMany({
		where: and(
			eq(sensorEvents.userId, userId),
			eq(sensorEvents.dataType, 'sleep'),
			gte(sensorEvents.timestamp, since)
		),
		orderBy: [sensorEvents.timestamp]
	});
	return toSleepNights(
		rows.map((row) => ({
			timestamp: row.timestamp,
			data: row.data as { sleepDuration?: number } | null,
			metadata: row.metadata as { enddate?: number } | null
		}))
	);
}

export async function listSleepGoals(userId: string): Promise<SleepGoalRecord[]> {
	const rows = await db.query.goals.findMany({
		where: and(eq(goals.userId, userId), eq(goals.status, 'active'))
	});
	const out: SleepGoalRecord[] = [];
	for (const row of rows) {
		const goal = readSleepGoalMetadata(row.metadata);
		if (!goal) continue;
		out.push({ id: row.id, title: row.title, description: row.description, goal });
	}
	return out;
}

/**
 * Opprett et søvnmål — idempotent per type: finnes et aktivt mål av samme
 * kind oppdateres target i stedet for å duplisere (onboarding kan re-kjøres).
 */
export async function createSleepGoal(
	userId: string,
	goal: SleepGoal,
	options: { title?: string; description?: string; themeId?: string } = {}
): Promise<SleepGoalRecord> {
	const existing = (await listSleepGoals(userId)).find((g) => g.goal.kind === goal.kind);
	if (existing) {
		const title = options.title?.trim() || defaultSleepGoalTitle(goal);
		await db
			.update(goals)
			.set({ title, metadata: { sleepGoal: goal, domain: 'health', metricFamily: 'sleep' }, updatedAt: new Date() })
			.where(and(eq(goals.id, existing.id), eq(goals.userId, userId)));
		return { ...existing, title, goal };
	}

	const [row] = await db
		.insert(goals)
		.values({
			userId,
			themeId: options.themeId ?? null,
			title: options.title?.trim() || defaultSleepGoalTitle(goal),
			description: options.description ?? null,
			status: 'active',
			metadata: { sleepGoal: goal, domain: 'health', metricFamily: 'sleep' }
		})
		.returning();
	return { id: row.id, title: row.title, description: row.description, goal };
}

/* ── Manuell nap-registrering ───────────────────────────── */

/** Sensor for manuelt registrerte powernaps (mønster fra egenfrekvens-checkin). */
async function ensureNapSensor(userId: string) {
	const existing = await db.query.sensors.findFirst({
		where: and(eq(sensors.userId, userId), eq(sensors.provider, 'manual_nap'))
	});
	if (existing) return existing;
	const [created] = await db
		.insert(sensors)
		.values({
			userId,
			provider: 'manual_nap',
			type: 'manual_log',
			subtype: 'nap',
			name: 'Powernaps',
			isActive: true,
			config: {}
		})
		.returning();
	return created;
}

export interface LoggedNap {
	id: string;
	start: Date;
	durationMinutes: number;
	manual: boolean;
	note?: string;
}

/**
 * Registrer en powernap manuelt. Skrives som vanlig 'sleep'-event med eksplisitt
 * `data.isNap` — dermed flyter den inn i nap-tellingen på Mål-fanen og holdes
 * ute av nattsnittet i aggregatene uten videre kobling.
 */
export async function logNap(
	userId: string,
	args: { durationMinutes: number; at?: Date; note?: string }
): Promise<LoggedNap> {
	const durationMinutes = Math.round(args.durationMinutes);
	const start = args.at ?? new Date(Date.now() - durationMinutes * 60_000);
	const sensor = await ensureNapSensor(userId);

	const [row] = await db
		.insert(sensorEvents)
		.values({
			userId,
			sensorId: sensor.id,
			eventType: 'measurement',
			dataType: 'sleep',
			timestamp: start,
			data: {
				sleepDuration: durationMinutes * 60,
				isNap: true,
				...(args.note ? { note: args.note } : {})
			},
			metadata: {
				manual: true,
				enddate: Math.round(start.getTime() / 1000) + durationMinutes * 60
			}
		})
		.returning();

	return { id: row.id, start, durationMinutes, manual: true, note: args.note };
}

/** Slett en manuelt registrert nap (angre). Rører aldri sensor-synkede events. */
export async function deleteNap(userId: string, eventId: string): Promise<boolean> {
	const existing = await db.query.sensorEvents.findFirst({
		where: and(eq(sensorEvents.id, eventId), eq(sensorEvents.userId, userId))
	});
	if (!existing || existing.dataType !== 'sleep') return false;
	const meta = existing.metadata as { manual?: boolean } | null;
	if (!meta?.manual || (existing.data as { isNap?: boolean } | null)?.isNap !== true) return false;
	await db.delete(sensorEvents).where(and(eq(sensorEvents.id, eventId), eq(sensorEvents.userId, userId)));
	return true;
}

/** Naps (detekterte + manuelle) siste `sinceDays` døgn, nyeste først. */
export async function listRecentNaps(userId: string, sinceDays = 7): Promise<LoggedNap[]> {
	const since = new Date(Date.now() - sinceDays * 86_400_000);
	const rows = await db.query.sensorEvents.findMany({
		where: and(
			eq(sensorEvents.userId, userId),
			eq(sensorEvents.dataType, 'sleep'),
			gte(sensorEvents.timestamp, since)
		),
		orderBy: [sensorEvents.timestamp]
	});
	return rows
		.filter((row) =>
			isNapSleepEvent({
				timestamp: row.timestamp,
				data: row.data as { sleepDuration?: number; isNap?: boolean } | null,
				metadata: row.metadata
			})
		)
		.map((row) => {
			const data = row.data as { sleepDuration?: number; note?: string } | null;
			const meta = row.metadata as { manual?: boolean } | null;
			return {
				id: row.id,
				start: row.timestamp,
				durationMinutes: Math.round((data?.sleepDuration ?? 0) / 60),
				manual: meta?.manual === true,
				note: data?.note
			};
		})
		.reverse();
}

/** Evaluer alle aktive søvnmål mot siste ~7 netter. */
export async function evaluateSleepGoalsForUser(
	userId: string
): Promise<Record<string, SleepGoalEval>> {
	const records = await listSleepGoals(userId);
	if (records.length === 0) return {};
	const nights = await readSleepNights(userId);
	const out: Record<string, SleepGoalEval> = {};
	for (const record of records) {
		out[record.id] = evaluateSleepGoal(record.goal, nights);
	}
	return out;
}
