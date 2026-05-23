import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { users } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { snoozeUntil, upsertSnooze, clearSnooze, type SnoozeScope } from '$lib/server/action-snoozes';
import type { RequestHandler } from './$types';

const VALID_SCOPES: SnoozeScope[] = ['today', 'week', 'forever'];

export const POST: RequestHandler = async ({ locals, request }) => {
	const body = await request.json();
	const chipId = typeof body?.chipId === 'string' ? body.chipId.trim() : '';
	const scope = body?.scope as SnoozeScope | undefined;

	if (!chipId) return json({ error: 'chipId mangler' }, { status: 400 });
	if (!scope || !VALID_SCOPES.includes(scope)) {
		return json({ error: 'scope må være today|week|forever' }, { status: 400 });
	}

	const user = await db.query.users.findFirst({ where: eq(users.id, locals.userId) });
	const tz = user?.timezone ?? 'Europe/Oslo';
	const until = snoozeUntil(scope, tz, new Date());

	await upsertSnooze(locals.userId, chipId, until);
	return json({ ok: true, until: until.toISOString() });
};

export const DELETE: RequestHandler = async ({ locals, request }) => {
	const body = await request.json().catch(() => ({}));
	const chipId = typeof body?.chipId === 'string' ? body.chipId.trim() : '';
	if (!chipId) return json({ error: 'chipId mangler' }, { status: 400 });

	await clearSnooze(locals.userId, chipId);
	return json({ ok: true });
};
