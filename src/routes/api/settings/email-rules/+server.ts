import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { emailRules } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ locals, url }) => {
	const themeId = url.searchParams.get('themeId');
	const rules = await db.query.emailRules.findMany({
		where: themeId
			? and(eq(emailRules.userId, locals.userId), eq(emailRules.themeId, themeId))
			: eq(emailRules.userId, locals.userId),
		orderBy: (r, { desc }) => [desc(r.createdAt)]
	});
	return json(rules);
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await request.json() as {
		name: string;
		labelPattern?: string;
		senderPattern?: string;
		subjectPattern?: string;
		processingType: string;
		themeId?: string | null;
		extractionPrompt?: string;
		eventType?: string;
		dataType?: string;
	};

	if (!body.name?.trim()) {
		return json({ error: 'Navn er påkrevd' }, { status: 400 });
	}
	if (!body.processingType) {
		return json({ error: 'Prosesseringstype er påkrevd' }, { status: 400 });
	}

	const [rule] = await db.insert(emailRules).values({
		userId: locals.userId,
		name: body.name.trim(),
		labelPattern: body.labelPattern?.trim() || null,
		senderPattern: body.senderPattern?.trim() || null,
		subjectPattern: body.subjectPattern?.trim() || null,
		processingType: body.processingType,
		themeId: body.themeId || null,
		extractionPrompt: body.extractionPrompt?.trim() || null,
		eventType: body.eventType || 'email_content',
		dataType: body.dataType || 'email',
	}).returning();

	return json(rule, { status: 201 });
};

export const PATCH: RequestHandler = async ({ request, locals }) => {
	const body = await request.json() as {
		id: string;
		name?: string;
		labelPattern?: string | null;
		senderPattern?: string | null;
		subjectPattern?: string | null;
		processingType?: string;
		themeId?: string | null;
		extractionPrompt?: string | null;
		eventType?: string;
		dataType?: string;
		isActive?: boolean;
	};

	if (!body.id) {
		return json({ error: 'ID er påkrevd' }, { status: 400 });
	}

	const updates: Record<string, any> = { updatedAt: new Date() };
	if (body.name !== undefined) updates.name = body.name.trim();
	if (body.labelPattern !== undefined) updates.labelPattern = body.labelPattern?.trim() || null;
	if (body.senderPattern !== undefined) updates.senderPattern = body.senderPattern?.trim() || null;
	if (body.subjectPattern !== undefined) updates.subjectPattern = body.subjectPattern?.trim() || null;
	if (body.processingType !== undefined) updates.processingType = body.processingType;
	if (body.themeId !== undefined) updates.themeId = body.themeId || null;
	if (body.extractionPrompt !== undefined) updates.extractionPrompt = body.extractionPrompt?.trim() || null;
	if (body.eventType !== undefined) updates.eventType = body.eventType;
	if (body.dataType !== undefined) updates.dataType = body.dataType;
	if (body.isActive !== undefined) updates.isActive = body.isActive;

	const [updated] = await db.update(emailRules)
		.set(updates)
		.where(and(eq(emailRules.id, body.id), eq(emailRules.userId, locals.userId)))
		.returning();

	if (!updated) {
		return json({ error: 'Regel ikke funnet' }, { status: 404 });
	}

	return json(updated);
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	const body = await request.json() as { id: string };

	if (!body.id) {
		return json({ error: 'ID er påkrevd' }, { status: 400 });
	}

	const [deleted] = await db.delete(emailRules)
		.where(and(eq(emailRules.id, body.id), eq(emailRules.userId, locals.userId)))
		.returning();

	if (!deleted) {
		return json({ error: 'Regel ikke funnet' }, { status: 404 });
	}

	return json({ success: true });
};
