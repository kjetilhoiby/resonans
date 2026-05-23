import { json } from '@sveltejs/kit';
import { addInboxItems, listInboxItems } from '$lib/server/inbox';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request }) => {
	const body = await request.json();
	const rawItems = Array.isArray(body?.items) ? body.items : [];
	const texts = rawItems
		.filter((t: unknown): t is string => typeof t === 'string')
		.map((t: string) => t.trim())
		.filter((t: string) => t.length > 0);

	if (texts.length === 0) {
		return json({ error: 'Ingen items å lagre' }, { status: 400 });
	}

	const ids = await addInboxItems(locals.userId, texts);
	return json({ ok: true, ids, count: ids.length });
};

export const GET: RequestHandler = async ({ locals }) => {
	const items = await listInboxItems(locals.userId);
	return json({ items });
};
