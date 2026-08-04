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

/**
 * Retter en manuell dupp: varighet, tidspunkt og/eller notat.
 *
 * Delvis oppdatering — å kreve alle tre for å flytte en dupp fra 13 til 11 ville tvunget
 * klienten til å sende tilbake tall den ikke rørte.
 *
 * **`metadata.enddate` må flyttes med.** `sleepEventEnddateSec` bruker den til å utlede
 * varighet når `sleepDuration` mangler, og `isNapSleepEvent` til å klassifisere. Ville vi
 * bare oppdatert `sleepDuration`, hadde raden hatt to motstridende varigheter.
 *
 * Returnerer null når raden ikke finnes, ikke er din, eller ikke er en *manuell* dupp.
 */
export async function updateNap(
	userId: string,
	eventId: string,
	patch: { durationMinutes?: number; at?: Date; note?: string | null }
): Promise<LoggedNap | null> {
	const existing = await db.query.sensorEvents.findFirst({
		where: and(eq(sensorEvents.id, eventId), eq(sensorEvents.userId, userId))
	});
	if (!existing || existing.dataType !== 'sleep') return null;

	const meta = (existing.metadata ?? {}) as { manual?: boolean; [key: string]: unknown };
	const data = (existing.data ?? {}) as { sleepDuration?: number; isNap?: boolean; note?: string; [key: string]: unknown };
	if (meta.manual !== true || data.isNap !== true) return null;

	const start = patch.at ?? existing.timestamp;
	const durationMinutes =
		patch.durationMinutes ?? Math.round((data.sleepDuration ?? 0) / 60);

	const nextData: Record<string, unknown> = {
		...data,
		sleepDuration: durationMinutes * 60,
		isNap: true
	};
	if (patch.note !== undefined) {
		if (patch.note === null) delete nextData.note;
		else nextData.note = patch.note;
	}

	await db
		.update(sensorEvents)
		.set({
			timestamp: start,
			data: nextData,
			metadata: {
				...meta,
				enddate: Math.round(start.getTime() / 1000) + durationMinutes * 60
			}
		})
		.where(eq(sensorEvents.id, eventId));

	return {
		id: eventId,
		start,
		durationMinutes,
		manual: true,
		note: typeof nextData.note === 'string' ? nextData.note : undefined
	};
}

/**
 * Omklassifiserer en **oppdaget** dupp: «dette var ikke en dupp».
 *
 * Alternativet til en slett-knapp som ville løyet. Withings-raden er en ekte måling av at
 * du lå stille — den skal ikke slettes. Men *klassifiseringen* er vår:
 * `isNapSleepEvent` leser et eksplisitt `data.isNap` før den faller tilbake på varighet
 * og klokkeslett.
 *
 * Overstyringen er varig fordi søvnsynken skriver med `conflictMode: 'ignore'` — en
 * eksisterende rad røres ikke. Vi skriver dessuten bare inn `isNap` og lar resten av
 * `data` stå, samme mønster som HRV- og `hr_average`-backfillene.
 *
 * Nekter på manuelle dupper: der er sletting det riktige, og to veier til «vekk» ville
 * etterlatt rader som ser slettet ut men ligger igjen.
 */
export async function reclassifyNap(
	userId: string,
	eventId: string,
	isNap: boolean
): Promise<boolean> {
	const existing = await db.query.sensorEvents.findFirst({
		where: and(eq(sensorEvents.id, eventId), eq(sensorEvents.userId, userId))
	});
	if (!existing || existing.dataType !== 'sleep') return false;

	const meta = (existing.metadata ?? {}) as { manual?: boolean };
	if (meta.manual === true) return false;

	const data = (existing.data ?? {}) as Record<string, unknown>;
	await db
		.update(sensorEvents)
		.set({ data: { ...data, isNap } })
		.where(eq(sensorEvents.id, eventId));

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
