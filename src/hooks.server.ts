import { sequence } from '@sveltejs/kit/hooks';
import { redirect, type Handle } from '@sveltejs/kit';
import { handle as authenticationHandle } from './auth';
import { isGoogleAuthConfigured } from '$lib/server/auth-config';
import { startScheduler } from '$lib/server/scheduler';
import { resolveRequestUserId } from '$lib/server/request-user';

// Start scheduler when server starts
startScheduler();

const PUBLIC_PATH_PREFIXES = ['/auth', '/_app', '/design'];
const PUBLIC_API_PREFIXES = ['/api/cron', '/api/scheduler/trigger'];

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

	// Allow requests that carry an explicit user-id header (e.g. curl / cron jobs)
	if (event.request.headers.get('x-resonans-user-id')) {
		return resolve(event);
	}

	const session = await event.locals.auth();
	if (session?.user?.id) {
		return resolve(event);
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
	return resolve(event);
};

export const handle: Handle = sequence(authenticationHandle, authorizationHandle, requestUserHandle);
