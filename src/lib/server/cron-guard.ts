import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { cronAuthProblem, type CronAuthContext } from '$lib/server/cron-auth';

/**
 * Miljøet vakta trenger. Lest her, siden `cron-auth.ts` holdes testbar.
 *
 * Samme arbeidsdeling som `user-header-auth.ts` / `hooks.server.ts`.
 */
export function cronAuthContext(): CronAuthContext {
	return { isDev: dev, expectedSecret: env.CRON_SECRET };
}

/**
 * Vakta hvert cron- og scheduler-endepunkt åpner med.
 *
 * ```ts
 * const denied = denyUnauthorizedCron(request);
 * if (denied) return denied;
 * ```
 *
 * Returnerer et ferdig 401-svar, eller `null` når kallet slipper gjennom. Grunnen
 * til avvisningen logges serverside og sendes **ikke** til klienten: den skiller
 * «feil hemmelighet» fra «ingen hemmelighet konfigurert», og det er ikke noe en
 * uautentisert kaller skal få vite.
 *
 * Stien leses av forespørselen framfor å oppgis, slik at loggen ikke kan si noe
 * annet enn ruta faktisk er.
 */
export function denyUnauthorizedCron(request: Request): Response | null {
	const problem = cronAuthProblem(request.headers, cronAuthContext());
	if (!problem) return null;

	let path = request.url;
	try {
		path = new URL(request.url).pathname;
	} catch {
		// Beholder rå-URL-en; en ugyldig URL er ikke verdt å kaste på i en logglinje.
	}
	console.warn(`[cron-auth] ${path} avvist: ${problem}`);
	return json({ error: 'Unauthorized' }, { status: 401 });
}
