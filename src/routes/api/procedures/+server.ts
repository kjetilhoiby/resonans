import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { procedures, procedureSteps, users } from '$lib/db/schema';
import { eq, and, isNull, or } from 'drizzle-orm';

export const GET: RequestHandler = async ({ locals, url }) => {
	const userId = locals.userId;
	const domain = url.searchParams.get('domain');
	const includeShared = url.searchParams.get('shared') === 'true';

	const conditions = [eq(procedures.userId, userId), isNull(procedures.archivedAt)];

	if (domain) {
		conditions.push(eq(procedures.domain, domain));
	}

	let rows = await db.query.procedures.findMany({
		where: and(...conditions),
		with: {
			steps: {
				orderBy: (s, { asc }) => [asc(s.sortOrder)]
			}
		},
		orderBy: (p, { desc }) => [desc(p.updatedAt)]
	});

	if (includeShared) {
		const [user] = await db
			.select({ partnerUserId: users.partnerUserId })
			.from(users)
			.where(eq(users.id, userId))
			.limit(1);

		if (user?.partnerUserId) {
			const partnerConditions = [
				eq(procedures.userId, user.partnerUserId),
				eq(procedures.shared, true),
				isNull(procedures.archivedAt)
			];
			if (domain) partnerConditions.push(eq(procedures.domain, domain));

			const partnerRows = await db.query.procedures.findMany({
				where: and(...partnerConditions),
				with: {
					steps: { orderBy: (s, { asc }) => [asc(s.sortOrder)] }
				},
				orderBy: (p, { desc }) => [desc(p.updatedAt)]
			});
			rows = [...rows, ...partnerRows];
		}
	}

	return json(rows);
};

export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	const body = await request.json();

	const {
		title, summary, domain, themeId, conversationId,
		triggerKeywords = [], emoji, shared = false, steps = []
	} = body as {
		title: string;
		summary?: string;
		domain?: string;
		themeId?: string;
		conversationId?: string;
		triggerKeywords?: string[];
		emoji?: string;
		shared?: boolean;
		steps?: string[];
	};

	if (!title || typeof title !== 'string') {
		return json({ error: 'title er påkrevd' }, { status: 400 });
	}

	const [procedure] = await db.insert(procedures).values({
		userId,
		title,
		summary: summary ?? null,
		domain: domain ?? null,
		themeId: themeId ?? null,
		conversationId: conversationId ?? null,
		triggerKeywords,
		emoji: emoji ?? null,
		shared
	}).returning();

	if (steps.length > 0) {
		await db.insert(procedureSteps).values(
			steps.map((text, i) => ({
				procedureId: procedure.id,
				text,
				sortOrder: i
			}))
		);
	}

	const result = await db.query.procedures.findFirst({
		where: eq(procedures.id, procedure.id),
		with: {
			steps: { orderBy: (s, { asc }) => [asc(s.sortOrder)] }
		}
	});

	return json(result, { status: 201 });
};
