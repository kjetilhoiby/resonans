/**
 * meal-plan-sync.ts — toveis synk mellom meal_plans og ukeplanens dag-items.
 *
 * Retning A (plan → dag-item): når en meal_plan opprettes/endres/slettes,
 * speiles den som et «middag: X»-punkt på dagens sjekkliste.
 * Retning B (dag-item → plan): når et dag-punkt med måltidsprefiks skrives,
 * opprettes/oppdateres meal_plans-raden det speiler.
 *
 * LOOP-BESKYTTELSE (invariant): funksjonene her skriver alltid direkte via db
 * og kaller aldri hverandre eller HTTP-endepunkter. Hooks bor utelukkende i
 * API-/verktøylaget (meal-plans-REST, manage_meal_plan, checklist-endepunkter).
 * En synk kan derfor aldri trigge en ny synk.
 *
 * IDEMPOTENS: koblingen er checklist_items.metadata.linkedMealPlanId ↔
 * meal_plans.id. Gjenkjøring av retning A finner eksisterende item via nøkkelen
 * (ingen duplikater); retning B kortslutter på samme nøkkel. linkedMealPlanId
 * er bevisst IKKE i PARSE_DERIVED_METADATA_KEYS, så den overlever tekstredigering.
 */

import { db } from '$lib/db';
import { checklistItems, checklists, mealPlans, meals } from '$lib/db/schema';
import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import {
	buildMealItemText,
	detectMealPrefix,
	FAMILY_DEFAULT_SERVINGS,
	type MealType
} from '$lib/domains/food';
import { dayContextForDate, isoWeekKeyForDate } from '$lib/server/iso-week';
import {
	isMealPlanStatus,
	isTakeawayMeal,
	TAKEAWAY_TAG,
	statusFromChecklistItem,
	type MealPlanStatus
} from '$lib/domains/food/meal-log';
import { findOrCreateMealId } from '$lib/server/task-intent-parser';

type MealPlanRow = typeof mealPlans.$inferSelect;
type ChecklistItemRow = typeof checklistItems.$inferSelect;
type ItemMetadata = NonNullable<ChecklistItemRow['metadata']>;

// ─── Rene beslutningshjelpere (testbare uten db) ───────────────

/**
 * Kan dette dag-punktet adopteres som speil for en meal_plan? Krever samme
 * måltidstype OG samme tittel — adopsjon skal gjenkjenne punktet som allerede
 * beskriver planen, aldri omskrive et bruker-skrevet punkt om noe annet.
 */
export function shouldAdoptItem(
	item: { checked: boolean; text: string; metadata?: { linkedMealPlanId?: string; mealType?: string } | null },
	mealType: MealType,
	title: string,
	status: MealPlanStatus = 'planned'
): boolean {
	// Et avkrysset punkt er en middag som er spist. Det kan bare beskrive en plan
	// som også sier spist — ellers ville en ny plan for samme rett arvet haken.
	if (item.checked && status !== 'eaten') return false;
	if (item.metadata?.linkedMealPlanId) return false;
	const meal = detectMealPrefix(item.text);
	return (
		meal !== null &&
		meal.mealType === mealType &&
		meal.cleanTitle.toLowerCase() === title.trim().toLowerCase()
	);
}

/** Bygg tekst + metadata-endringer for et dag-punkt som speiler en meal_plan. */
export function mealItemFieldsFor(
	plan: { id: string; mealType: string; mealId: string | null },
	mealTitle: string,
	existingMetadata: Record<string, unknown> = {}
): { text: string; metadata: Record<string, unknown> } {
	return {
		text: buildMealItemText(plan.mealType as MealType, mealTitle),
		metadata: {
			...existingMetadata,
			mealType: plan.mealType,
			linkedMealPlanId: plan.id,
			...(plan.mealId ? { linkedMealId: plan.mealId } : {})
		}
	};
}

/**
 * Feltene et dag-punkt må få for å speile en status, eller null når punktet alt
 * står riktig. Et utsatt punkt (skippedAt + snoozedToDate) leses som «planlagt»
 * og røres ikke av en plan som fortsatt er planlagt.
 */
export function itemStateUpdateFor(
	item: { checked: boolean; checkedAt?: Date | null; skippedAt: Date | null; snoozedToDate?: string | null },
	status: MealPlanStatus,
	now: Date = new Date()
): { checked: boolean; checkedAt: Date | null; skippedAt: Date | null } | null {
	if (statusFromChecklistItem(item) === status) return null;
	if (status === 'eaten') return { checked: true, checkedAt: item.checkedAt ?? now, skippedAt: null };
	if (status === 'skipped') return { checked: false, checkedAt: null, skippedAt: now };
	return { checked: false, checkedAt: null, skippedAt: null };
}

/** Utled dag-dato («YYYY-MM-DD») fra en sjekkliste-kontekst, ellers null. */
export function dayDateFromContext(context: string | null): string | null {
	if (!context) return null;
	const match = context.match(/:day:(\d{4}-\d{2}-\d{2})$/);
	return match ? match[1] : null;
}

// ─── Retning A: meal_plan → dag-item ───────────────────────────

async function resolveMealTitle(userId: string, plan: MealPlanRow): Promise<string | null> {
	if (plan.mealId) {
		const meal = await db.query.meals.findFirst({
			where: and(eq(meals.id, plan.mealId), eq(meals.userId, userId)),
			columns: { title: true }
		});
		if (meal?.title) return meal.title;
	}
	return plan.notes?.trim() || null;
}

async function findOrCreateDayChecklist(userId: string, dateIso: string) {
	const context = dayContextForDate(dateIso);
	const existing = await db.query.checklists.findFirst({
		where: and(eq(checklists.userId, userId), eq(checklists.context, context)),
		columns: { id: true }
	});
	if (existing) return existing.id;

	const [created] = await db
		.insert(checklists)
		.values({ userId, title: `Dag ${dateIso}`, emoji: '☑️', context })
		.returning({ id: checklists.id });
	return created.id;
}

/** Dagen er ferdig når alle punktene er hakket av eller hoppet over. */
async function refreshDayCompletion(checklistId: string): Promise<void> {
	const items = await db.query.checklistItems.findMany({
		where: eq(checklistItems.checklistId, checklistId),
		columns: { checked: true, skippedAt: true }
	});
	const done = items.length > 0 && items.every((item) => item.checked || item.skippedAt);
	await db
		.update(checklists)
		.set({ completedAt: done ? sql`coalesce(${checklists.completedAt}, now())` : null })
		.where(eq(checklists.id, checklistId));
}

/**
 * Speil en meal_plan-rad som dag-punkt. Finner eksisterende punkt via
 * linkedMealPlanId, adopterer et løst «middag: …»-punkt med samme mealType,
 * eller oppretter et nytt. Uten oppløselig tittel (verken meal eller notes)
 * gjøres ingenting.
 */
export async function syncMealPlanToDayItem(userId: string, plan: MealPlanRow): Promise<void> {
	const title = await resolveMealTitle(userId, plan);
	if (!title) return;

	const checklistId = await findOrCreateDayChecklist(userId, plan.date);
	const items = await db.query.checklistItems.findMany({
		where: and(eq(checklistItems.checklistId, checklistId), eq(checklistItems.userId, userId))
	});

	const status: MealPlanStatus = isMealPlanStatus(plan.status) ? plan.status : 'planned';
	const linked = items.find((item) => item.metadata?.linkedMealPlanId === plan.id);
	const target =
		linked ?? items.find((item) => shouldAdoptItem(item, plan.mealType as MealType, title, status)) ?? null;

	if (target) {
		const fields = mealItemFieldsFor(plan, title, (target.metadata ?? {}) as Record<string, unknown>);
		const stateUpdate = itemStateUpdateFor(target, status);
		if (target.text !== fields.text || target.metadata?.linkedMealPlanId !== plan.id || stateUpdate) {
			await db
				.update(checklistItems)
				.set({ text: fields.text, metadata: fields.metadata as ItemMetadata, ...(stateUpdate ?? {}) })
				.where(eq(checklistItems.id, target.id));
		}
		if (stateUpdate) await refreshDayCompletion(checklistId);
		return;
	}

	const maxSort = items.reduce((max, item) => Math.max(max, item.sortOrder), 0);
	const fields = mealItemFieldsFor(plan, title);
	const initialState = itemStateUpdateFor({ checked: false, skippedAt: null }, status);
	await db.insert(checklistItems).values({
		checklistId,
		userId,
		text: fields.text,
		sortOrder: maxSort + 1,
		metadata: fields.metadata as ItemMetadata,
		...(initialState ?? {})
	});
	// Nytt punkt → dagen er «ferdig» bare hvis det nye punktet også er det.
	await refreshDayCompletion(checklistId);
}

/** Fjern dag-punktet som speiler en meal_plan (ved sletting eller datoflytting). */
export async function removeDayItemForMealPlan(userId: string, plan: MealPlanRow): Promise<void> {
	const context = dayContextForDate(plan.date);
	const checklist = await db.query.checklists.findFirst({
		where: and(eq(checklists.userId, userId), eq(checklists.context, context)),
		columns: { id: true }
	});
	if (!checklist) return;

	const items = await db.query.checklistItems.findMany({
		where: and(eq(checklistItems.checklistId, checklist.id), eq(checklistItems.userId, userId)),
		columns: { id: true, metadata: true, checked: true, skippedAt: true }
	});
	const target = items.find((item) => item.metadata?.linkedMealPlanId === plan.id);
	if (!target) return;

	await db.delete(checklistItems).where(eq(checklistItems.id, target.id));

	// Var middagen siste ubehandlede punkt, er dagen nå ferdig — speiler
	// syncChecklistCompletion i checklist-endepunktet (som denne veien ikke går via).
	const remaining = items.filter((item) => item.id !== target.id);
	if (remaining.length > 0 && remaining.every((item) => item.checked || item.skippedAt)) {
		await db
			.update(checklists)
			.set({ completedAt: new Date() })
			.where(and(eq(checklists.id, checklist.id), sql`${checklists.completedAt} IS NULL`));
	}
}

/**
 * Flytt en meal_plan til ny dato (brukes av snooze av «middag: …»-punkter).
 * Oppdaterer date + weekContext uten dag-item-synk — snooze-endepunktet eier
 * selve punktene (original + kopi).
 */
export async function moveMealPlanToDate(
	userId: string,
	planId: string,
	newDateIso: string
): Promise<void> {
	await db
		.update(mealPlans)
		.set({
			date: newDateIso,
			weekContext: isoWeekKeyForDate(newDateIso),
			updatedAt: new Date()
		})
		.where(and(eq(mealPlans.id, planId), eq(mealPlans.userId, userId)));
}

// ─── Retning B: dag-item → meal_plan ───────────────────────────

/**
 * Etter at et dag-punkt er skrevet (opprettet eller tekst-redigert): sørg for
 * at meal_plans speiler punktet. Ikke-dag-kontekster er no-op.
 */
export async function afterMealItemWritten(
	userId: string,
	item: ChecklistItemRow,
	checklistContext: string | null
): Promise<void> {
	const dateIso = dayDateFromContext(checklistContext);
	if (!dateIso) return;

	const meta = (item.metadata ?? {}) as Record<string, unknown>;
	const mealType = typeof meta.mealType === 'string' ? (meta.mealType as MealType) : null;
	const linkedMealPlanId = typeof meta.linkedMealPlanId === 'string' ? meta.linkedMealPlanId : null;

	// Måltidsprefiks redigert bort → punktet er ikke lenger et måltid; rydd plan-raden.
	if (!mealType) {
		if (linkedMealPlanId) {
			await db
				.delete(mealPlans)
				.where(and(eq(mealPlans.id, linkedMealPlanId), eq(mealPlans.userId, userId)));
			const cleaned = { ...meta };
			delete cleaned.linkedMealPlanId;
			await db
				.update(checklistItems)
				.set({ metadata: cleaned as ItemMetadata })
				.where(eq(checklistItems.id, item.id));
		}
		return;
	}

	// linkedMealId kan mangle (f.eks. items opprettet før denne synken fantes) —
	// slå opp/lag meal-raden fra tittel slik at plan-raden får kobling.
	let mealId = typeof meta.linkedMealId === 'string' ? meta.linkedMealId : null;
	if (!mealId) {
		const parsed = detectMealPrefix(item.text);
		if (parsed) mealId = await findOrCreateMealId(userId, parsed.cleanTitle);
	}

	if (linkedMealPlanId) {
		const [updated] = await db
			.update(mealPlans)
			.set({ mealType, mealId, updatedAt: new Date() })
			.where(and(eq(mealPlans.id, linkedMealPlanId), eq(mealPlans.userId, userId)))
			.returning({ id: mealPlans.id });
		if (updated) return;
		// Plan-raden er borte (slettet et annet sted) — fall gjennom og opprett ny.
	}

	const [created] = await db
		.insert(mealPlans)
		.values({
			userId,
			weekContext: isoWeekKeyForDate(dateIso),
			date: dateIso,
			mealType,
			mealId,
			servings: FAMILY_DEFAULT_SERVINGS
		})
		.returning({ id: mealPlans.id });

	if (created) {
		// Re-les metadata rett før skriving: hooken kjører i bakgrunnen, og en
		// rask PATCH kan ha oppdatert punktet siden snapshotet vårt. Merge inn
		// i FERSK metadata i stedet for å skrive tilbake det gamle objektet.
		const fresh = await db.query.checklistItems.findFirst({
			where: and(eq(checklistItems.id, item.id), eq(checklistItems.userId, userId)),
			columns: { metadata: true }
		});
		if (!fresh) {
			// Punktet er slettet i mellomtiden — rydd opp plan-raden vi nettopp laget.
			await db.delete(mealPlans).where(eq(mealPlans.id, created.id));
			return;
		}
		await db
			.update(checklistItems)
			.set({
				metadata: {
					...((fresh.metadata ?? {}) as Record<string, unknown>),
					linkedMealPlanId: created.id,
					...(mealId ? { linkedMealId: mealId } : {})
				} as ItemMetadata
			})
			.where(eq(checklistItems.id, item.id));
	}
}

/**
 * Etter at et dag-punkt er hakket av, hoppet over eller gjenåpnet: speil det til
 * planradens status. Avkryssingen ER registreringen av at middagen ble spist.
 */
export async function afterMealItemStateChanged(
	userId: string,
	item: Pick<ChecklistItemRow, 'metadata' | 'checked' | 'skippedAt' | 'snoozedToDate'>
): Promise<void> {
	const linkedMealPlanId = item.metadata?.linkedMealPlanId;
	if (typeof linkedMealPlanId !== 'string') return;
	const status = statusFromChecklistItem(item);
	await db
		.update(mealPlans)
		.set({ status, updatedAt: new Date() })
		.where(
			and(
				eq(mealPlans.id, linkedMealPlanId),
				eq(mealPlans.userId, userId),
				sql`${mealPlans.status} IS DISTINCT FROM ${status}`
			)
		);
}

/** Etter at et dag-punkt er slettet: slett meal_plans-raden det speilet. */
export async function afterMealItemDeleted(
	userId: string,
	item: Pick<ChecklistItemRow, 'metadata'>
): Promise<void> {
	const linkedMealPlanId = item.metadata?.linkedMealPlanId;
	if (typeof linkedMealPlanId !== 'string') return;
	await db
		.delete(mealPlans)
		.where(and(eq(mealPlans.id, linkedMealPlanId), eq(mealPlans.userId, userId)));
}

// ─── Felles upsert-API (brukes av REST + AI-verktøy + onsdagsøkta) ──

export type UpsertMealPlanParams = {
	id?: string;
	weekContext?: string;
	date?: string;
	mealType?: MealType | string;
	mealId?: string | null;
	mealName?: string;
	notes?: string | null;
	servings?: number;
	photoUrl?: string | null;
	status?: MealPlanStatus;
	/** Retten er takeaway/restaurant — tagges på retten, aldri foreslått å lage. */
	takeaway?: boolean;
};

/**
 * Opprett eller oppdater en meal_plan og speil den til ukeplanen. Ved dato-
 * eller måltidstype-endring fjernes det gamle dag-punktet før det nye skrives.
 * Flere måltider samme dag/type er lovlig — mapping er per rad-id.
 */
export async function upsertMealPlan(
	userId: string,
	params: UpsertMealPlanParams,
	opts: { syncToDay?: boolean } = {}
): Promise<MealPlanRow | null> {
	const syncToDay = opts.syncToDay !== false;

	// Eksplisitt navngitte måltider (fra AI-verktøy/økta) matches kun eksakt —
	// «Taco» skal opprette ny rett, ikke kobles til «Tacosuppe».
	let mealId: string | null | undefined = params.mealId;
	if (mealId === undefined && params.mealName) {
		mealId = await findOrCreateMealId(userId, params.mealName, { match: 'exact' });
	}

	if (params.id) {
		const existing = await db.query.mealPlans.findFirst({
			where: and(eq(mealPlans.id, params.id), eq(mealPlans.userId, userId))
		});
		if (!existing) return null;
		const effectiveMealId = mealId !== undefined ? mealId : existing.mealId;
		if (params.takeaway && effectiveMealId) await markMealTakeaway(userId, effectiveMealId);

		const updates: Record<string, unknown> = { updatedAt: new Date() };
		if (params.date !== undefined) {
			updates.date = params.date;
			updates.weekContext = params.weekContext ?? isoWeekKeyForDate(params.date);
		}
		if (params.mealType !== undefined) updates.mealType = params.mealType;
		if (mealId !== undefined) updates.mealId = mealId;
		if (params.notes !== undefined) updates.notes = params.notes;
		if (params.servings !== undefined) updates.servings = params.servings;
		if (params.photoUrl !== undefined) updates.photoUrl = params.photoUrl;
		if (params.status !== undefined) updates.status = params.status;

		const [updated] = await db
			.update(mealPlans)
			.set(updates)
			.where(and(eq(mealPlans.id, params.id), eq(mealPlans.userId, userId)))
			.returning();

		if (updated && syncToDay) {
			const moved = updated.date !== existing.date;
			if (moved) await removeDayItemForMealPlan(userId, existing);
			await syncMealPlanToDayItem(userId, updated);
		}
		return updated ?? null;
	}

	if (!params.date || !params.mealType) return null;
	if (params.takeaway && mealId) await markMealTakeaway(userId, mealId);
	const [created] = await db
		.insert(mealPlans)
		.values({
			userId,
			weekContext: params.weekContext ?? isoWeekKeyForDate(params.date),
			date: params.date,
			mealType: params.mealType,
			mealId: mealId ?? null,
			notes: params.notes ?? null,
			servings: params.servings ?? FAMILY_DEFAULT_SERVINGS,
			photoUrl: params.photoUrl ?? null,
			status: params.status ?? 'planned'
		})
		.returning();

	if (created && syncToDay) {
		await syncMealPlanToDayItem(userId, created);
	}
	return created ?? null;
}

/** Tagg en rett som takeaway (idempotent). Fjernes aldri automatisk. */
async function markMealTakeaway(userId: string, mealId: string): Promise<void> {
	const meal = await db.query.meals.findFirst({
		where: and(eq(meals.id, mealId), eq(meals.userId, userId)),
		columns: { tags: true }
	});
	if (!meal || isTakeawayMeal(meal.tags)) return;
	await db
		.update(meals)
		.set({ tags: [...meal.tags, TAKEAWAY_TAG], updatedAt: new Date() })
		.where(and(eq(meals.id, mealId), eq(meals.userId, userId)));
}

/** Slett en meal_plan og dag-punktet som speiler den. */
export async function deleteMealPlan(
	userId: string,
	id: string,
	opts: { syncToDay?: boolean } = {}
): Promise<boolean> {
	const existing = await db.query.mealPlans.findFirst({
		where: and(eq(mealPlans.id, id), eq(mealPlans.userId, userId))
	});
	if (!existing) return false;

	await db.delete(mealPlans).where(and(eq(mealPlans.id, id), eq(mealPlans.userId, userId)));
	if (opts.syncToDay !== false) {
		await removeDayItemForMealPlan(userId, existing);
	}
	return true;
}

/** Hent alle meal_plans for en uke med måltids-titler (delt av API + dashboard). */
export async function getWeekMealPlansWithTitles(userId: string, weekContext: string) {
	const rows = await db
		.select({
			plan: mealPlans,
			mealTitle: meals.title
		})
		.from(mealPlans)
		.leftJoin(meals, eq(mealPlans.mealId, meals.id))
		.where(and(eq(mealPlans.userId, userId), eq(mealPlans.weekContext, weekContext)))
		.orderBy(sql`${mealPlans.date} asc, ${mealPlans.mealType} asc`);

	return rows.map((row) => ({ ...row.plan, mealTitle: row.mealTitle }));
}

/**
 * Planrader i et datovindu med rettens navn og takeaway-merke. Felles leser for
 * `query_food` (plan og historikk) — historikken er de samme radene, lest med
 * status (se meal-log.ts).
 */
export async function getMealPlansWithTitlesInRange(
	userId: string,
	fromDate: string,
	toDate: string,
	opts: { mealType?: string } = {}
) {
	const conditions = [
		eq(mealPlans.userId, userId),
		gte(mealPlans.date, fromDate),
		lte(mealPlans.date, toDate)
	];
	if (opts.mealType) conditions.push(eq(mealPlans.mealType, opts.mealType));
	const rows = await db
		.select({ plan: mealPlans, mealTitle: meals.title, mealTags: meals.tags })
		.from(mealPlans)
		.leftJoin(meals, eq(mealPlans.mealId, meals.id))
		.where(and(...conditions))
		.orderBy(asc(mealPlans.date), asc(mealPlans.mealType));

	return rows.map((row) => ({
		...row.plan,
		status: isMealPlanStatus(row.plan.status) ? row.plan.status : ('planned' as MealPlanStatus),
		mealTitle: row.mealTitle,
		takeaway: isTakeawayMeal(row.mealTags)
	}));
}
