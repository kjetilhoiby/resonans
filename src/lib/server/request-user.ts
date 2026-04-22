import type { RequestEvent } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';
import { DEFAULT_USER_ID, ensureUser } from '$lib/server/users';
import { isGoogleAuthConfigured } from '$lib/server/auth-config';
import { resolveApiSecretAuthFromRequest } from '$lib/server/api-secrets';

export const USER_ID_HEADER_NAME = 'x-resonans-user-id';
export const USER_ID_QUERY_PARAM = 'userId';
export const USER_ID_COOKIE_NAME = 'resonans_user_id';

const USER_ID_PATTERN = /^[a-zA-Z0-9._-]{3,100}$/;

function sanitizeUserId(value: string | null | undefined): string | null {
	if (!value) {
		return null;
	}

	const trimmed = value.trim();
	if (!trimmed || !USER_ID_PATTERN.test(trimmed)) {
		return null;
	}

	return trimmed;
}

export async function resolveRequestUserId(event: RequestEvent): Promise<string> {
	if (event.url.pathname.startsWith('/api/')) {
		const apiSecretAuth = event.locals.apiSecretAuth ?? await resolveApiSecretAuthFromRequest(event.request);
		if (apiSecretAuth?.userId) {
			event.locals.apiSecretAuth = apiSecretAuth;
			return apiSecretAuth.userId;
		}
	}

	if (typeof event.locals.auth === 'function') {
		const session = await event.locals.auth();
		const authenticatedUserId = sanitizeUserId(session?.user?.id);

		if (authenticatedUserId) {
			return authenticatedUserId;
		}
	}

	const userIdFromHeader = sanitizeUserId(event.request.headers.get(USER_ID_HEADER_NAME));
	const userIdFromQuery = sanitizeUserId(event.url.searchParams.get(USER_ID_QUERY_PARAM));
	const userIdFromCookie = sanitizeUserId(event.cookies.get(USER_ID_COOKIE_NAME));
	const authConfigured = isGoogleAuthConfigured();
	const userId = userIdFromHeader ?? userIdFromQuery ?? userIdFromCookie ?? DEFAULT_USER_ID;

	if (authConfigured && !userIdFromHeader && !userIdFromQuery && !userIdFromCookie) {
		const isSystemPath =
			event.url.pathname.startsWith('/api/cron') || event.url.pathname.startsWith('/api/scheduler/trigger');
		if (!dev && !isSystemPath) {
			throw error(401, 'User context required');
		}
		return DEFAULT_USER_ID;
	}

	await ensureUser(userId, {
		name: userId === DEFAULT_USER_ID ? 'Test Bruker' : `Bruker ${userId}`
	});

	if (event.cookies.get(USER_ID_COOKIE_NAME) !== userId) {
		event.cookies.set(USER_ID_COOKIE_NAME, userId, {
			path: '/',
			httpOnly: false,
			sameSite: 'lax',
			secure: event.url.protocol === 'https:',
			maxAge: 60 * 60 * 24 * 365
		});
	}

	return userId;
}
