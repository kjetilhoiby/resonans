import type { RequestEvent } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { DEFAULT_USER_ID, ensureUser } from '$lib/server/users';
import { isGoogleAuthConfigured } from '$lib/server/auth-config';
import { resolveApiSecretAuthFromRequest } from '$lib/server/api-secrets';
import { isUserHeaderTrusted } from '$lib/server/user-header-auth';
import { pickFallbackUserId, sanitizeUserId } from '$lib/server/request-user-sources';

export const USER_ID_HEADER_NAME = 'x-resonans-user-id';
export const USER_ID_QUERY_PARAM = 'userId';
export const USER_ID_COOKIE_NAME = 'resonans_user_id';

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

	// Samme gating som i authorizationHandle: en header uten hemmelighet er ikke
	// bevis når vi er deployet. Query og cookie er aldri bevis, og leses bare i
	// dev — se request-user-sources.ts for hva som skjedde da de ble lest i prod.
	const fallbackUserId = pickFallbackUserId({
		isDev: dev,
		trustedHeader: isUserHeaderTrusted(event.request.headers, {
			isDev: dev,
			expectedSecret: env.RESONANS_HEADER_SECRET
		})
			? event.request.headers.get(USER_ID_HEADER_NAME)
			: null,
		query: event.url.searchParams.get(USER_ID_QUERY_PARAM),
		cookie: event.cookies.get(USER_ID_COOKIE_NAME)
	});
	const authConfigured = isGoogleAuthConfigured();
	const userId = fallbackUserId ?? DEFAULT_USER_ID;

	if (authConfigured && !fallbackUserId) {
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
