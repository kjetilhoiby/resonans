import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PersonService } from '$lib/server/services/person-service';
import { isValidPersonKind } from '$lib/domains/family';

export const GET: RequestHandler = async ({ locals, url }) => {
	const userId = locals.userId;
	const includeArchived = url.searchParams.get('includeArchived') === 'true';
	const list = await PersonService.listForUser(userId, { includeArchived });
	const roleMap = PersonService.computeRoleTokens(list);
	const persons = list.map((p) => ({
		...p,
		// Merge computed role tokens into aliases so MentionAutocomplete can match "kona", "eldste", etc.
		aliases: [...p.aliases, ...(roleMap.get(p.id) ?? [])]
	}));
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
		notes: body.notes ?? null,
		spondGroupIds: Array.isArray(body.spondGroupIds) ? body.spondGroupIds : [],
		emailAddresses: Array.isArray(body.emailAddresses) ? body.emailAddresses : [],
		aliases: Array.isArray(body.aliases) ? body.aliases : []
	});
	return json({ person: created }, { status: 201 });
};
