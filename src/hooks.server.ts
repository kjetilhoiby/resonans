import { sequence } from '@sveltejs/kit/hooks';
import { redirect, type Handle, type HandleServerError } from '@sveltejs/kit';
import { building, dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { handle as authenticationHandle } from './auth';
import { isGoogleAuthConfigured } from '$lib/server/auth-config';
import { assertBootReady } from '$lib/server/boot-checks';
import { startScheduler } from '$lib/server/scheduler';
import { startCronDispatcher } from '$lib/server/cron-dispatcher';
import { resolveRequestUserId } from '$lib/server/request-user';
import { resolveApiSecretAuthFromRequest } from '$lib/server/api-secrets';
import { markNudgeOpened } from '$lib/server/nudge-events';
import { isPublicPath } from '$lib/server/public-paths';
import {
	headerAuthDiagnosis,
	isUserHeaderTrusted,
	unsecuredHeaderWarning
} from '$lib/server/user-header-auth';
import { clientErrorMessage, formatErrorLog } from '$lib/server/error-report';

// Konfigurasjonsfeil som ellers ville vært usynlige i drift — se boot-checks.ts.
// `building` holder bygget utenfor: da finnes ikke miljøvariablene ennå.
if (!building) {
	assertBootReady({
		isDev: dev,
		authConfigured: isGoogleAuthConfigured(),
		cronSecret: env.CRON_SECRET
	});
}

// Start scheduler when server starts
if (env.ENABLE_IN_APP_SCHEDULER === 'true') {
	startScheduler();
}

// In-app cron-dispatcher (erstatter GitHub Actions som klokke på VPS-en).
// Trygg å ha på flere instanser: en Postgres advisory-lås velger leder.
if (!building && env.ENABLE_CRON_DISPATCHER === 'true') {
	startCronDispatcher();
}

/** Miljøet vakta trenger. Lest her, siden modulen selv holdes testbar. */
function headerAuthContext() {
	return { isDev: dev, expectedSecret: env.RESONANS_HEADER_SECRET };
}

/**
 * Advarsel om ulåst diagnoseheader, én gang per instans.
 *
 * Per forespørsel ville den druknet i seg selv — cron treffer hvert 5. minutt.
 */
let warnedAboutUnsecuredHeader = false;
function warnOnceIfUnsecured() {
	if (warnedAboutUnsecuredHeader) return;
	const warning = unsecuredHeaderWarning(headerAuthContext());
	if (!warning) return;
	warnedAboutUnsecuredHeader = true;
	console.warn(warning);
}

const authorizationHandle: Handle = async ({ event, resolve }) => {
	// Uten Google-oppsett har vi ingen innlogging å kreve, så en fersk klone skal
	// kunne kjøres uten OAuth. `dev &&` er ikke overflødig ved siden av
	// oppstartsvakta: den gjør det umulig å lese grenen som noe annet enn lokal.
	if ((dev && !isGoogleAuthConfigured()) || isPublicPath(event.url.pathname)) {
		return resolve(event);
	}

	if (event.url.pathname.startsWith('/api/')) {
		const apiSecretAuth = await resolveApiSecretAuthFromRequest(event.request);
		if (apiSecretAuth) {
			event.locals.apiSecretAuth = apiSecretAuth;
			return resolve(event);
		}
	}

	// Headeren for curl og Playwright. Fritt lokalt, men deployet må den følges av
	// x-resonans-secret — se user-header-auth.ts for hvorfor den ikke kunne stå åpen.
	if (isUserHeaderTrusted(event.request.headers, headerAuthContext())) {
		warnOnceIfUnsecured();
		return resolve(event);
	}
	const headerProblem = headerAuthDiagnosis(event.request.headers, headerAuthContext());
	if (headerProblem) console.warn(`${headerProblem} ${event.request.method} ${event.url.pathname}`);

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
