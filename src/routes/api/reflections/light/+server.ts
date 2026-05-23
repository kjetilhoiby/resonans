import { json } from '@sveltejs/kit';
import { createReflection } from '$lib/server/reflections';
import { localIsoDay } from '$lib/server/nudge-time';
import { db } from '$lib/db';
import { users } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request }) => {
	const body = await request.json();
	const learned = typeof body?.learned === 'string' ? body.learned.trim() : '';
	const proud = typeof body?.proud === 'string' ? body.proud.trim() : '';

	if (!learned && !proud) {
		return json({ error: 'Tomt innhold' }, { status: 400 });
	}

	const user = await db.query.users.findFirst({ where: eq(users.id, locals.userId) });
	const tz = user?.timezone ?? 'Europe/Oslo';
	const periodKey = localIsoDay(tz, new Date());

	const parts: string[] = [];
	if (learned) parts.push(`Lærte: ${learned}`);
	if (proud) parts.push(`Stolt av: ${proud}`);
	const content = parts.join('\n\n');

	const reflection = await createReflection({
		userId: locals.userId,
		kind: 'reflection_light',
		periodKey,
		content
	});

	return json({ ok: true, id: reflection?.id ?? null });
};
