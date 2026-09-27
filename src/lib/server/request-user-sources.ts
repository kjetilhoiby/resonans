/**
 * Hvor en bruker-ID kan komme fra, og hvilke kilder som er BEVIS.
 *
 * ## Hva som var galt
 *
 * `resolveRequestUserId` falt tilbake på `?userId=` og `resonans_user_id`-cookien
 * uten noen dev-gate — bare headeren var låst (`isUserHeaderTrusted`). På en
 * gated sti var det ufarlig, fordi `authorizationHandle` alt hadde krevd økt,
 * API-hemmelighet eller betrodd header, og de vinner over fallbacken. Men
 * `/api/apps/callback` er en OFFENTLIG sti og kalte funksjonen selv:
 * `GET /api/apps/callback?app=ekko&userId=<uuid>` mintet da en fungerende
 * `rsn_`-hemmelighet for hvem som helst, uten innlogging. Hovedbrukerens uuid står
 * i klartekst i `playwright.config.ts` i et offentlig repo. Og siden fallbacken
 * kaller `ensureUser`, kunne en vilkårlig id også OPPRETTE en bruker forbi
 * allowlisten og få en hemmelighet til den.
 *
 * ## Regelen nå
 *
 * - En økt (`locals.auth()`) og en API-hemmelighet er bevis. Det er det ENESTE en
 *   sti som UTSTEDER legitimasjon får godta — se `sessionUserIdForAppCallback`.
 * - Query og cookie er bekvemmelighet for lokal utvikling og ALDRI bevis. De
 *   leses bare i `dev`, som headeren uten hemmelighet.
 *
 * Ren logikk uten `$env`/`$app`, så sikkerhetsgrensa kan testes.
 */

const USER_ID_PATTERN = /^[a-zA-Z0-9._-]{3,100}$/;

export function sanitizeUserId(value: string | null | undefined): string | null {
	if (!value) return null;
	const trimmed = value.trim();
	if (!trimmed || !USER_ID_PATTERN.test(trimmed)) return null;
	return trimmed;
}

export interface FallbackUserIdInput {
	isDev: boolean;
	/** Header-verdien, eller null når `isUserHeaderTrusted` sa nei. */
	trustedHeader: string | null | undefined;
	query: string | null | undefined;
	cookie: string | null | undefined;
}

/**
 * Bruker-ID-en fra kildene som IKKE er en økt eller en API-hemmelighet.
 *
 * Headeren er allerede gatet av kalleren. Query og cookie er det ikke, og kan
 * settes av hvem som helst — derfor bare i `dev`.
 */
export function pickFallbackUserId(input: FallbackUserIdInput): string | null {
	const header = sanitizeUserId(input.trustedHeader);
	if (header) return header;
	if (!input.isDev) return null;
	return sanitizeUserId(input.query) ?? sanitizeUserId(input.cookie);
}

/**
 * Hvem en app-callback skal utstede en API-hemmelighet til: innloggingens bruker,
 * og ingen andre.
 *
 * Ingen fallback på query, cookie, header eller `DEFAULT_USER_ID` — heller ikke i
 * dev. En sti som lager legitimasjon skal ikke ha en kodevei der noe annet enn en
 * ekte innlogging avgjør hvem legitimasjonen gjelder.
 */
export function sessionUserIdForAppCallback(
	session: { user?: { id?: string | null } | null } | null | undefined
): string | null {
	return sanitizeUserId(session?.user?.id);
}
