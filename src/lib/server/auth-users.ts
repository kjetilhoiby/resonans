import { db } from '$lib/db';
import { authAccounts, users } from '$lib/db/schema';
import { normalizeEmail } from '$lib/server/auth-allowlist';
import { and, count, eq } from 'drizzle-orm';

interface SyncGoogleUserParams {
	provider: string;
	providerAccountId: string;
	email: string;
	emailVerified: boolean;
	name?: string | null;
	image?: string | null;
}

interface ExistingGoogleAccessParams {
	provider: string;
	providerAccountId: string;
	email: string;
}

function fallbackName(email: string, name?: string | null) {
	return name?.trim() || email.split('@')[0] || 'Resonans-bruker';
}

export async function hasExistingGoogleAccess(params: ExistingGoogleAccessParams) {
	const normalizedEmail = normalizeEmail(params.email);

	const existingAccount = await db.query.authAccounts.findFirst({
		where: and(
			eq(authAccounts.provider, params.provider),
			eq(authAccounts.providerAccountId, params.providerAccountId)
		)
	});

	if (existingAccount) {
		return true;
	}

	const existingUser = await db.query.users.findFirst({
		where: eq(users.email, normalizedEmail)
	});

	return Boolean(existingUser);
}

export async function canBootstrapFirstAdmin() {
	const [result] = await db.select({ total: count() }).from(authAccounts);
	return (result?.total ?? 0) === 0;
}

export async function syncGoogleUser(params: SyncGoogleUserParams) {
	const normalizedEmail = normalizeEmail(params.email);

	const existingAccount = await db.query.authAccounts.findFirst({
		where: and(
			eq(authAccounts.provider, params.provider),
			eq(authAccounts.providerAccountId, params.providerAccountId)
		)
	});

	if (existingAccount) {
		await db
			.update(authAccounts)
			.set({
				email: normalizedEmail,
				emailVerified: params.emailVerified,
				name: params.name || null,
				image: params.image || null,
				updatedAt: new Date()
			})
			.where(eq(authAccounts.id, existingAccount.id));

		await db
			.update(users)
			.set({
				name: fallbackName(normalizedEmail, params.name),
				email: normalizedEmail,
				updatedAt: new Date()
			})
			.where(eq(users.id, existingAccount.userId));

		const linkedUser = await db.query.users.findFirst({
			where: eq(users.id, existingAccount.userId)
		});

		if (!linkedUser) {
			throw new Error('Auth account points to missing user');
		}

		return linkedUser;
	}

	let user = await db.query.users.findFirst({
		where: eq(users.email, normalizedEmail)
	});
	const bootstrapAdmin = await canBootstrapFirstAdmin();

	if (!user) {
		const [newUser] = await db
			.insert(users)
			.values({
				id: crypto.randomUUID(),
				name: fallbackName(normalizedEmail, params.name),
				email: normalizedEmail,
				isAdmin: bootstrapAdmin
			})
			.returning();
		user = newUser;
	} else if (bootstrapAdmin && !user.isAdmin) {
		const [updatedUser] = await db
			.update(users)
			.set({
				isAdmin: true,
				updatedAt: new Date()
			})
			.where(eq(users.id, user.id))
			.returning();
		user = updatedUser;
	}

	await db.insert(authAccounts).values({
		userId: user.id,
		provider: params.provider,
		providerAccountId: params.providerAccountId,
		email: normalizedEmail,
		emailVerified: params.emailVerified,
		name: params.name || null,
		image: params.image || null
	});

	return user;
}
