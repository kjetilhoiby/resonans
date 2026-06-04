import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PersonService } from '$lib/server/services/person-service';
import { isValidPersonKind } from '$lib/domains/family';
import { db } from '$lib/db';
import { users } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ locals, url }) => {
	const userId = locals.userId;
	const includeArchived = url.searchParams.get('includeArchived') === 'true';
	const list = await PersonService.listForUser(userId, { includeArchived });
	const roleMap = PersonService.computeRoleTokens(list);
	const persons = list.map((p) => ({
		...p,
		aliases: [...p.aliases, ...(roleMap.get(p.id) ?? [])]
	}));

	if (!persons.some((p) => p.kind === 'self')) {
		const user = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).then(r => r[0]);
		if (user) {
			persons.unshift({
				id: `self-${userId}`,
				userId,
				name: user.name,
				fullName: null,
				nickname: null,
				birthDate: null,
				kind: 'self',
				avatarEmoji: '🙂',
				photoUrl: null,
				notes: null,
				spondGroupIds: [],
				emailAddresses: [],
				aliases: [],
				archived: false,
				createdAt: new Date(),
				updatedAt: new Date()
			} as (typeof persons)[number]);
		}
	}

	return json({ persons });
};

export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	const body = await request.json();
	if (!body.name || typeof body.name !== 'string') {
		return json({ error: 'name is required' }, { status: 400 });
	}
	const kind = body.kind && isValidPersonKind(body.kind) ? body.kind : 'other';
	const created = await PersonService.create({
		userId,
		name: body.name,
		fullName: body.fullName ?? null,
		nickname: body.nickname ?? null,
		birthDate: body.birthDate ?? null,
		kind,
		avatarEmoji: body.avatarEmoji ?? null,
		photoUrl: body.photoUrl ?? null,
		notes: body.notes ?? null,
		spondGroupIds: Array.isArray(body.spondGroupIds) ? body.spondGroupIds : [],
		emailAddresses: Array.isArray(body.emailAddresses) ? body.emailAddresses : [],
		aliases: Array.isArray(body.aliases) ? body.aliases : []
	});
	return json({ person: created }, { status: 201 });
};
