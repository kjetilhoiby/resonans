import { sequence } from '@sveltejs/kit/hooks';
import { redirect, type Handle, type HandleServerError } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { handle as authenticationHandle } from './auth';
import { isGoogleAuthConfigured } from '$lib/server/auth-config';
import { startScheduler } from '$lib/server/scheduler';
import { resolveRequestUserId } from '$lib/server/request-user';
import { resolveApiSecretAuthFromRequest } from '$lib/server/api-secrets';
import { markNudgeOpened } from '$lib/server/nudge-events';
import { isPreviewEnv, PREVIEW_AUTH_COOKIE, verifyPreviewToken } from '$lib/server/preview-auth';
import { isPublicPath } from '$lib/server/public-paths';
import { clientErrorMessage, formatErrorLog } from '$lib/server/error-report';

// Start scheduler when server starts
if (env.ENABLE_IN_APP_SCHEDULER === 'true') {
	startScheduler();
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

/**
 * Uventede serverfeil: logg rute + stack, og gi klienten noe å vise.
 *
 * Uten denne hooken svarer SvelteKit `{"message":"Internal Error"}` — ingen
 * rute, ingen stack, ingenting å søke etter i Vercel-loggen. Det gjorde
 * feilsøkingen av mor-dashboardet i august til ren gjetting, og det er grunnen
 * til at hooken finnes.
 *
 * Kalles ikke for `error(...)`-kast fra koden vår (de er forventede) og ikke for
 * 404. Bare for det vi ikke har tenkt på.
 */
export const handleError: HandleServerError = ({ error, event, status, message }) => {
	const errorId = crypto.randomUUID().slice(0, 8);

	console.error(
		formatErrorLog({
			errorId,
			routeId: event.route.id,
			method: event.request.method,
			path: event.url.pathname,
			status,
			error
		})
	);

	return {
		message: clientErrorMessage(error) || message,
		errorId
	};
};
