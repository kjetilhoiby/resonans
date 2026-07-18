import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { lunchboxComponents } from '$lib/db/schema';
import { and, asc, eq, ilike } from 'drizzle-orm';
import { escapeLike } from '$lib/utils/like-escape';

const VALID_KINDS = ['palegg', 'brod', 'frukt', 'gront', 'notter', 'annet'];

// GET /api/food/lunchbox/components — komponentbiblioteket (pålegg, frukt, …)
export const GET: RequestHandler = async ({ url, locals }) => {
	const userId = locals.userId;
	const includeInactive = url.searchParams.get('all') === '1';
	const conditions = [eq(lunchboxComponents.userId, userId)];
	if (!includeInactive) conditions.push(eq(lunchboxComponents.active, true));

	const rows = await db
		.select()
		.from(lunchboxComponents)
		.where(and(...conditions))
		.orderBy(asc(lunchboxComponents.kind), asc(lunchboxComponents.name));
	return json({ components: rows });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	const body = await request.json();

	const name = String(body.name ?? '').trim();
	const kind = String(body.kind ?? '').trim();
	if (!name) return json({ error: 'name required' }, { status: 400 });
	if (!VALID_KINDS.includes(kind)) {
		return json({ error: `kind must be one of ${VALID_KINDS.join(', ')}` }, { status: 400 });
	}

	// Manuell dedup mot unik-indeksen på (user_id, lower(name)) — gjenoppliv
	// deaktiverte komponenter i stedet for å feile.
	const existing = await db
		.select()
		.from(lunchboxComponents)
		.where(and(eq(lunchboxComponents.userId, userId), ilike(lunchboxComponents.name, escapeLike(name))))
		.limit(1);

	if (existing.length > 0) {
		const [revived] = await db
			.update(lunchboxComponents)
			.set({ active: true, kind, updatedAt: new Date() })
			.where(eq(lunchboxComponents.id, existing[0].id))
			.returning();
		return json({ component: revived });
	}

	const [created] = await db
		.insert(lunchboxComponents)
		.values({
			userId,
			name,
			kind,
			tags: Array.isArray(body.tags) ? body.tags.map((t: string) => String(t).trim()).filter(Boolean) : []
		})
		.returning();
	return json({ component: created }, { status: 201 });
};

export const PATCH: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	const body = await request.json();
	if (!body.id) return json({ error: 'id required' }, { status: 400 });

	const updates: Record<string, unknown> = { updatedAt: new Date() };
	if (typeof body.name === 'string' && body.name.trim()) updates.name = body.name.trim();
	if (VALID_KINDS.includes(body.kind)) updates.kind = body.kind;
	if (Array.isArray(body.tags)) updates.tags = body.tags;
	if (typeof body.active === 'boolean') updates.active = body.active;

	const [updated] = await db
		.update(lunchboxComponents)
		.set(updates)
		.where(and(eq(lunchboxComponents.id, body.id), eq(lunchboxComponents.userId, userId)))
		.returning();
	if (!updated) return json({ error: 'Not found' }, { status: 404 });
	return json({ component: updated });
};

// DELETE — myk sletting (active=false) så historikk og retur-lenker består
export const DELETE: RequestHandler = async ({ url, locals }) => {
	const userId = locals.userId;
	const id = url.searchParams.get('id');
	if (!id) return json({ error: 'id required' }, { status: 400 });

	const [updated] = await db
		.update(lunchboxComponents)
		.set({ active: false, updatedAt: new Date() })
		.where(and(eq(lunchboxComponents.id, id), eq(lunchboxComponents.userId, userId)))
		.returning();
	if (!updated) return json({ error: 'Not found' }, { status: 404 });
	return json({ deleted: true });
};
