import { db } from '$lib/db';
import { themes } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ request, locals }) => {
	const body = await request.json();
	if (!Array.isArray(body)) throw error(400, 'Expected array of {id, sortOrder}');

	await Promise.all(
		body.map(({ id, sortOrder }: { id: string; sortOrder: number }) =>
			db
				.update(themes)
				.set({ sortOrder })
				.where(and(eq(themes.id, id), eq(themes.userId, locals.userId)))
		)
	);

	return json({ ok: true });
};
