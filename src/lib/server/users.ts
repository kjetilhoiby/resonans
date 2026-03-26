import { db } from '$lib/db';
import { users } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const DEFAULT_USER_ID = 'default-user';

interface EnsureUserProfile {
	name?: string;
	email?: string;
}

export async function ensureUser(userId: string, profile: EnsureUserProfile = {}) {
	const existingUser = await db.query.users.findFirst({
		where: eq(users.id, userId)
	});

	if (existingUser) {
		return existingUser;
	}

	const safeName = profile.name?.trim() || `Bruker ${userId}`;
	const safeEmail = profile.email?.trim() || null;

	const [newUser] = await db
		.insert(users)
		.values({
			id: userId,
			name: safeName,
			email: safeEmail
		})
		.returning();

	return newUser;
}

export async function ensureDefaultUser() {
	await ensureUser(DEFAULT_USER_ID, {
		name: 'Test Bruker',
		email: 'test@example.com'
	});
}
