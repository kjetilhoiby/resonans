import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { checklistItems, checklists } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import {
	autocheckChecklistItemsForDay,
	findMatchingWorkoutForItem
} from '$lib/server/checklist-autocheck';
import type { ActivityType } from '$lib/server/task-intent-parser';

/** Henter dag-datoen fra en sjekkliste-kontekst, f.eks. "week:2026-W23:day:2026-06-03" → "2026-06-03". */
function dayFromContext(context: string | null): string | null {
	const m = context?.match(/:day:(\d{4}-\d{2}-\d{2})/);
	return m ? m[1] : null;
}

/** Laster punktet + dets sjekkliste-kontekst, og henter ut activity-metadata + dag. */
async function loadItemContext(userId: string, itemId: string) {
	const item = await db.query.checklistItems.findFirst({
		where: and(eq(checklistItems.id, itemId), eq(checklistItems.userId, userId))
	});
	if (!item) return null;

	const checklist = await db.query.checklists.findFirst({
		where: eq(checklists.id, item.checklistId),
		columns: { context: true }
	});
	const date = dayFromContext(checklist?.context ?? null);
	const meta = (item.metadata ?? {}) as Record<string, unknown>;
	const activityType =
		typeof meta.activityType === 'string' ? (meta.activityType as ActivityType) : null;

	return { item, date, meta, activityType };
}

/**
 * GET /api/checklists/[id]/items/[itemId]/autocheck
 * Dry-run: returnerer en matchende treningsøkt samme dag (om noen), uten å
 * hake av. Brukes til bekreftelsesmodalen ved opprettelse av et dag-punkt.
 */
export const GET: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;
	if (!userId) return json({ match: null });

	const ctx = await loadItemContext(userId, params.itemId);
	if (!ctx) return json({ error: 'Ikke funnet' }, { status: 404 });

	const { item, date, meta, activityType } = ctx;
	if (item.checked || !date || !activityType) return json({ match: null });

	const match = await findMatchingWorkoutForItem({
		userId,
		date,
		activityType,
		targetDurationMin: typeof meta.durationMinutes === 'number' ? meta.durationMinutes : null,
		targetDistanceKm: typeof meta.distanceKm === 'number' ? meta.distanceKm : null
	});

	return json({ match, itemText: item.text, activityType });
};

/**
 * POST /api/checklists/[id]/items/[itemId]/autocheck
 * Utfører faktisk auto-hak for KUN dette punktet (kjører samme logikk som
 * dag-autocheck, inkl. progress-logging mot koblet oppgave). Kalt når brukeren
 * bekrefter modalen.
 */
export const POST: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Ikke innlogget' }, { status: 401 });

	const ctx = await loadItemContext(userId, params.itemId);
	if (!ctx) return json({ error: 'Ikke funnet' }, { status: 404 });

	const { date } = ctx;
	if (!date) return json({ error: 'Punktet hører ikke til en dag-plan' }, { status: 400 });

	const results = await autocheckChecklistItemsForDay({ userId, date, itemId: params.itemId });
	const result = results.find((r) => r.itemId === params.itemId) ?? null;

	return json({ result, checked: !!result?.autoChecked });
};
