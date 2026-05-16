import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { procedures, procedureSteps } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

export const GET: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;

	const result = await db.query.procedures.findFirst({
		where: and(eq(procedures.id, params.id), eq(procedures.userId, userId)),
		with: {
			steps: { orderBy: (s, { asc }) => [asc(s.sortOrder)] }
		}
	});

	if (!result) return json({ error: 'Ikke funnet' }, { status: 404 });
	return json(result);
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;
	const body = await request.json();

	const existing = await db.query.procedures.findFirst({
		where: and(eq(procedures.id, params.id), eq(procedures.userId, userId))
	});
	if (!existing) return json({ error: 'Ikke funnet' }, { status: 404 });

	const updates: Record<string, unknown> = { updatedAt: new Date() };
	if (body.title !== undefined) updates.title = body.title;
	if (body.summary !== undefined) updates.summary = body.summary;
	if (body.domain !== undefined) updates.domain = body.domain;
	if (body.themeId !== undefined) updates.themeId = body.themeId;
	if (body.triggerKeywords !== undefined) updates.triggerKeywords = body.triggerKeywords;
	if (body.emoji !== undefined) updates.emoji = body.emoji;
	if (body.shared !== undefined) updates.shared = body.shared;

	if (body.steps !== undefined) {
		updates.version = existing.version + 1;
		await db.delete(procedureSteps).where(eq(procedureSteps.procedureId, params.id));
		if (body.steps.length > 0) {
			await db.insert(procedureSteps).values(
				body.steps.map((text: string, i: number) => ({
					procedureId: params.id,
					text,
					sortOrder: i
				}))
			);
		}
	}

	await db.update(procedures).set(updates).where(eq(procedures.id, params.id));

	const result = await db.query.procedures.findFirst({
		where: eq(procedures.id, params.id),
		with: {
			steps: { orderBy: (s, { asc }) => [asc(s.sortOrder)] }
		}
	});

	return json(result);
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;

	const existing = await db.query.procedures.findFirst({
		where: and(eq(procedures.id, params.id), eq(procedures.userId, userId))
	});
	if (!existing) return json({ error: 'Ikke funnet' }, { status: 404 });

	await db.update(procedures)
		.set({ archivedAt: new Date(), updatedAt: new Date() })
		.where(eq(procedures.id, params.id));

	return json({ success: true });
};
