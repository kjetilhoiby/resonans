import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { procedures, procedureSteps, checklistItems } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

export const POST: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;
	const body = await request.json();
	const { checklistId } = body as { checklistId: string };

	if (!checklistId) return json({ error: 'checklistId er påkrevd' }, { status: 400 });

	const procedure = await db.query.procedures.findFirst({
		where: eq(procedures.id, params.id),
		with: {
			steps: { orderBy: (s, { asc }) => [asc(s.sortOrder)] }
		}
	});

	if (!procedure) return json({ error: 'Fremgangsmåte ikke funnet' }, { status: 404 });

	if (procedure.steps.length === 0) {
		return json({ error: 'Fremgangsmåten har ingen trinn' }, { status: 400 });
	}

	const existingItems = await db.query.checklistItems.findMany({
		where: eq(checklistItems.checklistId, checklistId),
		columns: { sortOrder: true }
	});
	const maxSortOrder = existingItems.reduce((max, i) => Math.max(max, i.sortOrder), -1);

	const created = await db.insert(checklistItems).values(
		procedure.steps.map((step, i) => ({
			checklistId,
			userId,
			text: step.text,
			sortOrder: maxSortOrder + 1 + i
		}))
	).returning();

	const currentMeta = procedure.metadata as Record<string, unknown>;
	await db.update(procedures).set({
		metadata: {
			...currentMeta,
			appliedCount: ((currentMeta.appliedCount as number) || 0) + 1
		},
		updatedAt: new Date()
	}).where(eq(procedures.id, params.id));

	return json({ items: created, count: created.length });
};
