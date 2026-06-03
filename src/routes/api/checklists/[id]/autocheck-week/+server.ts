import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { checklists } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { autocheckWeekChecklistItems } from '$lib/server/checklist-autocheck';

/** Mandag (ISO-dato) for en uke-nøkkel som "2026-W23". */
function isoWeekToMonday(weekKey: string): string | null {
	const m = weekKey.match(/(\d{4})-W(\d{2})/);
	if (!m) return null;
	const year = Number(m[1]);
	const week = Number(m[2]);
	// ISO: uke 1 er uka som inneholder 4. januar.
	const jan4 = new Date(Date.UTC(year, 0, 4));
	const jan4Day = jan4.getUTCDay() || 7;
	const week1Monday = new Date(jan4);
	week1Monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1);
	const monday = new Date(week1Monday);
	monday.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
	return monday.toISOString().slice(0, 10);
}

/** Henter uke-checklistens kontekst og utleder en dato i uka. */
async function weekDateForChecklist(userId: string, checklistId: string): Promise<string | null> {
	const checklist = await db.query.checklists.findFirst({
		where: eq(checklists.id, checklistId),
		columns: { context: true, userId: true }
	});
	if (!checklist || checklist.userId !== userId) return null;
	const m = checklist.context?.match(/week:(\d{4}-W\d{2})/);
	if (!m) return null;
	return isoWeekToMonday(m[1]);
}

/**
 * GET /api/checklists/[id]/autocheck-week?baseLabel=Yoga
 * Dry-run: hvor mange slots i gruppa kan hakes av basert på ukas treningsøkter.
 * Brukt til bekreftelsesmodalen ved opprettelse av et uke-aktivitetspunkt.
 */
export const GET: RequestHandler = async ({ locals, params, url }) => {
	const userId = locals.userId;
	if (!userId) return json({ group: null });

	const baseLabel = url.searchParams.get('baseLabel');
	if (!baseLabel) return json({ group: null });

	const date = await weekDateForChecklist(userId, params.id);
	if (!date) return json({ group: null });

	const groups = await autocheckWeekChecklistItems({ userId, date, onlyBaseLabel: baseLabel, dryRun: true });
	return json({ group: groups[0] ?? null });
};

/**
 * POST /api/checklists/[id]/autocheck-week  body: { baseLabel }
 * Utfører auto-hak for aktivitetsgruppa (når brukeren bekrefter modalen).
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Ikke innlogget' }, { status: 401 });

	const body = await request.json().catch(() => ({}));
	const baseLabel = typeof body.baseLabel === 'string' ? body.baseLabel : null;
	if (!baseLabel) return json({ error: 'baseLabel mangler' }, { status: 400 });

	const date = await weekDateForChecklist(userId, params.id);
	if (!date) return json({ error: 'Fant ikke uke-plan' }, { status: 400 });

	const groups = await autocheckWeekChecklistItems({ userId, date, onlyBaseLabel: baseLabel });
	return json({ group: groups[0] ?? null });
};
