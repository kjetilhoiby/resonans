import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { persons, users } from '$lib/db/schema';
import { PersonService } from '$lib/server/services/person-service';
import type { RequestHandler } from './$types';

/**
 * Setter fødselsdato på self-personen (kilden for årskavalkaden og
 * selvangivelse-fristen). Oppretter self-personen hvis den ikke finnes —
 * /api/persons syntetiserer bare en virtuell en som ikke kan lagres.
 */
export const PUT: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	const body = await request.json();
	const birthDate = body?.birthDate ?? null;

	if (birthDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
		return json({ error: 'Ugyldig dato — bruk YYYY-MM-DD' }, { status: 400 });
	}

	const self = await db.query.persons.findFirst({
		where: and(eq(persons.userId, userId), eq(persons.kind, 'self'), eq(persons.archived, false))
	});

	if (self) {
		await PersonService.update(self.id, userId, { birthDate });
	} else {
		const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
		await PersonService.create({
			userId,
			name: user?.name ?? 'Meg',
			kind: 'self',
			birthDate,
			avatarEmoji: '🙂'
		});
	}

	return json({ ok: true, birthDate });
};
