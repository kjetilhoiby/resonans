import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { users } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { localIsoDay } from '$lib/server/nudge-time';
import { loadOpenChecklistItems } from '$lib/server/checklist-open-items';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	const user = await db.query.users.findFirst({ where: eq(users.id, locals.userId) });
	const tz = user?.timezone ?? 'Europe/Oslo';
	const today = localIsoDay(tz, new Date());
	const limit = Number(url.searchParams.get('limit') ?? '20');

	const items = await loadOpenChecklistItems(locals.userId, today, limit);
	return json({ items });
};
