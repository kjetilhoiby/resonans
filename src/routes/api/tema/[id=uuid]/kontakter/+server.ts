import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { projectContacts } from '$lib/db/schema';
import { and, eq, asc, sql } from 'drizzle-orm';
import { requireTheme } from '$lib/server/project-tasks';
import { mapContact, isContactStatus, normalizeIsoDate } from '$lib/server/project-contacts';

export const GET: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;
	await requireTheme(userId, params.id);

	const rows = await db
		.select()
		.from(projectContacts)
		.where(and(eq(projectContacts.themeId, params.id), eq(projectContacts.userId, userId)))
		.orderBy(asc(projectContacts.sortOrder), asc(projectContacts.createdAt));

	return json({ contacts: rows.map(mapContact) });
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;
	await requireTheme(userId, params.id);

	const body = await request.json().catch(() => null);
	const name = typeof body?.name === 'string' ? body.name.trim() : '';
	if (!name) throw error(400, 'Mangler navn');

	const [{ maxOrder }] = await db
		.select({ maxOrder: sql<number>`coalesce(max(${projectContacts.sortOrder}), -1)` })
		.from(projectContacts)
		.where(and(eq(projectContacts.themeId, params.id), eq(projectContacts.userId, userId)));

	const [created] = await db
		.insert(projectContacts)
		.values({
			userId,
			themeId: params.id,
			name: name.slice(0, 120),
			role: typeof body?.role === 'string' && body.role.trim() ? body.role.trim().slice(0, 80) : null,
			phone: typeof body?.phone === 'string' && body.phone.trim() ? body.phone.trim().slice(0, 40) : null,
			email: typeof body?.email === 'string' && body.email.trim() ? body.email.trim().slice(0, 160) : null,
			status: isContactStatus(body?.status) ? body.status : 'todo',
			notes: typeof body?.notes === 'string' && body.notes.trim() ? body.notes.trim() : null,
			followUpAt: normalizeIsoDate(body?.followUpAt),
			sortOrder: (maxOrder ?? -1) + 1
		})
		.returning();

	return json({ contact: mapContact(created) });
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;
	await requireTheme(userId, params.id);

	const body = await request.json().catch(() => null);
	const contactId = typeof body?.contactId === 'string' ? body.contactId : '';
	if (!contactId) throw error(400, 'Mangler contactId');

	const existing = await db.query.projectContacts.findFirst({
		where: and(
			eq(projectContacts.id, contactId),
			eq(projectContacts.themeId, params.id),
			eq(projectContacts.userId, userId)
		)
	});
	if (!existing) throw error(404, 'Kontakt ikke funnet');

	const update: Partial<typeof projectContacts.$inferInsert> = {};
	if (typeof body.name === 'string' && body.name.trim()) update.name = body.name.trim().slice(0, 120);
	if ('role' in body) update.role = typeof body.role === 'string' && body.role.trim() ? body.role.trim().slice(0, 80) : null;
	if ('phone' in body) update.phone = typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim().slice(0, 40) : null;
	if ('email' in body) update.email = typeof body.email === 'string' && body.email.trim() ? body.email.trim().slice(0, 160) : null;
	if ('notes' in body) update.notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;
	if ('followUpAt' in body) update.followUpAt = normalizeIsoDate(body.followUpAt);
	if (isContactStatus(body.status)) {
		update.status = body.status;
		// Å markere som kontaktet/ferdig teller som en kontakt-hendelse.
		if (body.status !== 'todo') update.lastContactedAt = new Date();
	}
	if (Number.isInteger(body.sortOrder)) update.sortOrder = body.sortOrder;
	if (body.markContacted === true) update.lastContactedAt = new Date();

	if (Object.keys(update).length === 0) return json({ contact: mapContact(existing) });
	update.updatedAt = new Date();

	const [updated] = await db
		.update(projectContacts)
		.set(update)
		.where(eq(projectContacts.id, contactId))
		.returning();

	return json({ contact: mapContact(updated) });
};

export const DELETE: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;
	await requireTheme(userId, params.id);

	const body = await request.json().catch(() => null);
	const contactId = typeof body?.contactId === 'string' ? body.contactId : '';
	if (!contactId) throw error(400, 'Mangler contactId');

	await db
		.delete(projectContacts)
		.where(
			and(
				eq(projectContacts.id, contactId),
				eq(projectContacts.themeId, params.id),
				eq(projectContacts.userId, userId)
			)
		);

	return json({ ok: true });
};
