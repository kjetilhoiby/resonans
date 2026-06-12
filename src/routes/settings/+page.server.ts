import { db } from '$lib/db';
import { users } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { ensureUser } from '$lib/server/users';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	await ensureUser(locals.userId);

	const user = await db.query.users.findFirst({
		where: eq(users.id, locals.userId)
	});

	return {
		user: user || null
	};
};
