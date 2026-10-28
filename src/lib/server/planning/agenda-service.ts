/**
 * Agendaen: alt som skjer en dag, fra kildene det bor i — uten å kopiere noe.
 *
 * Dagsoppgaver og ukeliste (`plan-service`), Spond (`sensor_events`), avtaler
 * med billett (`events`), rutiner (`routine_definitions`) og planlagte økter
 * fra et aktivt treningsprogram. Hver oppføring bærer kilden og kildens id, så
 * en Spond-kamp forblir en Spond-kamp: den skal ikke inn i ukeplanen fordi
 * ChatGPT nevnte den. Se docs/mcp.md, «Agenda».
 *
 * Lesingen skriver ingenting. Det er grunnen til at rutinene hentes som
 * DEFINISJONER og ikke gjennom `materializeRoutinesForDates`, som lager
 * instansene den finner mangler.
 */

import { and, eq, gte, inArray, lt } from 'drizzle-orm';
import { db } from '$lib/db';
import { checklists, events, persons, sensorEvents, sensors } from '$lib/db/schema';
import { listRoutineDefinitions } from '$lib/server/services/routine-service';
import { getFullProgram, getProgramSummaries, sessionPlannedDate } from '$lib/server/programs/repository';
import { addDaysIso } from '$lib/server/iso-week';
import { osloDateOf, osloTimeOf, spondRsvp, type PlanItem, type SpondRsvp } from '$lib/domain/plan-items';
import { loadPlan, weekdayName, type PlanWeekList } from './plan-service';

export const AGENDA_SOURCES = ['tasks', 'spond', 'events', 'routines', 'training'] as const;
export type AgendaSource = (typeof AGENDA_SOURCES)[number];

export interface SpondAgendaEntry {
	source: 'spond';
	id: string;
	externalId: string | null;
	title: string;
	description: string | null;
	personName: string | null;
	groupName: string | null;
	spondType: string | null;
	start: string;
	end: string | null;
	startTime: string;
	endTime: string | null;
	location: { name: string | null; address: string | null } | null;
	cancelled: boolean;
	/**
	 * Hva familiens medlemmer har svart. `not_invited`: ingen av våre står på
	 * lista — hendelsen skjer i gruppa, men er ikke noe noen av oss skal delta i.
	 */
	rsvp: SpondRsvp;
}

export interface TicketEventEntry {
	source: 'event';
	id: string;
	title: string;
	kind: string | null;
	date: string;
	endDate: string | null;
	startTime: string | null;
	venue: string | null;
	status: string;
}

export interface RoutineAgendaEntry {
	source: 'routine';
	id: string;
	title: string;
	slot: string;
	itemCount: number;
	/** Sum av punktenes estimater. `null` når ingen punkter har estimat. */
	estimatedMinutes: number | null;
	/** Bare når rutinen alt er åpnet den dagen (instansen finnes). */
	progress: { done: number; total: number } | null;
}

export interface TrainingAgendaEntry {
	source: 'training';
	programId: string;
	programName: string;
	sessionName: string;
	kind: string;
	completed: boolean;
}

export interface AgendaDay {
	date: string;
	weekday: string;
	tasks?: PlanItem[];
	spond?: SpondAgendaEntry[];
	events?: TicketEventEntry[];
	routines?: RoutineAgendaEntry[];
	training?: TrainingAgendaEntry[];
}

export interface Agenda {
	days: AgendaDay[];
	weekLists?: PlanWeekList[];
	sources: {
		spond?: { connected: boolean; lastSyncedAt: string | null };
	};
	notes: string[];
}

function dowOf(isoDate: string): number {
	const [y, m, d] = isoDate.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export async function loadAgenda(userId: string, dates: string[], include: Set<AgendaSource>): Promise<Agenda> {
	const days: AgendaDay[] = dates.map((date) => ({ date, weekday: weekdayName(date) }));
	const byDate = new Map(days.map((d) => [d.date, d]));
	const agenda: Agenda = { days, sources: {}, notes: [] };
	const first = dates[0];
	const last = dates[dates.length - 1];

	const tasks = include.has('tasks') ? loadPlan(userId, dates) : null;

	const spond = include.has('spond')
		? (async () => {
				const sensor = await db.query.sensors.findFirst({
					where: and(eq(sensors.userId, userId), eq(sensors.provider, 'spond'), eq(sensors.isActive, true)),
					columns: { id: true, lastSync: true, config: true }
				});
				agenda.sources.spond = { connected: !!sensor, lastSyncedAt: sensor?.lastSync?.toISOString() ?? null };
				if (!sensor) return;
				const myMemberIds: string[] = ((sensor.config as { myMemberIds?: string[] } | null)?.myMemberIds) ?? [];
				// Et døgn slakk i hver ende: datoen avgjøres i Oslo-tid etterpå, ikke av UTC-grensa.
				const rows = await db
					.select({ event: sensorEvents, personName: persons.name })
					.from(sensorEvents)
					.leftJoin(persons, eq(sensorEvents.personId, persons.id))
					.where(
						and(
							eq(sensorEvents.userId, userId),
							eq(sensorEvents.dataType, 'spond_event'),
							gte(sensorEvents.timestamp, new Date(`${addDaysIso(first, -1)}T00:00:00Z`)),
							lt(sensorEvents.timestamp, new Date(`${addDaysIso(last, 2)}T00:00:00Z`))
						)
					)
					.orderBy(sensorEvents.timestamp);
				for (const { event, personName } of rows) {
					const date = osloDateOf(event.timestamp);
					const day = byDate.get(date);
					if (!day) continue;
					const data = (event.data ?? {}) as Record<string, any>;
					const meta = (event.metadata ?? {}) as Record<string, any>;
					const end = typeof data.endTimestamp === 'string' ? data.endTimestamp : null;
					(day.spond ??= []).push({
						source: 'spond',
						id: event.id,
						externalId: meta.spondEventId ?? null,
						title: data.name ?? 'Spond-hendelse',
						description: data.description ? String(data.description).slice(0, 500) : null,
						personName: personName ?? null,
						groupName: data.groupName ?? null,
						spondType: meta.type ?? null,
						start: event.timestamp.toISOString(),
						end,
						startTime: osloTimeOf(event.timestamp),
						endTime: end ? osloTimeOf(end) : null,
						location: data.location ? { name: data.location.name ?? null, address: data.location.address ?? null } : null,
						cancelled: data.cancelled === true,
						rsvp: spondRsvp(data.responses, myMemberIds)
					});
				}
				if (myMemberIds.length === 0) {
					agenda.notes.push('Spond: vi vet ikke hvilke medlemmer som er familiens, så rsvp er «unknown» — spør brukeren.');
				}
			})()
		: null;

	const tickets = include.has('events')
		? (async () => {
				const rows = await db.query.events.findMany({
					where: and(eq(events.userId, userId), gte(events.eventDate, addDaysIso(first, -14)), lt(events.eventDate, addDaysIso(last, 1)))
				});
				for (const e of rows) {
					// Flerdagers hendelser vises på hver dag de dekker.
					for (const day of days) {
						if (day.date < e.eventDate || day.date > (e.endDate ?? e.eventDate)) continue;
						(day.events ??= []).push({
							source: 'event',
							id: e.id,
							title: e.title,
							kind: e.kind,
							date: e.eventDate,
							endDate: e.endDate,
							startTime: e.startTime,
							venue: e.venue,
							status: e.status
						});
					}
				}
			})()
		: null;

	const routines = include.has('routines')
		? (async () => {
				const defs = await listRoutineDefinitions(userId, { includeInactive: false });
				const pairs = dates.flatMap((date) =>
					defs.filter((d) => d.daysOfWeek.includes(dowOf(date))).map((def) => ({ date, def }))
				);
				const contexts = pairs.map((p) => `routine:${p.def.id}:${p.date}`);
				const instances = contexts.length
					? await db.query.checklists.findMany({
							where: and(eq(checklists.userId, userId), inArray(checklists.context, contexts)),
							with: { items: { columns: { checked: true, skippedAt: true, parentId: true } } }
						})
					: [];
				const byContext = new Map(instances.map((i) => [i.context, i]));
				for (const { date, def } of pairs) {
					const instance = byContext.get(`routine:${def.id}:${date}`);
					const top = instance?.items.filter((i) => !i.parentId) ?? [];
					const estimates = def.items.map((i) => i.estimateMinutes).filter((m): m is number => typeof m === 'number');
					(byDate.get(date)!.routines ??= []).push({
						source: 'routine',
						id: def.id,
						title: def.title,
						slot: def.slot,
						itemCount: def.items.length,
						estimatedMinutes: estimates.length ? estimates.reduce((a, b) => a + b, 0) : null,
						progress: instance ? { done: top.filter((i) => i.checked || i.skippedAt).length, total: top.length } : null
					});
				}
			})()
		: null;

	const training = include.has('training')
		? (async () => {
				const summaries = (await getProgramSummaries(userId)).filter((p) => p.status === 'active');
				for (const summary of summaries) {
					const program = await getFullProgram(userId, summary.id);
					for (const week of program?.weeks ?? []) {
						for (const session of week.sessions) {
							const date = sessionPlannedDate(program!.startDate, session.weekNumber, session.dayNumber);
							const day = byDate.get(date);
							if (!day) continue;
							(day.training ??= []).push({
								source: 'training',
								programId: summary.id,
								programName: summary.name,
								sessionName: session.name,
								kind: session.kind,
								completed: !!session.completion
							});
						}
					}
				}
			})()
		: null;

	const [plan] = await Promise.all([tasks, spond, tickets, routines, training]);
	if (plan) {
		for (const planDay of plan.days) byDate.get(planDay.date)!.tasks = planDay.items;
		agenda.weekLists = plan.weekLists;
	}
	return agenda;
}

