import { db } from '$lib/db';
import { users } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const DEFAULT_USER_ID = 'default-user';

export async function ensureDefaultUser() {
	const existingUser = await db.query.users.findFirst({
		where: eq(users.id, DEFAULT_USER_ID)
	});

	if (!existingUser) {
		await db.insert(users).values({
			id: DEFAULT_USER_ID,
			name: 'Test Bruker',
			email: 'test@example.com'
		});
	}
}
