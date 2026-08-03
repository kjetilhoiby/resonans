/**
 * Gating av `x-resonans-user-id`-headeren.
 *
 * ## Hva som var galt
 *
 * `authorizationHandle` slapp gjennom **enhver** forespørsel som bar headeren, uten
 * noen hemmelighet:
 *
 * ```ts
 * if (event.request.headers.get('x-resonans-user-id')) return resolve(event);
 * ```
 *
 * Bruker-ID-en er dessuten committet i klartekst i `playwright.config.ts`. Én
 * header sto altså mellom internett og `/api/admin/*`. Headeren finnes for
 * Playwright og for curl mot egne endepunkter, og den er nyttig — men den trengte
 * en lås.
 *
 * ## Hvordan den er låst nå
 *
 * - **Lokalt (`dev`)**: godtas fritt. Det er der Playwright kjører, og en
 *   dev-server på localhost er ikke en angrepsflate.
 * - **Deployet, med `RESONANS_HEADER_SECRET` satt**: headeren må følges av
 *   `x-resonans-secret` som matcher.
 * - **Deployet, uten variabelen satt**: headeren godtas som før, og at den er ulåst
 *   logges én gang per instans.
 *
 * Miljøvariabelen er altså **bryteren**: sett den, og låsen slår inn uten flere
 * endringer. Det er bevisst fail *open*, valgt fordi alternativet slo ut
 * curl-tilgangen i samme øyeblikk koden ble deployet. Prisen er at en glemt variabel
 * gir åpen dør framfor tapt tilgang — derfor loggadvarselen, som er det eneste
 * sporet av at låsen ikke står på.
 *
 * `user_api_secrets` (se `api-secrets.ts`) er fortsatt den riktige veien for
 * langvarig maskintilgang. Denne headeren er for diagnostikk.
 */

export const USER_ID_HEADER = 'x-resonans-user-id';
export const USER_SECRET_HEADER = 'x-resonans-secret';

/** Sammenligning uten tidslekkasje. */
function safeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

/**
 * Miljøet, sendt inn framfor lest her.
 *
 * `$app/environment` og `$env/dynamic/private` finnes ikke under vitest, og en
 * sikkerhetsvakt som ikke kan enhetstestes er ikke verdt å ha. Kallstedene leser
 * dem og sender dem hit — se `hooks.server.ts`.
 */
export interface HeaderAuthContext {
	/** `true` i lokal utvikling, der headeren godtas fritt. */
	isDev: boolean;
	expectedSecret: string | undefined;
}

/**
 * Skal `x-resonans-user-id` stoles på for denne forespørselen?
 *
 * `false` betyr at headeren ignoreres — forespørselen må autentisere seg på annet
 * vis, eller avvises.
 */
export function isUserHeaderTrusted(
	headers: { get(name: string): string | null },
	context: HeaderAuthContext
): boolean {
	const userId = headers.get(USER_ID_HEADER);
	if (!userId) return false;

	if (context.isDev) return true;

	const expected = context.expectedSecret;
	// Ingen hemmelighet konfigurert → ingen lås. Se `unsecuredHeaderWarning`.
	if (!expected) return true;

	const provided = headers.get(USER_SECRET_HEADER);
	if (!provided) return false;

	return safeEqual(provided, expected);
}

/**
 * Én linje til loggen når headeren *avvises*, med grunnen.
 *
 * Uten dette ser en feilstavet hemmelighet ut som «alt er 401» uten spor av hvorfor
 * — nøyaktig den feilen som koster en time å finne. Null når det ikke er noe å
 * forklare.
 */
export function headerAuthDiagnosis(
	headers: { get(name: string): string | null },
	context: HeaderAuthContext
): string | null {
	if (!headers.get(USER_ID_HEADER)) return null;
	if (context.isDev) return null;
	const expected = context.expectedSecret;
	// Ulåst er ikke en avvisning — det rapporteres av unsecuredHeaderWarning.
	if (!expected) return null;
	if (!headers.get(USER_SECRET_HEADER)) {
		return `[auth] ${USER_ID_HEADER} avvist: mangler ${USER_SECRET_HEADER}.`;
	}
	if (!isUserHeaderTrusted(headers, context)) {
		return `[auth] ${USER_ID_HEADER} avvist: ${USER_SECRET_HEADER} stemmer ikke.`;
	}
	return null;
}

/**
 * Advarselen om at låsen ikke står på.
 *
 * Meningen er å bli lest én gang per instans, ikke per forespørsel — cron treffer
 * hvert 5. minutt, og en advarsel per kall ville druknet i seg selv. Kallstedet
 * eier «bare én gang»-logikken.
 */
export function unsecuredHeaderWarning(context: HeaderAuthContext): string | null {
	if (context.isDev || context.expectedSecret) return null;
	return `[auth] ${USER_ID_HEADER} godtas UTEN hemmelighet i dette miljøet. Sett RESONANS_HEADER_SECRET for å låse den.`;
}
