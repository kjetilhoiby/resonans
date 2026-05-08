import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { conversations } from '$lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { PersonService } from '$lib/server/services/person-service';

export const GET: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;
	const person = await PersonService.getById(params.id, userId);
	if (!person) return json({ error: 'Person ikke funnet' }, { status: 404 });

	const list = await db
		.select()
		.from(conversations)
		.where(and(eq(conversations.userId, userId), eq(conversations.personId, params.id)))
		.orderBy(desc(conversations.updatedAt));
	return json({ conversations: list });
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;
	const person = await PersonService.getById(params.id, userId);
	if (!person) return json({ error: 'Person ikke funnet' }, { status: 404 });

	const body = await request.json().catch(() => ({}));
	const title: string = body.title ?? `Om ${person.name}`;
	const themeId: string | null = body.themeId ?? null;

	const [created] = await db
		.insert(conversations)
		.values({
			userId,
			personId: params.id,
			themeId,
			title
		})
		.returning();
	return json({ conversation: created }, { status: 201 });
};
