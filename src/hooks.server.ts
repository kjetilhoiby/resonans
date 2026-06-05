import { sequence } from '@sveltejs/kit/hooks';
import { redirect, type Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { handle as authenticationHandle } from './auth';
import { isGoogleAuthConfigured } from '$lib/server/auth-config';
import { startScheduler } from '$lib/server/scheduler';
import { resolveRequestUserId } from '$lib/server/request-user';
import { resolveApiSecretAuthFromRequest } from '$lib/server/api-secrets';
import { markNudgeOpened } from '$lib/server/nudge-events';
import { isPreviewEnv, PREVIEW_AUTH_COOKIE, verifyPreviewToken } from '$lib/server/preview-auth';

// Start scheduler when server starts
if (env.ENABLE_IN_APP_SCHEDULER === 'true') {
	startScheduler();
}

const PUBLIC_PATH_PREFIXES = ['/auth', '/_app', '/design', '/partner-invite', '/share', '/live'];
const PUBLIC_API_PREFIXES = ['/api/cron', '/api/scheduler/trigger', '/api/workouts/email-inbound', '/api/email-inbound', '/api/email/inbound', '/api/apps/authorize', '/api/apps/callback', '/api/apps/strava/connect', '/api/apps/strava/callback', '/api/share-link', '/api/live'];

function isPublicPath(pathname: string) {
	if (pathname === '/robots.txt' || pathname === '/favicon.ico') {
		return true;
	}

	if (PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
		return true;
	}

	if (PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
		return true;
	}

	return false;
}

const authorizationHandle: Handle = async ({ event, resolve }) => {
	if (!isGoogleAuthConfigured() || isPublicPath(event.url.pathname)) {
		return resolve(event);
	}

	if (event.url.pathname.startsWith('/api/')) {
		const apiSecretAuth = await resolveApiSecretAuthFromRequest(event.request);
		if (apiSecretAuth) {
			event.locals.apiSecretAuth = apiSecretAuth;
			return resolve(event);
		}
	}

	// Allow requests that carry an explicit user-id header (e.g. curl / cron jobs)
	if (event.request.headers.get('x-resonans-user-id')) {
		return resolve(event);
	}

	const session = await event.locals.auth();
	if (session?.user?.id) {
		return resolve(event);
	}

	if (isPreviewEnv()) {
		const token = event.cookies.get(PREVIEW_AUTH_COOKIE);
		if (token && verifyPreviewToken(token, env.AUTH_SECRET)) {
			return resolve(event);
		}
	}

	if (event.url.pathname.startsWith('/api/')) {
		return new Response(JSON.stringify({ error: 'Unauthorized' }), {
			status: 401,
			headers: {
				'content-type': 'application/json'
			}
		});
	}

	throw redirect(303, `/auth?next=${encodeURIComponent(event.url.pathname)}`);
};

const requestUserHandle: Handle = async ({ event, resolve }) => {
	if (isPublicPath(event.url.pathname)) {
		return resolve(event);
	}
	event.locals.userId = await resolveRequestUserId(event);

	const nudgeEventId = event.url.searchParams.get('nudgeEventId');
	if (nudgeEventId) {
		await markNudgeOpened(nudgeEventId, event.locals.userId);
	}

	return resolve(event);
};

export const handle: Handle = sequence(authenticationHandle, authorizationHandle, requestUserHandle);
