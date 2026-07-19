import { db } from '$lib/db';
import { checklists, checklistItems, sensors, sensorEvents } from '$lib/db/schema';
import { and, eq, gte, sql, asc, desc } from 'drizzle-orm';
import { choresForAppliance, computeChoreStats, type ChoreStats } from '$lib/domains/home/appliance-chores';
import { computeChoreBalance, type ChoreBalance } from '$lib/domain/observed-behavior';
import { dayContextForDate } from '$lib/server/iso-week';

/** Context-nøkkel for den ene husarbeid-lista per bruker (chores-view på hjem). */
export const CHORES_CONTEXT = 'home_chores';

const TZ = 'Europe/Oslo';

async function getOrCreateChoresChecklist(userId: string) {
	const existing = await db.query.checklists.findFirst({
		where: and(eq(checklists.userId, userId), eq(checklists.context, CHORES_CONTEXT))
	});
	if (existing) return existing;
	const [created] = await db
		.insert(checklists)
		.values({ userId, title: 'Husarbeid', emoji: '🧺', context: CHORES_CONTEXT })
		.returning();
	return created;
}

async function getOrCreateDayChecklist(userId: string, now: Date) {
	const isoDate = now.toLocaleDateString('sv-SE', { timeZone: TZ });
	const context = dayContextForDate(isoDate);
	const existing = await db.query.checklists.findFirst({
		where: and(eq(checklists.userId, userId), eq(checklists.context, context))
	});
	if (existing) return existing;
	const weekday = now.toLocaleDateString('nb-NO', { weekday: 'long', timeZone: TZ });
	const [created] = await db
		.insert(checklists)
		.values({
			userId,
			title: weekday.charAt(0).toUpperCase() + weekday.slice(1),
			emoji: '🗓️',
			context
		})
		.returning();
	return created;
}

async function nextSortOrder(checklistId: string, userId: string): Promise<number> {
	const items = await db.query.checklistItems.findMany({
		where: and(eq(checklistItems.checklistId, checklistId), eq(checklistItems.userId, userId)),
		columns: { sortOrder: true }
	});
	return items.reduce((max, i) => Math.max(max, i.sortOrder ?? 0), -1) + 1;
}

/**
 * Lag husarbeid for en ferdig apparat-syklus i chores-lista (ikke dagslista).
 * Returnerer antall opprettede gjøremål. Idempotent per cycleId.
 */
export async function addChoresForCycle(
	userId: string,
	appliance: string,
	cycleId?: string,
	durationMinutes?: number
): Promise<number> {
	const choreTexts = choresForAppliance(appliance);
	if (choreTexts.length === 0) return 0;

	const checklist = await getOrCreateChoresChecklist(userId);

	// Idempotens: ikke dupliser dersom samme syklus allerede har generert husarbeid.
	if (cycleId) {
		const dupe = await db.query.checklistItems.findFirst({
			where: and(
				eq(checklistItems.userId, userId),
				sql`${checklistItems.metadata}->>'applianceCycleId' = ${cycleId}`
			),
			columns: { id: true }
		});
		if (dupe) return 0;
	}

	const baseSort = await nextSortOrder(checklist.id, userId);
	await db.insert(checklistItems).values(
		choreTexts.map((text, i) => ({
			checklistId: checklist.id,
			userId,
			text,
			sortOrder: baseSort + i,
			metadata: {
				chore: true,
				applianceChore: true,
				appliance,
				applianceCycleId: cycleId ?? undefined,
				applianceDurationMinutes: durationMinutes ?? undefined
			}
		}))
	);
	return choreTexts.length;
}

/**
 * Brutto sannsynlige oppgaver vs. registrerte fullførte over et rullerende vindu.
 * Teller alt husarbeid i budsjettet (metadata.chore) — apparat-genererte så vel som
 * rutine-/dagsoppgaver «eid av chores» — uansett hvilken liste de nå ligger i,
 * basert på når de ble generert/opprettet.
 */
export async function getChoreStats(userId: string, windowDays = 7): Promise<ChoreStats> {
	const cutoff = new Date(Date.now() - windowDays * 86_400_000);
	const rows = await db
		.select({ checked: checklistItems.checked, createdAt: checklistItems.createdAt })
		.from(checklistItems)
		.where(
			and(
				eq(checklistItems.userId, userId),
				sql`${checklistItems.metadata}->>'chore' = 'true'`,
				gte(checklistItems.createdAt, cutoff)
			)
		);
	return computeChoreStats(rows, windowDays);
}

/* ── Husarbeid-balanse (hvem gjør hva, mot 50/50) ───────── */

/** Sensor for chat-loggede husarbeids-oppgaver med attribusjon (hvem gjorde den). */
async function ensureChoreLogSensor(userId: string) {
	const existing = await db.query.sensors.findFirst({
		where: and(eq(sensors.userId, userId), eq(sensors.provider, 'chore_log'))
	});
	if (existing) return existing;
	const [created] = await db
		.insert(sensors)
		.values({ userId, provider: 'chore_log', type: 'manual_log', subtype: 'chore', name: 'Husarbeid', isActive: true, config: {} })
		.returning();
	return created;
}

/**
 * Logg en gjennomført husarbeids-oppgave med attribusjon. Skrives som
 * `chore_done`-event — egen kilde for balanse, uavhengig av det single-user
 * chore-budsjettet (metadata.chore på checklist-items).
 */
export async function logChore(
	userId: string,
	args: { task: string; doneBy: 'meg' | 'partner'; minutes?: number; at?: Date }
): Promise<void> {
	const sensor = await ensureChoreLogSensor(userId);
	await db.insert(sensorEvents).values({
		userId,
		sensorId: sensor.id,
		eventType: 'activity',
		dataType: 'chore_done',
		timestamp: args.at ?? new Date(),
		data: {
			task: args.task,
			doneBy: args.doneBy,
			...(typeof args.minutes === 'number' ? { minutes: args.minutes } : {})
		},
		metadata: { manual: true }
	});
}

/**
 * Balanse i husarbeid siste `windowDays` dager, mot 50/50-idealet.
 * Teller `chore_done`-events per part. Null under minimum (for få oppgaver).
 */
export async function readChoreBalance(userId: string, windowDays = 14): Promise<ChoreBalance | null> {
	const cutoff = new Date(Date.now() - windowDays * 86_400_000);
	const rows = await db
		.select({ data: sensorEvents.data })
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'chore_done'),
				gte(sensorEvents.timestamp, cutoff)
			)
		);
	let myCount = 0;
	let otherCount = 0;
	for (const row of rows) {
		const doneBy = (row.data as { doneBy?: string } | null)?.doneBy;
		if (doneBy === 'partner') otherCount += 1;
		else myCount += 1; // default/«meg»
	}
	return computeChoreBalance(myCount, otherCount);
}

export interface PendingChore {
	id: string;
	checklistId: string;
	text: string;
	appliance: string | null;
	cycleId: string | null;
	createdAt: string;
}

/** Ventende (uavkryssede) husarbeid som fortsatt ligger i chores-lista. */
export async function listPendingChores(userId: string): Promise<{
	checklistId: string | null;
	items: PendingChore[];
}> {
	const checklist = await db.query.checklists.findFirst({
		where: and(eq(checklists.userId, userId), eq(checklists.context, CHORES_CONTEXT)),
		columns: { id: true }
	});
	if (!checklist) return { checklistId: null, items: [] };

	const rows = await db
		.select({
			id: checklistItems.id,
			text: checklistItems.text,
			metadata: checklistItems.metadata,
			createdAt: checklistItems.createdAt
		})
		.from(checklistItems)
		.where(
			and(
				eq(checklistItems.checklistId, checklist.id),
				eq(checklistItems.userId, userId),
				eq(checklistItems.checked, false)
			)
		)
		.orderBy(desc(checklistItems.createdAt), asc(checklistItems.sortOrder));

	const items: PendingChore[] = rows.map((r) => {
		const meta = (r.metadata ?? {}) as { appliance?: string; applianceCycleId?: string };
		return {
			id: r.id,
			checklistId: checklist.id,
			text: r.text,
			appliance: meta.appliance ?? null,
			cycleId: meta.applianceCycleId ?? null,
			createdAt: (r.createdAt as Date).toISOString()
		};
	});
	return { checklistId: checklist.id, items };
}

/**
 * «Ta» en syklus inn i dagslista: re-parent uavkryssede chores-items for syklusen
 * fra chores-lista til dagens dagsliste. De forblir apparat-husarbeid (telles i
 * brutto), og avkrysning der teller som fullført. Returnerer antall flyttet.
 */
export async function claimCycleToDay(userId: string, cycleId: string): Promise<number> {
	const choresList = await db.query.checklists.findFirst({
		where: and(eq(checklists.userId, userId), eq(checklists.context, CHORES_CONTEXT)),
		columns: { id: true }
	});
	if (!choresList) return 0;

	const toMove = await db.query.checklistItems.findMany({
		where: and(
			eq(checklistItems.userId, userId),
			eq(checklistItems.checklistId, choresList.id),
			eq(checklistItems.checked, false),
			sql`${checklistItems.metadata}->>'applianceCycleId' = ${cycleId}`
		),
		columns: { id: true }
	});
	if (toMove.length === 0) return 0;

	const dayChecklist = await getOrCreateDayChecklist(userId, new Date());
	let sort = await nextSortOrder(dayChecklist.id, userId);
	for (const item of toMove) {
		await db
			.update(checklistItems)
			.set({ checklistId: dayChecklist.id, sortOrder: sort++ })
			.where(eq(checklistItems.id, item.id));
	}
	return toMove.length;
}
