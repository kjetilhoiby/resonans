import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { users } from '$lib/db/schema';
import { sendSalaryReceivedNudge } from '$lib/server/salary-nudge';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, url }) => {
	const userId = locals.userId;

	const user = await db.query.users.findFirst({
		where: eq(users.id, userId)
	});
	if (!user) return json({ error: 'User not found' }, { status: 404 });

	const result = await sendSalaryReceivedNudge(userId, user, url.origin, new Date(), { force: true });
	return json(result);
};
