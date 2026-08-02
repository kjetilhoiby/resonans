/**
 * Hvilke stier som slipper forbi autentisering.
 *
 * Bor i egen modul fordi dette er en sikkerhetsgrense av ren logikk (streng →
 * boolean) som fortjener tester. Den lå tidligere inline i hooks.server.ts uten
 * testdekning, og har forårsaket tre bugs av samme rotårsak — se
 * PUBLIC_API_EXACT under.
 */

/** Stier med undersider som også skal være offentlige. Prefiksmatch. */
const PUBLIC_PATH_PREFIXES = ['/auth', '/_app', '/design', '/partner-invite', '/share', '/live'];

/**
 * API-stier med undersider som også skal være offentlige. Prefiksmatch.
 *
 * NB: `/api/health` hører IKKE hit — se PUBLIC_API_EXACT. De som står her har
 * reelle undersider: /api/cron (21 endepunkter), /api/share-link (6),
 * /api/live (2). De øvrige er enkelt-endepunkter (webhooks og OAuth-callbacks)
 * som beholdes som prefiks fordi de aldri har hatt problemet og ingen
 * underveier er planlagt.
 */
const PUBLIC_API_PREFIXES = [
	'/api/cron',
	'/api/scheduler/trigger',
	'/api/workouts/email-inbound',
	'/api/email-inbound',
	'/api/email/inbound',
	'/api/apps/authorize',
	'/api/apps/callback',
	'/api/apps/strava/connect',
	'/api/apps/strava/callback',
	'/api/apps/live-session/messages',
	'/api/share-link',
	'/api/live'
];

/**
 * Endepunkter som er offentlige i seg selv, men IKKE for underliggende stier.
 *
 * `/api/health` lå fram til 2026-08 i PUBLIC_API_PREFIXES, som er prefiksmatch.
 * Konsekvensen var at alt under `/api/health/` ble offentlig og dermed aldri
 * fikk `locals.userId` satt av requestUserHandle. Det traff tre endepunkter:
 *
 * - `/api/health/effort-weight` — feilet i prod, flyttet til /api/effort-weight
 * - `/api/health/weight-onboarding` — stille 401, flyttet til /api/helse/vekt-onboarding
 * - `/api/health/weight-series` — svarte 200 med tomme data til uautentiserte
 *   kallere (manglet null-sjekk), og ble slettet
 *
 * Eksakt match gjør en fjerde forekomst umulig: et nytt endepunkt under
 * `/api/health/` får normal auth.
 */
const PUBLIC_API_EXACT = ['/api/health'];

const PUBLIC_EXACT = ['/robots.txt', '/favicon.ico'];

/**
 * Fjerner én etterfølgende skråstrek. Hooks kjører før SvelteKit normaliserer
 * trailing slash, så `/api/health/` må treffe samme regel som `/api/health` —
 * ellers ville helsesjekken plutselig krevd innlogging.
 */
function normalize(pathname: string): string {
	return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

export function isPublicPath(pathname: string): boolean {
	const path = normalize(pathname);

	if (PUBLIC_EXACT.includes(path)) return true;
	if (PUBLIC_API_EXACT.includes(path)) return true;

	if (PUBLIC_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
	if (PUBLIC_API_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;

	return false;
}
