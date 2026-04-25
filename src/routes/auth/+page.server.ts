import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';
import { db } from '$lib/db';
import { users } from '$lib/db/schema';
import {
	isPreviewEnv,
	PREVIEW_BYPASS_PASSWORD,
	PREVIEW_AUTH_COOKIE,
	signPreviewToken
} from '$lib/server/preview-auth';

const ERROR_MESSAGES: Record<string, string> = {
	InviteOnly: 'Denne appen er invite-only. Kontoen din er ikke gitt tilgang ennå.',
	EmailNotVerified: 'Google-kontoen må ha en verifisert e-postadresse.',
	AuthNotConfigured: 'Google-innlogging er ikke konfigurert i miljøet ennå.',
	AccessDenied: 'Innloggingen ble avvist.'
};

function sanitizeNextPath(value: string | null) {
	if (!value || !value.startsWith('/')) {
		return '/';
	}
	return value;
}

export const load: PageServerLoad = async (event) => {
	const session = await event.locals.auth();
	const next = sanitizeNextPath(event.url.searchParams.get('next'));

	if (session?.user) {
		throw redirect(303, next);
	}

	// If already has a valid preview bypass cookie, redirect immediately
	if (isPreviewEnv()) {
		const { verifyPreviewToken } = await import('$lib/server/preview-auth');
		const token = event.cookies.get(PREVIEW_AUTH_COOKIE);
		if (token && verifyPreviewToken(token, env.AUTH_SECRET)) {
			throw redirect(303, next);
		}
	}

	const error = event.url.searchParams.get('error');

	return {
		next,
		isPreview: isPreviewEnv(),
		errorMessage: error ? (ERROR_MESSAGES[error] || 'Innloggingen mislyktes.') : null
	};
};

export const actions: Actions = {
	previewLogin: async (event) => {
		if (!isPreviewEnv()) {
			return fail(403, { previewError: 'Ikke tilgjengelig.' });
		}

		const data = await event.request.formData();
		const password = String(data.get('password') ?? '');
		const next = sanitizeNextPath(String(data.get('next') ?? ''));

		if (password !== PREVIEW_BYPASS_PASSWORD) {
			return fail(401, { previewError: 'Feil passord.' });
		}

		const adminUser = await db.query.users.findFirst({
			where: eq(users.isAdmin, true),
			columns: { id: true }
		});

		if (!adminUser) {
			return fail(500, { previewError: 'Ingen admin-bruker funnet i databasen.' });
		}

		const token = signPreviewToken(adminUser.id, env.AUTH_SECRET);
		event.cookies.set(PREVIEW_AUTH_COOKIE, token, {
			path: '/',
			httpOnly: true,
			secure: true,
			sameSite: 'strict',
			maxAge: 8 * 60 * 60
		});

		throw redirect(303, next);
	}
};
