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
 * - **Deployet**: headeren må følges av `x-resonans-secret` som matcher
 *   `RESONANS_HEADER_SECRET`.
 * - **Uten `RESONANS_HEADER_SECRET` satt i prod**: headeren avvises. Fail closed —
 *   en glemt miljøvariabel skal gi tapt tilgang, ikke åpen dør.
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
	// Fail closed: uten en konfigurert hemmelighet er headeren verdiløs som bevis.
	if (!expected) return false;

	const provided = headers.get(USER_SECRET_HEADER);
	if (!provided) return false;

	return safeEqual(provided, expected);
}

/**
 * Én linje til loggen når headeren avvises i prod fordi hemmeligheten mangler.
 *
 * Uten dette ser en glemt `RESONANS_HEADER_SECRET` ut som «alt er 401» uten spor
 * av hvorfor — og det er nøyaktig den feilen som koster en time å finne.
 */
export function headerAuthDiagnosis(
	headers: { get(name: string): string | null },
	context: HeaderAuthContext
): string | null {
	if (!headers.get(USER_ID_HEADER)) return null;
	if (context.isDev) return null;
	const expected = context.expectedSecret;
	if (!expected) {
		return `[auth] ${USER_ID_HEADER} avvist: RESONANS_HEADER_SECRET er ikke satt i dette miljøet.`;
	}
	if (!headers.get(USER_SECRET_HEADER)) {
		return `[auth] ${USER_ID_HEADER} avvist: mangler ${USER_SECRET_HEADER}.`;
	}
	return `[auth] ${USER_ID_HEADER} avvist: ${USER_SECRET_HEADER} stemmer ikke.`;
}
