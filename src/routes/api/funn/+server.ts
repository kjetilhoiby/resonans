import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { finds } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { FIND_DOMAINS } from '$lib/server/email-processors/find-triage';

const STATUSES = ['inbox', 'kept', 'discarded'] as const;
type FindStatus = (typeof STATUSES)[number];

function serialize(row: typeof finds.$inferSelect) {
	return {
		id: row.id,
		title: row.title,
		summary: row.summary,
		domain: row.domain,
		kind: row.kind,
		sourceUrl: row.sourceUrl,
		thumbnailUrl: row.thumbnailUrl,
		status: row.status,
		mealId: row.mealId,
		emailFrom: row.emailFrom,
		createdAt: row.createdAt.toISOString()
	};
}

export const GET: RequestHandler = async ({ locals, url }) => {
	const statusParam = url.searchParams.get('status');
	const domainParam = url.searchParams.get('domain');
	const conds = [eq(finds.userId, locals.userId)];
	if (statusParam && (STATUSES as readonly string[]).includes(statusParam)) {
		conds.push(eq(finds.status, statusParam));
	}
	if (domainParam && (FIND_DOMAINS as readonly string[]).includes(domainParam)) {
		conds.push(eq(finds.domain, domainParam));
	}

	const rows = await db.query.finds.findMany({
		where: and(...conds),
		orderBy: (f, { desc }) => [desc(f.createdAt)],
		limit: 300
	});

	return json(rows.map(serialize));
};

export const PATCH: RequestHandler = async ({ request, locals }) => {
	const body = (await request.json()) as { id: string; status?: string; domain?: string };
	if (!body.id) {
		return json({ error: 'ID er påkrevd' }, { status: 400 });
	}

	const updates: Record<string, unknown> = { updatedAt: new Date() };
	if (body.status !== undefined) {
		if (!(STATUSES as readonly string[]).includes(body.status)) {
			return json({ error: 'Ugyldig status' }, { status: 400 });
		}
		updates.status = body.status as FindStatus;
	}
	if (body.domain !== undefined) {
		if (!(FIND_DOMAINS as readonly string[]).includes(body.domain)) {
			return json({ error: 'Ugyldig domene' }, { status: 400 });
		}
		updates.domain = body.domain;
	}

	const [updated] = await db
		.update(finds)
		.set(updates)
		.where(and(eq(finds.id, body.id), eq(finds.userId, locals.userId)))
		.returning();

	if (!updated) {
		return json({ error: 'Funn ikke funnet' }, { status: 404 });
	}

	return json(serialize(updated));
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	const body = (await request.json()) as { id: string };
	if (!body.id) {
		return json({ error: 'ID er påkrevd' }, { status: 400 });
	}

	const [deleted] = await db
		.delete(finds)
		.where(and(eq(finds.id, body.id), eq(finds.userId, locals.userId)))
		.returning();

	if (!deleted) {
		return json({ error: 'Funn ikke funnet' }, { status: 404 });
	}

	return json({ success: true });
};
