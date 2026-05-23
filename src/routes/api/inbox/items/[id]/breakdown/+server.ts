import { json } from '@sveltejs/kit';
import { setInboxBreakdown } from '$lib/server/inbox';
import type { RequestHandler } from './$types';

export const PUT: RequestHandler = async ({ locals, params, request }) => {
	const itemId = params.id;
	if (!itemId) return json({ error: 'id mangler' }, { status: 400 });

	const body = await request.json();
	const rawSubItems = Array.isArray(body?.subItems) ? body.subItems : [];
	const texts = rawSubItems
		.filter((t: unknown): t is string => typeof t === 'string')
		.map((t: string) => t.trim())
		.filter((t: string) => t.length > 0);

	const subItems = await setInboxBreakdown(locals.userId, itemId, texts);
	return json({ ok: true, subItems });
};
