/**
 * Dags- og ukeplanen for MCP: les, opprett, endre, flytt og fullfør punkter.
 *
 * Ingen egen modell. Et planpunkt er en rad i `checklist_items` på en dagsliste
 * (`week:…:day:YYYY-MM-DD`) eller ukelista (`week:YYYY-Www`) — de samme radene
 * hjemskjermen og ukeplanen viser. Oppretting går gjennom samme bygger som
 * appen (`buildChecklistItemFields`), og avkryssing gjennom samme tjeneste
 * (`checklist-item-mutations.ts`), så et punkt fra ChatGPT er ikke til å skille
 * fra et punkt skrevet i appen. Se docs/mcp.md, «Planlegging».
 */

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { checklistItems, checklists, persons } from '$lib/db/schema';
import { buildChecklistItemFields } from '$lib/server/checklist-item-builder';
import {
	deleteChecklistItem,
	moveChecklistItem,
	syncChecklistCompletion,
	updateChecklistItem,
	type ChecklistItemRow
} from '$lib/server/checklist-item-mutations';
import { findOrCreateDayChecklist, findOrCreateWeekChecklist } from '$lib/server/email-processors/day-checklist';
import { dayContextForDate, isoWeekKeyForDate, osloTodayIso } from '$lib/server/iso-week';
import { PersonMentionService } from '$lib/server/services/person-mention-service';
import { runInBackground } from '$lib/server/run-in-background';
import { syncStaysForDate } from '$lib/server/stays';
import { afterMealItemWritten } from '$lib/server/services/meal-plan-sync';
import {
	isValidIsoDate,
	isValidIsoWeek,
	normalizeItemText,
	parsePlanContext,
	parseStartTime,
	sortPlanItems,
	toPlanItem,
	type PlanItem,
	type PlanList
} from '$lib/domain/plan-items';

const WEEKDAYS = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];

export function weekdayName(isoDate: string): string {
	const [y, m, d] = isoDate.split('-').map(Number);
	return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** Feil verktøyet skal si til modellen, med en kode den kan handle på. */
export class PlanError extends Error {
	constructor(
		public code: 'not_found' | 'invalid_argument' | 'not_a_plan_item',
		message: string
	) {
		super(message);
		this.name = 'PlanError';
	}
}

export interface PlanDay {
	date: string;
	weekday: string;
	items: PlanItem[];
}

export interface PlanWeekList {
	week: string;
	items: PlanItem[];
}

/**
 * Punktene for datoene, pluss ukelistene for ukene datoene dekker. Bare
 * toppnivå-punkter; deloppgaver telles i `subtaskCount`.
 */
export async function loadPlan(
	userId: string,
	dates: string[],
	opts: { includeWeekLists?: boolean } = {}
): Promise<{ days: PlanDay[]; weekLists: PlanWeekList[] }> {
	const weeks = [...new Set(dates.map(isoWeekKeyForDate))];
	const contexts = [
		...dates.map(dayContextForDate),
		...(opts.includeWeekLists === false ? [] : weeks.map((w) => `week:${w}`))
	];

	const lists = await db.query.checklists.findMany({
		where: and(eq(checklists.userId, userId), inArray(checklists.context, contexts)),
		with: {
			items: { orderBy: (items, { asc }) => [asc(items.sortOrder), asc(items.createdAt)] }
		}
	});

	const byContext = new Map<string, PlanItem[]>();
	for (const list of lists) {
		const parsed = parsePlanContext(list.context);
		if (!parsed) continue;
		const rows = list.items as ChecklistItemRow[];
		const subtasks = new Map<string, number>();
		for (const r of rows) if (r.parentId) subtasks.set(r.parentId, (subtasks.get(r.parentId) ?? 0) + 1);
		const items = rows
			.filter((r) => !r.parentId)
			.map((r) => ({ ...toPlanItem(r, parsed), subtaskCount: subtasks.get(r.id) ?? 0 }));
		// To lister med samme kontekst kan finnes fra før; slå dem sammen framfor å miste én.
		byContext.set(list.context!, [...(byContext.get(list.context!) ?? []), ...items]);
	}

	return {
		days: dates.map((date) => ({
			date,
			weekday: weekdayName(date),
			items: sortPlanItems(byContext.get(dayContextForDate(date)) ?? [])
		})),
		weekLists:
			opts.includeWeekLists === false
				? []
				: weeks.map((week) => ({ week, items: byContext.get(`week:${week}`) ?? [] }))
	};
}

/** Ett punkt i en dag- eller ukeliste, med lista det står i. */
async function loadOwnPlanRow(userId: string, id: string): Promise<{ row: ChecklistItemRow; list: PlanList }> {
	if (!/^[0-9a-f-]{36}$/i.test(id)) throw new PlanError('invalid_argument', `id må være en UUID, fikk ${JSON.stringify(id)}.`);
	const row = await db.query.checklistItems.findFirst({
		where: and(eq(checklistItems.id, id), eq(checklistItems.userId, userId)),
		with: { checklist: { columns: { context: true } } }
	});
	if (!row) throw new PlanError('not_found', `Fant ikke punktet ${id}. Hent det på nytt med query_plan.`);
	const list = parsePlanContext((row as { checklist?: { context: string | null } }).checklist?.context);
	if (!list) {
		throw new PlanError(
			'not_a_plan_item',
			'Punktet står ikke i en dag- eller ukeliste (det kan være en rutine eller et prosjekt) og endres ikke herfra.'
		);
	}
	return { row: row as ChecklistItemRow, list };
}

export async function getPlanItem(userId: string, id: string): Promise<PlanItem> {
	const { row, list } = await loadOwnPlanRow(userId, id);
	return toPlanItem(row, list);
}

export interface PlanTarget {
	date?: string | null;
	week?: string | null;
}

/** Dato vinner over uke. Uten noen av dem: denne ukas liste — aldri en gjettet dag. */
function resolveTarget(target: PlanTarget): { kind: 'day'; date: string } | { kind: 'week'; week: string } {
	if (target.date !== undefined && target.date !== null) {
		if (!isValidIsoDate(target.date)) throw new PlanError('invalid_argument', `date må være YYYY-MM-DD, fikk ${JSON.stringify(target.date)}.`);
		return { kind: 'day', date: target.date };
	}
	if (target.week !== undefined && target.week !== null) {
		if (!isValidIsoWeek(target.week)) throw new PlanError('invalid_argument', `week må være YYYY-Www, fikk ${JSON.stringify(target.week)}.`);
		return { kind: 'week', week: target.week };
	}
	return { kind: 'week', week: isoWeekKeyForDate(osloTodayIso()) };
}

async function checklistFor(userId: string, target: ReturnType<typeof resolveTarget>) {
	return target.kind === 'day'
		? findOrCreateDayChecklist(userId, target.date)
		: findOrCreateWeekChecklist(userId, target.week);
}

/** Familiemedlem fra navn eller alias. Ukjent navn gir navnet tilbake uten id. */
export async function resolvePersonByName(
	userId: string,
	name: string | null | undefined
): Promise<{ id: string | null; name: string } | null> {
	if (!name?.trim()) return null;
	const wanted = name.trim().toLowerCase();
	const people = await db.query.persons.findMany({
		where: and(eq(persons.userId, userId), eq(persons.archived, false)),
		columns: { id: true, name: true, aliases: true }
	});
	const match = people.find(
		(p) => p.name.toLowerCase() === wanted || (p.aliases ?? []).some((a) => a.toLowerCase() === wanted)
	);
	return match ? { id: match.id, name: match.name } : { id: null, name: name.trim() };
}

function checkDuration(value: unknown): number | null | undefined {
	if (value === undefined) return undefined;
	if (value === null) return null;
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 24 * 60 * 7) {
		throw new PlanError('invalid_argument', 'durationMinutes må være et helt antall minutter (1–10080).');
	}
	return value;
}

export interface CreatePlanItemInput extends PlanTarget {
	text: string;
	startTime?: string | null;
	durationMinutes?: number | null;
	dueDate?: string | null;
	personName?: string | null;
	idempotencyKey?: string | null;
}

/**
 * Opprett et punkt — eller gi tilbake det som alt finnes.
 *
 * To vern mot duplikater, fordi en modell som ikke fikk svar prøver igjen:
 * `idempotencyKey` (samme nøkkel → samme punkt, uansett tekst), og ellers et
 * ÅPENT punkt med samme tekst i samme liste. Et avkrysset punkt med samme tekst
 * er ikke et duplikat — «Handle» kan stå to ganger samme uke.
 */
export async function createPlanItem(
	userId: string,
	input: CreatePlanItemInput
): Promise<{ item: PlanItem; alreadyExisted: boolean }> {
	const rawText = input.text?.trim();
	if (!rawText) throw new PlanError('invalid_argument', 'text er påkrevd.');
	const time = input.startTime ? parseStartTime(input.startTime) : null;
	if (input.startTime && !time) throw new PlanError('invalid_argument', `startTime må være HH:MM, fikk ${JSON.stringify(input.startTime)}.`);
	if (input.dueDate && !isValidIsoDate(input.dueDate)) throw new PlanError('invalid_argument', 'dueDate må være YYYY-MM-DD.');
	const duration = checkDuration(input.durationMinutes);
	const idempotencyKey = input.idempotencyKey?.trim().slice(0, 200) || null;

	if (idempotencyKey) {
		const existing = await db.query.checklistItems.findFirst({
			where: and(
				eq(checklistItems.userId, userId),
				sql`${checklistItems.metadata}->>'idempotencyKey' = ${idempotencyKey}`
			),
			columns: { id: true }
		});
		if (existing) return { item: await getPlanItem(userId, existing.id), alreadyExisted: true };
	}

	const target = resolveTarget(input);
	const checklist = await checklistFor(userId, target);
	const person = await resolvePersonByName(userId, input.personName);
	const text = person && !rawText.toLowerCase().startsWith(`${person.name.toLowerCase()}:`) ? `${person.name}: ${rawText}` : rawText;

	const fields = await buildChecklistItemFields({
		userId,
		context: checklist.context,
		text,
		allowTaskCreation: false
	});

	const siblings = await db.query.checklistItems.findMany({
		where: and(eq(checklistItems.checklistId, checklist.id), isNull(checklistItems.parentId)),
		columns: { id: true, text: true, checked: true, skippedAt: true, sortOrder: true }
	});
	const duplicate = siblings.find(
		(s) => !s.checked && !s.skippedAt && normalizeItemText(s.text) === normalizeItemText(fields.text)
	);
	if (duplicate) return { item: await getPlanItem(userId, duplicate.id), alreadyExisted: true };

	const metadata: Record<string, unknown> = {
		...fields.metadata,
		source: 'mcp',
		...(time ? { timeHour: time.hour, timeMinute: time.minute } : {}),
		...(person ? { personName: person.name, ...(person.id ? { personId: person.id } : {}) } : {}),
		...(idempotencyKey ? { idempotencyKey } : {})
	};

	const [created] = await db
		.insert(checklistItems)
		.values({
			checklistId: checklist.id,
			userId,
			text: fields.text,
			startDate: fields.startDate,
			dueDate: input.dueDate ?? null,
			estimateMinutes: duration ?? null,
			sortOrder: siblings.reduce((max, s) => Math.max(max, s.sortOrder), -1) + 1,
			metadata
		})
		.returning();

	// Samme bivirkninger som når punktet skrives i appen (POST …/items).
	runInBackground(PersonMentionService.indexChecklistItem(userId, created.id, created.text));
	if (fields.locationDayIso) runInBackground(syncStaysForDate(userId, fields.locationDayIso));
	if (created.metadata?.mealType) runInBackground(afterMealItemWritten(userId, created, checklist.context));
	await syncChecklistCompletion(checklist.id);

	return { item: await getPlanItem(userId, created.id), alreadyExisted: false };
}

export interface UpdatePlanItemInput extends PlanTarget {
	text?: string;
	/** `null` fjerner klokkeslettet. */
	startTime?: string | null;
	durationMinutes?: number | null;
	dueDate?: string | null;
}

/**
 * Endre et punkt. Bare feltene som er med endres — et punkt som får ny tekst
 * beholder klokkeslettet sitt, selv om appens re-parsing av teksten ellers ville
 * nullstilt det.
 */
export async function updatePlanItem(userId: string, id: string, input: UpdatePlanItemInput): Promise<PlanItem> {
	const { row } = await loadOwnPlanRow(userId, id);
	const previousMeta = (row.metadata ?? {}) as Record<string, unknown>;

	let time: { hour: number; minute: number } | null | undefined;
	if (input.startTime === null) time = null;
	else if (input.startTime !== undefined) {
		time = parseStartTime(input.startTime);
		if (!time) throw new PlanError('invalid_argument', `startTime må være HH:MM, fikk ${JSON.stringify(input.startTime)}.`);
	}
	if (input.dueDate && !isValidIsoDate(input.dueDate)) throw new PlanError('invalid_argument', 'dueDate må være YYYY-MM-DD.');
	const duration = checkDuration(input.durationMinutes);

	let current: ChecklistItemRow = row;
	if (input.text !== undefined) {
		if (!input.text.trim()) throw new PlanError('invalid_argument', 'text kan ikke være tom.');
		current = (await updateChecklistItem(userId, id, { text: input.text })) ?? current;
	}

	const meta = { ...((current.metadata ?? {}) as Record<string, unknown>) };
	if (time === null) {
		delete meta.timeHour;
		delete meta.timeMinute;
	} else if (time) {
		meta.timeHour = time.hour;
		meta.timeMinute = time.minute;
	} else if (meta.timeHour === undefined && typeof previousMeta.timeHour === 'number') {
		meta.timeHour = previousMeta.timeHour;
		meta.timeMinute = previousMeta.timeMinute ?? 0;
	}

	const columns: Partial<typeof checklistItems.$inferInsert> = { metadata: meta };
	if (duration !== undefined) columns.estimateMinutes = duration;
	if (input.dueDate !== undefined) columns.dueDate = input.dueDate;
	await db
		.update(checklistItems)
		.set(columns)
		.where(and(eq(checklistItems.id, id), eq(checklistItems.userId, userId)));

	if (input.date !== undefined || input.week !== undefined) {
		return movePlanItem(userId, id, { date: input.date, week: input.week });
	}
	return getPlanItem(userId, id);
}

/**
 * Flytt et punkt til en dag eller en ukeliste — samme rad, ingen kopi.
 * `{ toWeekList: true }` legger et dagpunkt tilbake i ukelista for sin egen uke.
 */
export async function movePlanItem(
	userId: string,
	id: string,
	target: PlanTarget & { toWeekList?: boolean }
): Promise<PlanItem> {
	const { list } = await loadOwnPlanRow(userId, id);
	let resolved: ReturnType<typeof resolveTarget>;
	if (target.toWeekList) resolved = { kind: 'week', week: target.week && isValidIsoWeek(target.week) ? target.week : list.week };
	else if (!target.date && !target.week) throw new PlanError('invalid_argument', 'move krever date, week eller toWeekList.');
	else resolved = resolveTarget(target);

	const checklist = await checklistFor(userId, resolved);
	await moveChecklistItem(userId, id, {
		checklistId: checklist.id,
		dayIso: resolved.kind === 'day' ? resolved.date : null
	});
	return getPlanItem(userId, id);
}

export async function setPlanItemStatus(
	userId: string,
	id: string,
	status: 'done' | 'open' | 'skipped'
): Promise<PlanItem> {
	await loadOwnPlanRow(userId, id);
	await updateChecklistItem(
		userId,
		id,
		status === 'done' ? { checked: true } : status === 'skipped' ? { skipped: true } : { checked: false, skipped: false }
	);
	return getPlanItem(userId, id);
}

export async function deletePlanItem(userId: string, id: string): Promise<{ deleted: PlanItem }> {
	const item = await getPlanItem(userId, id);
	await deleteChecklistItem(userId, id);
	return { deleted: item };
}
