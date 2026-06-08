import { db } from '$lib/db';
import { routineDefinitions, checklists, checklistItems } from '$lib/db/schema';
import { and, eq, asc, inArray, like } from 'drizzle-orm';

export type RoutineSlot = 'morning' | 'afternoon' | 'evening' | 'flex';

export interface RoutineItemInput {
	text: string;
	estimateMinutes?: number;
	sortOrder?: number;
}

export interface RoutineDefinitionInput {
	id?: string;
	title: string;
	emoji?: string;
	slot: RoutineSlot;
	daysOfWeek: number[];           // 0=søndag .. 6=lørdag
	items: RoutineItemInput[];
	active?: boolean;
	sortOrder?: number;
}

export interface RoutineDefinitionRow {
	id: string;
	userId: string;
	title: string;
	emoji: string;
	slot: RoutineSlot;
	daysOfWeek: number[];
	items: Array<{ text: string; estimateMinutes?: number; sortOrder?: number }>;
	active: boolean;
	sortOrder: number;
	createdAt: Date;
	updatedAt: Date;
}

const ALLOWED_SLOTS: RoutineSlot[] = ['morning', 'afternoon', 'evening', 'flex'];

function normalizeDays(days: number[]): number[] {
	const set = new Set<number>();
	for (const d of days) {
		const n = Number(d);
		if (Number.isInteger(n) && n >= 0 && n <= 6) set.add(n);
	}
	return [...set].sort((a, b) => a - b);
}

function normalizeItems(items: RoutineItemInput[]): Array<{ text: string; estimateMinutes?: number; sortOrder: number }> {
	return items
		.filter((it) => typeof it.text === 'string' && it.text.trim().length > 0)
		.map((it, idx) => ({
			text: it.text.trim(),
			estimateMinutes: typeof it.estimateMinutes === 'number' && it.estimateMinutes > 0 ? it.estimateMinutes : undefined,
			sortOrder: typeof it.sortOrder === 'number' ? it.sortOrder : idx
		}));
}

export async function listRoutineDefinitions(userId: string, opts: { includeInactive?: boolean } = {}): Promise<RoutineDefinitionRow[]> {
	const where = opts.includeInactive
		? eq(routineDefinitions.userId, userId)
		: and(eq(routineDefinitions.userId, userId), eq(routineDefinitions.active, true));

	const rows = await db
		.select()
		.from(routineDefinitions)
		.where(where)
		.orderBy(asc(routineDefinitions.sortOrder), asc(routineDefinitions.createdAt));

	return rows.map((r) => ({
		id: r.id,
		userId: r.userId,
		title: r.title,
		emoji: r.emoji,
		slot: (r.slot as RoutineSlot) ?? 'flex',
		daysOfWeek: (r.daysOfWeek ?? []) as number[],
		items: (r.items ?? []) as Array<{ text: string; estimateMinutes?: number; sortOrder?: number }>,
		active: r.active,
		sortOrder: r.sortOrder,
		createdAt: r.createdAt,
		updatedAt: r.updatedAt
	}));
}

export async function getRoutineDefinition(userId: string, id: string): Promise<RoutineDefinitionRow | null> {
	const [row] = await db
		.select()
		.from(routineDefinitions)
		.where(and(eq(routineDefinitions.userId, userId), eq(routineDefinitions.id, id)))
		.limit(1);

	if (!row) return null;
	return {
		id: row.id,
		userId: row.userId,
		title: row.title,
		emoji: row.emoji,
		slot: (row.slot as RoutineSlot) ?? 'flex',
		daysOfWeek: (row.daysOfWeek ?? []) as number[],
		items: (row.items ?? []) as Array<{ text: string; estimateMinutes?: number; sortOrder?: number }>,
		active: row.active,
		sortOrder: row.sortOrder,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt
	};
}

export async function upsertRoutineDefinition(userId: string, input: RoutineDefinitionInput): Promise<RoutineDefinitionRow> {
	if (!input.title || input.title.trim().length === 0) {
		throw new Error('title is required');
	}
	if (!ALLOWED_SLOTS.includes(input.slot)) {
		throw new Error(`slot must be one of ${ALLOWED_SLOTS.join(', ')}`);
	}

	const days = normalizeDays(input.daysOfWeek);
	const items = normalizeItems(input.items);

	if (input.id) {
		const [updated] = await db
			.update(routineDefinitions)
			.set({
				title: input.title.trim(),
				emoji: input.emoji ?? '🔁',
				slot: input.slot,
				daysOfWeek: days,
				items,
				active: input.active ?? true,
				sortOrder: input.sortOrder ?? 0,
				updatedAt: new Date()
			})
			.where(and(eq(routineDefinitions.userId, userId), eq(routineDefinitions.id, input.id)))
			.returning();
		if (!updated) throw new Error('routine not found');
		return {
			id: updated.id,
			userId: updated.userId,
			title: updated.title,
			emoji: updated.emoji,
			slot: updated.slot as RoutineSlot,
			daysOfWeek: (updated.daysOfWeek ?? []) as number[],
			items: (updated.items ?? []) as Array<{ text: string; estimateMinutes?: number; sortOrder?: number }>,
			active: updated.active,
			sortOrder: updated.sortOrder,
			createdAt: updated.createdAt,
			updatedAt: updated.updatedAt
		};
	}

	const [created] = await db
		.insert(routineDefinitions)
		.values({
			userId,
			title: input.title.trim(),
			emoji: input.emoji ?? '🔁',
			slot: input.slot,
			daysOfWeek: days,
			items,
			active: input.active ?? true,
			sortOrder: input.sortOrder ?? 0
		})
		.returning();

	return {
		id: created.id,
		userId: created.userId,
		title: created.title,
		emoji: created.emoji,
		slot: created.slot as RoutineSlot,
		daysOfWeek: (created.daysOfWeek ?? []) as number[],
		items: (created.items ?? []) as Array<{ text: string; estimateMinutes?: number; sortOrder?: number }>,
		active: created.active,
		sortOrder: created.sortOrder,
		createdAt: created.createdAt,
		updatedAt: created.updatedAt
	};
}

export async function deleteRoutineDefinition(userId: string, id: string, opts: { hard?: boolean } = {}): Promise<void> {
	if (opts.hard) {
		await db
			.delete(routineDefinitions)
			.where(and(eq(routineDefinitions.userId, userId), eq(routineDefinitions.id, id)));
		return;
	}
	await db
		.update(routineDefinitions)
		.set({ active: false, updatedAt: new Date() })
		.where(and(eq(routineDefinitions.userId, userId), eq(routineDefinitions.id, id)));
}

export interface MaterializedRoutineItem {
	id: string;
	text: string;
	checked: boolean;
	sortOrder: number;
	estimateMinutes: number | null;
}

export interface MaterializedRoutine {
	definition: {
		id: string;
		title: string;
		emoji: string;
		slot: RoutineSlot;
	};
	checklistId: string;
	date: string;          // YYYY-MM-DD (lokal dag)
	items: MaterializedRoutineItem[];
	completedAt: Date | null;
}

// Norge-lokal "i dag" — vi bruker Europe/Oslo eksplisitt for å unngå at materialisering
// glipper unna ved midnatt UTC.
function osloDateParts(now: Date): { ymd: string; dow: number } {
	const fmt = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Europe/Oslo',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		weekday: 'short'
	});
	const parts = fmt.formatToParts(now);
	const year = parts.find((p) => p.type === 'year')?.value ?? '1970';
	const month = parts.find((p) => p.type === 'month')?.value ?? '01';
	const day = parts.find((p) => p.type === 'day')?.value ?? '01';
	const weekdayShort = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
	const weekdayMap: Record<string, number> = {
		Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6
	};
	return { ymd: `${year}-${month}-${day}`, dow: weekdayMap[weekdayShort] ?? 0 };
}

export async function materializeTodaysRoutines(userId: string, now: Date = new Date()): Promise<MaterializedRoutine[]> {
	const { ymd, dow } = osloDateParts(now);

	const definitions = await listRoutineDefinitions(userId, { includeInactive: false });
	const matching = definitions.filter((d) => Array.isArray(d.daysOfWeek) && d.daysOfWeek.includes(dow));
	if (matching.length === 0) return [];

	const results: MaterializedRoutine[] = [];

	for (const def of matching) {
		const context = `routine:${def.id}:${ymd}`;

		const [existing] = await db
			.select()
			.from(checklists)
			.where(and(eq(checklists.userId, userId), eq(checklists.context, context)))
			.limit(1);

		let checklistId: string;
		let completedAt: Date | null = null;

		if (existing) {
			checklistId = existing.id;
			completedAt = existing.completedAt;
		} else {
			const [created] = await db
				.insert(checklists)
				.values({
					userId,
					title: def.title,
					emoji: def.emoji,
					context
				})
				.returning();
			checklistId = created.id;

			const itemsToInsert = (def.items ?? []).map((it, idx) => ({
				checklistId,
				userId,
				text: it.text,
				sortOrder: typeof it.sortOrder === 'number' ? it.sortOrder : idx,
				estimateMinutes: typeof it.estimateMinutes === 'number' ? it.estimateMinutes : null
			}));
			if (itemsToInsert.length > 0) {
				await db.insert(checklistItems).values(itemsToInsert);
			}
		}

		const itemRows = await db
			.select()
			.from(checklistItems)
			.where(eq(checklistItems.checklistId, checklistId))
			.orderBy(asc(checklistItems.sortOrder));

		results.push({
			definition: { id: def.id, title: def.title, emoji: def.emoji, slot: def.slot },
			checklistId,
			date: ymd,
			completedAt,
			items: itemRows.map((it) => ({
				id: it.id,
				text: it.text,
				checked: it.checked,
				sortOrder: it.sortOrder,
				estimateMinutes: it.estimateMinutes
			}))
		});
	}

	results.sort((a, b) => {
		const slotOrder: Record<RoutineSlot, number> = { morning: 0, afternoon: 1, evening: 2, flex: 3 };
		const slotDiff = slotOrder[a.definition.slot] - slotOrder[b.definition.slot];
		if (slotDiff !== 0) return slotDiff;
		return a.definition.title.localeCompare(b.definition.title);
	});

	return results;
}

function dowFromIsoDate(isoDate: string): number {
	const [y, m, d] = isoDate.split('-').map(Number);
	const date = new Date(Date.UTC(y, m - 1, d));
	return date.getUTCDay();
}

export async function materializeRoutinesForDates(
	userId: string,
	dates: string[]
): Promise<Record<string, MaterializedRoutine[]>> {
	const definitions = await listRoutineDefinitions(userId, { includeInactive: false });
	if (definitions.length === 0) return {};

	const slotOrder: Record<RoutineSlot, number> = { morning: 0, afternoon: 1, evening: 2, flex: 3 };

	const matchPairs: Array<{ ymd: string; def: RoutineDefinitionRow; context: string }> = [];
	for (const ymd of dates) {
		const dow = dowFromIsoDate(ymd);
		for (const def of definitions) {
			if (Array.isArray(def.daysOfWeek) && def.daysOfWeek.includes(dow)) {
				matchPairs.push({ ymd, def, context: `routine:${def.id}:${ymd}` });
			}
		}
	}
	if (matchPairs.length === 0) return {};

	const allContexts = matchPairs.map(p => p.context);
	const existingRows = await db
		.select()
		.from(checklists)
		.where(and(eq(checklists.userId, userId), inArray(checklists.context, allContexts)));
	const checklistByContext = new Map(existingRows.map(c => [c.context, c]));

	const missingPairs = matchPairs.filter(p => !checklistByContext.has(p.context));
	if (missingPairs.length > 0) {
		const inserted = await db
			.insert(checklists)
			.values(missingPairs.map(p => ({
				userId,
				title: p.def.title,
				emoji: p.def.emoji,
				context: p.context
			})))
			.returning();
		for (const row of inserted) {
			checklistByContext.set(row.context, row);
		}

		const allItemsToInsert: Array<{ checklistId: string; userId: string; text: string; sortOrder: number; estimateMinutes: number | null }> = [];
		for (const p of missingPairs) {
			const cl = checklistByContext.get(p.context);
			if (!cl) continue;
			for (let idx = 0; idx < (p.def.items ?? []).length; idx++) {
				const it = p.def.items[idx];
				allItemsToInsert.push({
					checklistId: cl.id,
					userId,
					text: it.text,
					sortOrder: typeof it.sortOrder === 'number' ? it.sortOrder : idx,
					estimateMinutes: typeof it.estimateMinutes === 'number' ? it.estimateMinutes : null
				});
			}
		}
		if (allItemsToInsert.length > 0) {
			await db.insert(checklistItems).values(allItemsToInsert);
		}
	}

	const allChecklistIds = [...checklistByContext.values()].map(c => c.id);
	const allItems = await db
		.select()
		.from(checklistItems)
		.where(inArray(checklistItems.checklistId, allChecklistIds))
		.orderBy(asc(checklistItems.sortOrder));

	const itemsByChecklistId = new Map<string, typeof allItems>();
	for (const item of allItems) {
		let arr = itemsByChecklistId.get(item.checklistId);
		if (!arr) { arr = []; itemsByChecklistId.set(item.checklistId, arr); }
		arr.push(item);
	}

	const result: Record<string, MaterializedRoutine[]> = {};
	for (const p of matchPairs) {
		const cl = checklistByContext.get(p.context);
		if (!cl) continue;
		const items = itemsByChecklistId.get(cl.id) ?? [];

		if (!result[p.ymd]) result[p.ymd] = [];
		result[p.ymd].push({
			definition: { id: p.def.id, title: p.def.title, emoji: p.def.emoji, slot: p.def.slot },
			checklistId: cl.id,
			date: p.ymd,
			completedAt: cl.completedAt,
			items: items.map(it => ({
				id: it.id,
				text: it.text,
				checked: it.checked,
				sortOrder: it.sortOrder,
				estimateMinutes: it.estimateMinutes
			}))
		});
	}

	for (const dayResults of Object.values(result)) {
		dayResults.sort((a, b) => {
			const diff = slotOrder[a.definition.slot] - slotOrder[b.definition.slot];
			if (diff !== 0) return diff;
			return a.definition.title.localeCompare(b.definition.title);
		});
	}

	return result;
}

// Brukt av signal-produsenten for adherence-beregning siste 7 dager.
export async function listRoutineInstancesSinceUtc(userId: string, since: Date) {
	const rows = await db
		.select({
			checklistId: checklists.id,
			context: checklists.context,
			createdAt: checklists.createdAt,
			completedAt: checklists.completedAt
		})
		.from(checklists)
		.where(and(
			eq(checklists.userId, userId),
			like(checklists.context, 'routine:%')
		));

	return rows.filter((r) => r.createdAt >= since);
}

export const RoutineService = {
	listDefinitions: listRoutineDefinitions,
	getDefinition: getRoutineDefinition,
	upsertDefinition: upsertRoutineDefinition,
	deleteDefinition: deleteRoutineDefinition,
	materializeToday: materializeTodaysRoutines
};
