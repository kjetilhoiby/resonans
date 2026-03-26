import { db } from '$lib/db';
import { allowedEmails } from '$lib/db/schema';
import { getAllowedEmailsFromEnv } from '$lib/server/auth-config';
import { eq } from 'drizzle-orm';

export function normalizeEmail(email: string) {
	return email.trim().toLowerCase();
}

export async function isEmailAllowed(email: string) {
	const normalizedEmail = normalizeEmail(email);
	const envAllowedEmails = getAllowedEmailsFromEnv();

	if (envAllowedEmails.includes(normalizedEmail)) {
		return true;
	}

	const allowedEmail = await db.query.allowedEmails.findFirst({
		where: eq(allowedEmails.email, normalizedEmail)
	});

	return Boolean(allowedEmail);
}

export async function touchAllowedEmail(email: string) {
	const normalizedEmail = normalizeEmail(email);

	await db
		.update(allowedEmails)
		.set({ lastUsedAt: new Date() })
		.where(eq(allowedEmails.email, normalizedEmail));
}
