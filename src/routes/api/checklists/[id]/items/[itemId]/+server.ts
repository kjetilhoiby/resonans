import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteChecklistItem, updateChecklistItem } from '$lib/server/checklist-item-mutations';

// Logikken bor i `$lib/server/checklist-item-mutations.ts`, delt med MCP-verktøyet
// `manage_plan_item`, så avkryssing gir samme bivirkninger fra appen og fra ChatGPT.

// PATCH /api/checklists/[id]/items/[itemId] — toggle checked / endre tekst
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const body = await request.json() as { checked?: boolean; text?: string; sortOrder?: number; skipped?: boolean };
	const updated = await updateChecklistItem(locals.userId, params.itemId, body);
	if (!updated) return json({ error: 'Ikke funnet' }, { status: 404 });
	return json(updated);
};

// DELETE /api/checklists/[id]/items/[itemId]
export const DELETE: RequestHandler = async ({ locals, params }) => {
	const deleted = await deleteChecklistItem(locals.userId, params.itemId);
	if (!deleted) return json({ error: 'Ikke funnet' }, { status: 404 });
	return json({ ok: true });
};
