import { error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { users } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export async function requireAdmin(userId: string) {
	const user = await db.query.users.findFirst({
		where: eq(users.id, userId),
		columns: { id: true, isAdmin: true }
	});

	if (!user?.isAdmin) {
		throw error(403, 'Admin access required');
	}
}
