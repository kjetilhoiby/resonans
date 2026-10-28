/**
 * Sjekken mot cross-site skjemainnsending — SvelteKits egen, med to unntak.
 *
 * ## Hvorfor vi har skrudd av SvelteKits og skrevet den her
 *
 * SvelteKit avviser i drift enhver POST med skjema-innholdstype
 * (`application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain`)
 * der `Origin` ikke er appens egen — også når `Origin` MANGLER. En server-til-
 * server-forespørsel har ingen `Origin`. Ekko kom seg forbi ved å sette headeren
 * selv (`ResonansAPI.swift`), men OAuth-token-endepunktet MÅ ta imot
 * `x-www-form-urlencoded` (RFC 6749 §4.1.3) fra Claude og ChatGPT sine servere,
 * og dem styrer vi ikke. Sjekken kjører før hooks, og kan ikke unntas per rute —
 * så den er slått av i `svelte.config.js` og gjenskapt her.
 *
 * NB: den slår bare til utenfor dev, som SvelteKits. Et brudd på token-
 * endepunktet ses altså ikke lokalt — det var nettopp derfor det måtte fanges
 * ved lesing av kildekoden og ikke ved testing.
 *
 * Unntakene er trygge fordi ingen av dem leser en informasjonskapsel: token- og
 * revokeringsendepunktet autentiserer på koden/tokenet i kroppen, og en
 * forfalsket forespørsel fra en annen side har ingen av delene.
 */

export const CSRF_EXEMPT_PATHS = ['/oauth/token', '/oauth/revoke'] as const;

/** Samme liste som SvelteKits `is_form_content_type`, inkludert dens binære skjemaformat. */
const FORM_CONTENT_TYPES = [
	'application/x-www-form-urlencoded',
	'multipart/form-data',
	'text/plain',
	'application/x-sveltekit-formdata'
];
const UNSAFE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

export interface CsrfInput {
	isDev: boolean;
	method: string;
	contentType: string | null;
	origin: string | null;
	urlOrigin: string;
	pathname: string;
	trustedOrigins?: readonly string[];
}

function isFormContentType(contentType: string | null): boolean {
	const type = contentType?.split(';', 1)[0].trim().toLowerCase() ?? '';
	return FORM_CONTENT_TYPES.includes(type);
}

export function isForbiddenCrossSiteForm(input: CsrfInput): boolean {
	if (input.isDev) return false;
	if (!UNSAFE_METHODS.includes(input.method)) return false;
	if (!isFormContentType(input.contentType)) return false;
	if (input.origin === input.urlOrigin) return false;
	if (input.origin && input.trustedOrigins?.includes(input.origin)) return false;
	const path = input.pathname.length > 1 ? input.pathname.replace(/\/$/, '') : input.pathname;
	if ((CSRF_EXEMPT_PATHS as readonly string[]).includes(path)) return false;
	return true;
}
