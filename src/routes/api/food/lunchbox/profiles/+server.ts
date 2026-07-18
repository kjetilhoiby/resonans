import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { lunchboxProfiles } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';

// PATCH /api/food/lunchbox/profiles — oppdater et barns matpakke-preferanser
export const PATCH: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	const body = await request.json();

	if (!body.personId) return json({ error: 'personId required' }, { status: 400 });

	const updates: Record<string, unknown> = { updatedAt: new Date() };
	for (const key of ['likes', 'dislikes', 'allergies'] as const) {
		if (Array.isArray(body[key])) {
			updates[key] = body[key].map((v: string) => String(v).trim()).filter(Boolean);
		}
	}
	if (body.appetite === 'liten' || body.appetite === 'middels' || body.appetite === 'stor') {
		updates.appetite = body.appetite;
	}
	if ('notes' in body) updates.notes = body.notes ? String(body.notes) : null;

	const [updated] = await db
		.update(lunchboxProfiles)
		.set(updates)
		.where(and(eq(lunchboxProfiles.userId, userId), eq(lunchboxProfiles.personId, body.personId)))
		.returning();

	if (updated) return json({ profile: updated });

	const [created] = await db
		.insert(lunchboxProfiles)
		.values({
			userId,
			personId: body.personId,
			likes: (updates.likes as string[]) ?? [],
			dislikes: (updates.dislikes as string[]) ?? [],
			allergies: (updates.allergies as string[]) ?? [],
			appetite: (updates.appetite as string) ?? 'middels',
			notes: (updates.notes as string | null) ?? null
		})
		.returning();
	return json({ profile: created }, { status: 201 });
};
